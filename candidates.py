"""
Restaurant candidate sourcing for The Food-Wheeler.

Inside Malaysia/Singapore, reads a bundled offline Overture Maps snapshot
(see scripts/build_places.py and overture_covers() below) - no network call,
no rate limits, exact per-place country codes. Everywhere else, tries the
free OSM Overpass API for real nearby venues. There is no demo mode in
production any more: get_candidates()/list_places() require a real location
and raise LocationRequired without one. A fetch failure or a genuinely empty
radius is surfaced as PlacesUnavailable, never silently substituted with
demo places at the wrong end of the world (see PlacesUnavailable below).
MOCK_RESTAURANTS survives only as fixture data for tests and
scripts/compare_engines.py.
"""
import math
import pathlib
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from meals import filter_for_meal

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
# Free, keyless OSRM table-service mirrors for real driving distance/time -
# raced the same way as OVERPASS_ENDPOINTS above (first success wins).
OSRM_ENDPOINTS = [
    "https://routing.openstreetmap.de/routed-car/table/v1/driving",
    "https://router.project-osrm.org/table/v1/driving",
]
ROUTE_CACHE_TTL_S = 30 * 60  # a restaurant's route doesn't meaningfully
# change minute to minute; 30 min means the Decide prefetch (see
# decide/page.tsx) and the real /api/decide call that follows it usually
# share one cache entry instead of routing the same pool twice.
ROUTE_HTTP_TIMEOUT_S = 4
ROUTE_POOL_SIZE = 25  # how many straight-line survivors get a real route
# looked up before the final diverse pick - see _finalize_candidates().
CACHE_TTL_S = 6 * 60 * 60  # restaurants don't move; a long TTL means a
# widened/prefetched radius during typing is very likely still warm by the
# time "Find our table" actually calls get_candidates() with the same key.
COUNTRY_CACHE_TTL_S = 30 * 24 * 60 * 60  # countries don't move either, and
# this is an extra round-trip on top of the actual places search - cache it
# hard. Keyed at ~11km precision (round(lat/lng, 1)), which is plenty for a
# country boundary except within a few km of a border - a real edge case,
# not one worth a second network round-trip per request to avoid.
MIN_RESULTS_BEFORE_WIDEN = 5
MIN_RESULTS_BEFORE_FALLBACK = 3
# A client-side safety net against a stray out-of-circle result (Overpass's
# own `around` filter should already enforce this server-side); a small
# epsilon absorbs rounding differences between its great-circle math and
# haversine_km below.
RADIUS_FILTER_EPSILON_KM = 0.05


class PlacesUnavailable(Exception):
    """Raised by get_candidates()/list_places() when a REAL location was
    given but nearby places couldn't be found - `kind` is "fetch" (every
    Overpass endpoint failed) or "empty" (fetched fine, genuinely nothing
    within the radius)."""

    def __init__(self, kind: str):
        self.kind = kind
        super().__init__(kind)


class LocationRequired(Exception):
    """Raised by get_candidates()/list_places() when no real location was
    given at all. There is no demo-mode fallback any more - a couple with
    location off gets asked to turn it on, never a restaurant list from the
    wrong side of the planet."""

# Continuous radius control ("the Expand Radius flex" - Phase 4, later
# widened from 3 fixed tiers to a free-form slider up to 50km). Every
# Overpass-tuning knob below is derived from the requested radius by
# _radius_params() rather than looked up from a fixed tier, so any value in
# [RADIUS_KM_MIN, RADIUS_KM_MAX] works, not just a few presets.
RADIUS_KM_MIN = 1.0
RADIUS_KM_MAX = 50.0
DEFAULT_RADIUS_KM = 1.5
# A small starting radius widens to 2x itself if too few results come back
# nearby; past this, a sparse result usually just means a sparse area, not a
# bad first guess, so there's nothing to gain from retrying wider.
WIDEN_THRESHOLD_KM = 2.5
# Past this radius, candidates are spread thin enough that stratifying
# picks across near/mid/far distance rings (see _select_diverse) instead of
# just taking the nearest N, so far-away places genuinely show up.
STRATIFY_THRESHOLD_KM = 8.0
PLACES_LIST_LIMIT = 60

# Rough price-tier ceilings in dollars, used only for the budget guard.
PRICE_TIER_MAX = {"$": 15, "$$": 30, "$$$": 60}

# Mirrors web/lib/decide/cuisines.ts's needle table, so a cuisine mentioned
# in a partner's free text ("something indian") and Explore's cuisine
# filter agree on what counts as each label. Used by both
# detect_cuisine_preference() below and _infer_cuisine_from_name().
CUISINE_NEEDLES: list[tuple[str, tuple[str, ...]]] = [
    ("Malay", ("malay",)),
    ("Chinese", ("chinese",)),
    ("Indian", ("indian",)),
    ("Japanese", ("japanese", "sushi", "ramen")),
    ("Korean", ("korean",)),
    ("Thai", ("thai",)),
    ("Western", ("western", "american", "burger", "steak", "italian", "pizza", "european")),
]

# Telltale NAME keywords for a cuisine that a source's own tagging often
# misses entirely - see the plan's spike: 66% of OSM places near a real
# test location had no cuisine tag at all, and several (all the "Nasi
# Kandar ..." and "Banana Leaf ..." places) are unmistakably Indian by name
# alone. Only ever overrides an already-generic label - see
# _infer_cuisine_from_name.
_NAME_CUISINE_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("Indian", ("mamak", "nasi kandar", "banana leaf", "briyani", "biryani", "capati", "chapati",
                "thosai", "dosa", "curry house", "tandoori", "naan")),
    ("Malay", ("nasi lemak", "ayam penyet", "warung")),
    ("Chinese", ("dim sum", "bak kut teh", "kopitiam")),
    ("Japanese", ("sushi", "ramen")),
]
_GENERIC_CUISINE_LABELS = {"restaurant", ""}

# One spelling for a dish people write four ways - "biryani" in a partner's
# text and "Briyani King" on a signboard must compare equal.
_DISH_SPELLING_RE = re.compile(r"\b(?:biriyani|briyani|briani|biryani)\b")


def _canon(text: str) -> str:
    return _DISH_SPELLING_RE.sub("biryani", text.lower())


def _has_word(haystack: str, needle: str) -> bool:
    """Whole-word match (allowing a plural s), so "dosa" doesn't fire on
    "dosage" the way a bare substring test would."""
    return re.search(rf"\b{re.escape(needle)}s?\b", haystack) is not None


def detect_cuisine_preference(text: str) -> str | None:
    """Best-effort cuisine a partner's free text asked for (e.g. "something
    indian" -> "Indian", "chicken biryani" -> "Indian"), so the Decide pool
    can be biased toward it instead of being picked by distance and
    diversity alone with no idea what either partner actually wants - see
    get_candidates()'s prefer_cuisine. Cuisine words win first; dish words
    (the same table _infer_cuisine_from_name uses on place names) are the
    fallback. Returns the first label mentioned; two different cuisines
    named just gets whichever comes first, the same as every other guard in
    this file."""
    lower = _canon(text)
    for label, needles in CUISINE_NEEDLES:
        if any(n in lower for n in needles):
            return label
    for label, needles in _NAME_CUISINE_HINTS:
        if any(_has_word(lower, n) for n in needles):
            return label
    return None


def detect_dish_keywords(text: str) -> list[str]:
    """Dish/format words a partner used ("biryani", "nasi lemak", "ramen"),
    canonically spelled - used to rank places whose NAME says the same thing
    ahead of merely-nearer ones with the right cuisine label. See
    _dish_affinity."""
    lower = _canon(text)
    found: list[str] = []
    for _, needles in _NAME_CUISINE_HINTS:
        for n in needles:
            canon_n = _canon(n)
            if _has_word(lower, canon_n) and canon_n not in found:
                found.append(canon_n)
    return found


def _dish_affinity(c: dict, dishes: list[str]) -> int:
    name = _canon(c["name"])
    return 1 if any(d in name for d in dishes) else 0


# Words in a place's own name that say what KIND of place it is rather than
# which one - stripped before matching a name a partner typed, so "23 Cafe &
# Kitchen" is found by "23 cafe" and "Agneey's Cuisine" by just "agneey's".
_NAME_GENERIC_WORDS = {
    "restoran", "restaurant", "cafe", "kitchen", "cuisine", "kedai", "the", "and", "house",
    "food", "corner", "bistro", "stall", "cafeteria", "bar", "grill", "sdn", "bhd",
}
# Keys that are really a craving, not a name - a place literally called
# "Spicy" must not get pinned because someone typed "spicy".
_NAME_STOP_KEYS = (
    {n for _, needles in CUISINE_NEEDLES for n in needles}
    | {n for _, needles in _NAME_CUISINE_HINTS for n in needles}
    | _NAME_GENERIC_WORDS
    | {"spicy", "mild", "halal", "vegan", "vegetarian", "cheap", "budget", "hot", "lunch", "dinner",
       "anything", "fine", "tonight", "indian", "malaysian", "asian"}
)
_MIN_NAME_KEY_LEN = 4


def _words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower().replace("'", "").replace("’", ""))


def _name_keys(name: str) -> set[str]:
    """Every squashed form of a place name a partner might plausibly type."""
    tokens = _words(name)
    core = [t for t in tokens if t not in _NAME_GENERIC_WORDS]
    keys = {"".join(tokens), "".join(core), "".join(core[:2]), "".join(tokens[:2])}
    return {k for k in keys if len(k) >= _MIN_NAME_KEY_LEN and k not in _NAME_STOP_KEYS}


def find_named_places(text: str, results: list[dict]) -> list[dict]:
    """The places a couple explicitly named ("maybe 7spice cafe, or
    agneey's or 23 cafe"), out of `results`. Matches on whole-token windows
    of the text, squashed, so "7spice" and "7 spice" both find "7 Spice
    Indian Cuisine" and "23cafe" can't fire inside "123cafe". Nearest
    first."""
    tokens = _words(text)
    if not tokens:
        return []
    windows = {"".join(tokens[i:i + n]) for n in (1, 2, 3) for i in range(len(tokens) - n + 1)}
    return sorted((c for c in results if _name_keys(c["name"]) & windows), key=effective_km)


def _infer_cuisine_from_name(name: str, cuisine: str) -> str:
    """Only overrides a GENERIC label (no real cuisine tag/category from the
    source data) - a source that already said "Chinese" or "Cafe" is
    trusted as-is."""
    if cuisine.lower() not in _GENERIC_CUISINE_LABELS:
        return cuisine
    lower = name.lower()
    for label, needles in _NAME_CUISINE_HINTS:
        if any(n in lower for n in needles):
            return label
    return cuisine

# Muted jewel tones for the wheel slices - deliberately desaturated to
# match the premium dark theme rather than a bright rainbow palette.
SLICE_COLORS = ["#c9a15a", "#3f6b66", "#8c4a4a", "#556080", "#7a8450", "#b5674a"]

_cache: dict[tuple, tuple[float, list[dict]]] = {}
_country_cache: dict[tuple[float, float], tuple[float, str | None]] = {}
_route_cache: dict[tuple, tuple[float, tuple[float, float] | None]] = {}

# Fixture venues for tests and scripts/compare_engines.py only - production
# get_candidates()/list_places() never return these (see LocationRequired).
# Kept clustered around a fixed point so distance-based tests stay readable.
DEMO_CENTER = (40.7306, -73.9866)  # a spot in NYC, used only as the fixture anchor
MOCK_RESTAURANTS = [
    {
        "id": "mock_casa_fuego",
        "name": "Casa Fuego Cantina",
        "cuisine": "Mexican",
        "tags": ["spicy", "patio", "casual"],
        "price": "$$",
        "lat": 40.7311, "lng": -73.9859,
        "address": "123 Example St",
        "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"},
    },
    {
        "id": "mock_thai_orchid",
        "name": "Thai Orchid",
        "cuisine": "Thai",
        "tags": ["spicy", "indoor", "casual", "gluten_free"],
        "price": "$$",
        "lat": 40.7295, "lng": -73.9880,
        "address": "45 Example Ave",
        "dims": {"service": "sit_down", "spice": "hot", "setting": "indoor", "price": "mid", "diet": "gluten_free"},
    },
    {
        "id": "mock_green_bowl",
        "name": "Green Bowl",
        "cuisine": "Vegan",
        "tags": ["vegan", "gluten_free", "healthy", "indoor"],
        "price": "$",
        "lat": 40.7320, "lng": -73.9840,
        "address": "9 Example Blvd",
        "dims": {"service": "fast_food", "spice": "mild", "setting": "indoor", "price": "low", "diet": "vegan"},
    },
    {
        "id": "mock_burger_barn",
        "name": "Burger Barn",
        "cuisine": "American",
        "tags": ["burgers", "fast_food", "casual"],
        "price": "$",
        "lat": 40.7288, "lng": -73.9845,
        "address": "77 Example Pl",
        "dims": {"service": "fast_food", "spice": "mild", "setting": "indoor", "price": "low", "diet": "none"},
    },
    {
        "id": "mock_la_trattoria",
        "name": "La Trattoria",
        "cuisine": "Italian",
        "tags": ["fine_dining", "indoor", "romantic"],
        "price": "$$$",
        "lat": 40.7330, "lng": -73.9895,
        "address": "200 Example Row",
        "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "high", "diet": "none"},
    },
    {
        "id": "mock_sunset_tacos",
        "name": "Sunset Tacos",
        "cuisine": "Mexican",
        "tags": ["spicy", "patio", "takeaway", "halal"],
        "price": "$",
        "lat": 40.7275, "lng": -73.9820,
        "address": "310 Example Way",
        "dims": {"service": "fast_food", "spice": "hot", "setting": "patio", "price": "low", "diet": "halal"},
    },
]


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def effective_km(c: dict) -> float:
    """Real driving distance when we have one (see _route_table), falling
    back to the straight-line distance_km Overpass gave us otherwise. Used
    everywhere a "distance" drives a decision - sorting, the radius cutoff,
    the deterministic tiebreak - so all of it reflects an actual drive
    rather than a straight line through whatever's in between."""
    route_km = c.get("route_km")
    return route_km if route_km is not None else c.get("distance_km", 999)


def _price_from_amenity(amenity: str) -> str:
    if amenity == "fast_food":
        return "~$"
    if amenity == "cafe":
        return "~$"
    return "~$$"


def _diet_from_tags(tags: dict) -> str:
    # First match wins; a venue is rarely tagged for more than one of these.
    if tags.get("diet:vegan") in ("yes", "only"):
        return "vegan"
    if tags.get("diet:vegetarian") in ("yes", "only"):
        return "vegetarian"
    if tags.get("diet:halal") in ("yes", "only"):
        return "halal"
    if tags.get("diet:gluten_free") in ("yes", "only"):
        return "gluten_free"
    return "none"


def _dims_from_tags(tags: dict, amenity: str) -> dict:
    outdoor = tags.get("outdoor_seating") == "yes"
    is_fast = amenity in ("fast_food",) or tags.get("takeaway") == "only"
    cuisine = (tags.get("cuisine") or "").lower()
    spicy_hint = any(k in cuisine for k in ("mexican", "thai", "indian", "szechuan", "spicy"))
    price_hint = "high" if tags.get("fee") == "yes" else ("low" if is_fast else "mid")
    return {
        "service": "fast_food" if is_fast else "sit_down",
        "spice": "hot" if spicy_hint else "mild",
        "setting": "patio" if outdoor else "indoor",
        "price": price_hint,
        "diet": _diet_from_tags(tags),
    }


def _tags_list_from_osm(tags: dict, amenity: str) -> list[str]:
    out = []
    if tags.get("outdoor_seating") == "yes":
        out.append("patio")
    if amenity == "fast_food" or tags.get("takeaway") == "only":
        out.append("fast_food")
    if tags.get("diet:vegan") in ("yes", "only"):
        out.append("vegan")
    if tags.get("diet:vegetarian") in ("yes", "only"):
        out.append("vegetarian")
    if tags.get("diet:halal") in ("yes", "only"):
        out.append("halal")
    if tags.get("diet:gluten_free") in ("yes", "only"):
        out.append("gluten_free")
    cuisine = tags.get("cuisine")
    if cuisine:
        out.extend(c.strip() for c in cuisine.split(";") if c.strip())
    return out or ["restaurant"]


def clamp_radius_km(radius_km) -> float:
    try:
        radius_km = float(radius_km)
    except (TypeError, ValueError):
        return DEFAULT_RADIUS_KM
    if radius_km != radius_km:  # NaN
        return DEFAULT_RADIUS_KM
    return max(RADIUS_KM_MIN, min(RADIUS_KM_MAX, radius_km))


def _radius_params(radius_km: float) -> dict:
    """Every Overpass-tuning knob, derived from the radius instead of a
    fixed tier lookup. The timeout climbs from 8s at the smallest radius to
    25s at the 50km max - big-radius queries in dense cities were timing
    out with the old 15s ceiling and silently falling through to mock data,
    which is exactly the "places outside the radius" bug this fixes."""
    timeout_s = round(max(8, min(25, 8 + radius_km * 0.35)))
    # Overpass's `out ... {result_cap}` truncates in its own internal (id)
    # order, BEFORE we ever get a chance to sort by distance - a small cap
    # in a dense area silently drops genuinely-nearby places in favour of
    # arbitrary far-away ones that merely have a lower id. Measured against
    # real data (see the plan's spike): the old formula's 285 cap at 15km
    # radius (1,066 places within it) kept only 31 of the true nearest 60.
    # A steeper slope and higher ceiling closes most of that gap without
    # making a 50km query's payload/timeout risk unbounded - this is a
    # mitigation for the OSM fallback path specifically; the bundled
    # Overture source (see _fetch_overture) has no such cap at all.
    result_cap = round(max(200, min(1500, 150 + radius_km * 60)))
    max_candidates = 6 if radius_km <= 3 else 8
    stratify = radius_km >= STRATIFY_THRESHOLD_KM
    widen_km = radius_km * 2 if radius_km <= WIDEN_THRESHOLD_KM else None
    return {
        "timeout_s": timeout_s,
        "result_cap": result_cap,
        "max_candidates": max_candidates,
        "stratify": stratify,
        "widen_km": widen_km,
    }


def _query_overpass_endpoint(endpoint: str, query: str, headers: dict, http_timeout_s: int) -> dict | None:
    try:
        resp = requests.post(endpoint, data={"data": query}, headers=headers, timeout=http_timeout_s)
        # 429 (rate limited) and 504 (gateway timeout) are exactly what a
        # public, shared Overpass mirror does under load - treating that the
        # same as a connection failure (falling through to another mirror)
        # is the right response, not a hard failure. raise_for_status()
        # raises HTTPError for both (a RequestException subclass), so the
        # except below already covers them the same way.
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError):
        return None


def detect_country(lat: float, lng: float, timeout_s: int = 6) -> str | None:
    """Best-effort ISO3166-1 alpha-2 country code for a point, via Overpass's
    own is_in()/area idiom - the same trick most "reverse geocode with
    Overpass" tools use, so it needs no separate geocoding service or key.
    Cached hard (see COUNTRY_CACHE_TTL_S) since this runs before every
    same-country places search, on top of the search itself.

    Returns None if no mirror could determine it - a mirror without is_in
    support, a slow/failed request, or a point outside any mapped
    admin_level=2 boundary. Callers treat that as "couldn't verify", not
    "no country": get_candidates()/list_places() fall back to an unfiltered
    search rather than showing nothing just because detection failed."""
    cache_key = (round(lat, 1), round(lng, 1))
    cached = _country_cache.get(cache_key)
    if cached and time.time() - cached[0] < COUNTRY_CACHE_TTL_S:
        return cached[1]

    query = f"""
    [out:json][timeout:{timeout_s}];
    is_in({lat},{lng})->.here;
    area.here["boundary"="administrative"]["admin_level"="2"]->.country;
    .country out tags;
    """
    headers = {"User-Agent": "food-wheeler/1.0 (educational prototype)"}
    http_timeout_s = timeout_s + 5

    executor = ThreadPoolExecutor(max_workers=len(OVERPASS_ENDPOINTS))
    futures = {
        executor.submit(_query_overpass_endpoint, ep, query, headers, http_timeout_s): ep
        for ep in OVERPASS_ENDPOINTS
    }
    country = None
    try:
        for fut in as_completed(futures):
            data = fut.result()
            if data is None:
                continue
            for el in data.get("elements", []):
                tags = el.get("tags", {})
                code = tags.get("ISO3166-1:alpha2") or tags.get("ISO3166-1")
                if code:
                    country = code.upper()
                    break
            if country:
                break
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    _country_cache[cache_key] = (time.time(), country)
    return country


def _query_osrm_endpoint(base_url: str, coords: str, params: str) -> dict | None:
    try:
        resp = requests.get(f"{base_url}/{coords}", params=params, timeout=ROUTE_HTTP_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            return None
        return data
    except (requests.RequestException, ValueError):
        return None


def _route_table(lat: float, lng: float, places: list[dict]) -> dict[str, tuple[float, float] | None]:
    """Real driving distance/duration from (lat, lng) to each place, via one
    OSRM `table` request for the whole pool at once (rather than one request
    per place). Returns {place_id: (route_km, route_min)}, using None for a
    place OSRM couldn't reach or when routing failed outright - callers fall
    back to the already-known straight-line distance_km in that case, this
    never raises.

    Cached per (~100m grid cell, place id) for ROUTE_CACHE_TTL_S - see its
    docstring for why."""
    grid_lat, grid_lng = round(lat, 3), round(lng, 3)
    now = time.time()
    out: dict[str, tuple[float, float] | None] = {}
    to_fetch: list[dict] = []
    for p in places:
        cached = _route_cache.get((grid_lat, grid_lng, p["id"]))
        if cached and now - cached[0] < ROUTE_CACHE_TTL_S:
            out[p["id"]] = cached[1]
        else:
            to_fetch.append(p)

    if not to_fetch:
        return out

    # Coordinate 0 is the user; the rest are the places, in order - OSRM's
    # `sources=0` then gives back one row of distances/durations FROM the
    # user TO every coordinate (itself included at index 0, skipped below).
    coords = ";".join([f"{lng},{lat}"] + [f"{p['lng']},{p['lat']}" for p in to_fetch])
    params = "sources=0&annotations=distance,duration"

    executor = ThreadPoolExecutor(max_workers=len(OSRM_ENDPOINTS))
    futures = {
        executor.submit(_query_osrm_endpoint, ep, coords, params): ep
        for ep in OSRM_ENDPOINTS
    }
    data = None
    try:
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                data = result
                break
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    if data is None:
        # Routing failed everywhere - nothing is cached here (a transient
        # outage shouldn't be remembered for 30 minutes), and every place
        # just falls back to its straight-line distance_km.
        for p in to_fetch:
            out[p["id"]] = None
        return out

    distances = (data.get("distances") or [[]])[0]
    durations = (data.get("durations") or [[]])[0]
    for i, p in enumerate(to_fetch):
        dist_m = distances[i + 1] if i + 1 < len(distances) else None
        dur_s = durations[i + 1] if i + 1 < len(durations) else None
        route = (round(dist_m / 1000, 2), round(dur_s / 60)) if dist_m is not None and dur_s is not None else None
        out[p["id"]] = route
        _route_cache[(grid_lat, grid_lng, p["id"])] = (now, route)

    return out


# ---------------------------------------------------------------------------
# Overture Maps Places - a bundled offline snapshot for Malaysia and
# Singapore (see scripts/build_places.py), tried BEFORE ever reaching out to
# Overpass. It has no rate limits, no network round trip, exact per-place
# country codes (no is_in()/area guesswork), and far denser, better-
# categorized coverage than OSM alone in this region (see the plan's N2
# spike: Overture had "Agneey's Cuisine" correctly tagged indian_restaurant
# when it wasn't in OSM at all). Overpass remains the only source for
# everywhere else in the world.
# ---------------------------------------------------------------------------
OVERTURE_DATA_PATH = pathlib.Path(__file__).resolve().parent / "data" / "places_my_sg.parquet"
# ~11km at the equator - the same grid precision as COUNTRY_CACHE_TTL_S's
# cache key above, chosen for the same reason (plenty for "which country",
# and plenty of cells per query without an excessive lookup fan-out).
OVERTURE_GRID_DEG = 0.1
KM_PER_DEG = 111.0

# None = "not loaded yet" (loads lazily, once, on first use); {} = "loaded,
# and the bundle file wasn't found" - both cases fall through to Overpass,
# but the distinction matters for _load_overture_index()'s own caching.
_overture_index: dict[tuple[int, int], list[dict]] | None = None

_OVERTURE_DIET_CATEGORIES = {
    "halal_restaurant": "halal",
    "vegan_restaurant": "vegan",
    "vegetarian_restaurant": "vegetarian",
    "gluten_free_restaurant": "gluten_free",
}
_OVERTURE_FAST_CATEGORIES = {"fast_food_restaurant", "food_court", "food_truck_stand"}
_OVERTURE_CHEAP_CATEGORIES = _OVERTURE_FAST_CATEGORIES | {"cafe", "coffee_shop", "bakery", "dessert_shop", "ice_cream_shop"}
_OVERTURE_SPICY_HINTS = ("indian", "thai", "mexican", "szechuan", "sichuan", "korean")


def _overture_grid_cell(lat: float, lng: float) -> tuple[int, int]:
    return (round(lat / OVERTURE_GRID_DEG), round(lng / OVERTURE_GRID_DEG))


def _load_overture_index() -> dict[tuple[int, int], list[dict]]:
    """Loads the bundled dataset into an in-memory grid index once per
    process. An empty dict (file missing, e.g. a dev checkout that hasn't
    run scripts/build_places.py) is cached the same as a populated one -
    every caller already treats "no bucket here" and "no index at all" the
    same way, by falling through to Overpass."""
    global _overture_index
    if _overture_index is not None:
        return _overture_index
    if not OVERTURE_DATA_PATH.exists():
        _overture_index = {}
        return _overture_index

    import duckdb  # local import: only paid for when the bundle is actually used

    con = duckdb.connect()
    rows = con.execute(
        "SELECT id, name, lat, lng, country, category, address "
        f"FROM read_parquet('{OVERTURE_DATA_PATH.as_posix()}')"
    ).fetchall()
    index: dict[tuple[int, int], list[dict]] = {}
    for id_, name, lat, lng, country, category, address in rows:
        index.setdefault(_overture_grid_cell(lat, lng), []).append({
            "id": id_, "name": name, "lat": lat, "lng": lng,
            "country": country, "category": category, "address": address,
        })
    _overture_index = index
    return index


def _overture_raw_within(lat: float, lng: float, radius_km: float) -> list[dict]:
    """Every bundled place within radius_km of (lat, lng), each carrying a
    freshly computed distance_km - not yet a candidate dict (see
    _overture_to_candidate) and not yet filtered by country."""
    index = _load_overture_index()
    if not index:
        return []
    span = math.ceil(radius_km / (OVERTURE_GRID_DEG * KM_PER_DEG)) + 1
    clat, clng = _overture_grid_cell(lat, lng)
    out = []
    for dlat in range(-span, span + 1):
        for dlng in range(-span, span + 1):
            for p in index.get((clat + dlat, clng + dlng), ()):
                d = haversine_km(lat, lng, p["lat"], p["lng"])
                if d <= radius_km:
                    out.append({**p, "distance_km": round(d, 2)})
    return out


def overture_covers(lat: float, lng: float, search_km: float = 100.0) -> str | None:
    """The country of the nearest bundled place within search_km, or None if
    the bundle has nothing that close. get_candidates()/list_places() use
    this both as "is this location even in the Overture bundle at all" and
    (when it is) as the free, local replacement for detect_country()'s live
    Overpass call."""
    nearby = _overture_raw_within(lat, lng, search_km)
    if not nearby:
        return None
    return min(nearby, key=lambda p: p["distance_km"])["country"]


def _dims_from_overture_category(category: str) -> dict:
    is_fast = category in _OVERTURE_FAST_CATEGORIES
    spicy_hint = any(k in category for k in _OVERTURE_SPICY_HINTS)
    return {
        "service": "fast_food" if is_fast else "sit_down",
        "spice": "hot" if spicy_hint else "mild",
        "setting": "indoor",  # outdoor-seating isn't in the trimmed bundle columns
        "price": "low" if is_fast else "mid",
        "diet": _OVERTURE_DIET_CATEGORIES.get(category, "none"),
    }


def _tags_from_overture_category(category: str) -> list[str]:
    label = category.replace("_restaurant", "").replace("_", " ").strip()
    tags = [label] if label and label != "restaurant" else []
    if category in _OVERTURE_FAST_CATEGORIES:
        tags.append("fast_food")
    diet = _OVERTURE_DIET_CATEGORIES.get(category)
    if diet:
        tags.append(diet)
    return tags or ["restaurant"]


def _price_from_overture_category(category: str) -> str:
    return "~$" if category in _OVERTURE_CHEAP_CATEGORIES else "~$$"


def _overture_to_candidate(p: dict) -> dict:
    category = p["category"]
    cuisine = category.replace("_restaurant", "").replace("_", " ").title() or "Restaurant"
    return {
        "id": p["id"],
        "name": p["name"],
        "cuisine": _infer_cuisine_from_name(p["name"], cuisine),
        "tags": _tags_from_overture_category(category),
        "price": _price_from_overture_category(category),
        "lat": p["lat"], "lng": p["lng"],
        "address": p["address"] or "Nearby",
        "dims": _dims_from_overture_category(category),
        "distance_km": p["distance_km"],
    }


def _fetch_overture(lat: float, lng: float, radius_km: float, country_iso: str | None) -> list[dict]:
    """Same shape and radius semantics as _fetch_overpass()'s eventual
    output, but synchronous and network-free - no widen-retry or timeout
    handling needed, since a local grid lookup has neither Overpass's
    flakiness nor its result_cap-before-sorting truncation problem (every
    in-radius place is always included, not just the first N returned)."""
    raw = _overture_raw_within(lat, lng, radius_km)
    if country_iso:
        raw = [p for p in raw if p["country"] == country_iso]
    return [_overture_to_candidate(p) for p in raw]


def _fetch_overpass(
    lat: float, lng: float, radius_m: int, timeout_s: int, result_cap: int, country_iso: str | None = None
) -> list[dict] | None:
    # When a country is known, the area it names is fetched once and both
    # the node and way searches are additionally constrained to it - a
    # point still has to be inside the requested radius AND that country,
    # so a search near the Johor/Singapore border stops crossing over.
    area_clause = ""
    area_filter = ""
    if country_iso:
        area_clause = f'area["ISO3166-1:alpha2"="{country_iso}"]->.country;\n    '
        area_filter = "(area.country)"
    query = f"""
    [out:json][timeout:{timeout_s}];
    {area_clause}(
      node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:{radius_m},{lat},{lng}){area_filter};
      way["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:{radius_m},{lat},{lng}){area_filter};
    );
    out center tags {result_cap};
    """
    headers = {"User-Agent": "food-wheeler/1.0 (educational prototype)"}
    # The HTTP timeout is a few seconds looser than the query's own
    # [timeout:] so Overpass gets the chance to reply with its own timeout
    # error (still caught below) instead of us cutting the socket first.
    http_timeout_s = timeout_s + 5

    # Every mirror is queried AT ONCE and whichever answers first wins,
    # instead of trying them one after another - trying 3 mirrors serially
    # at a ~23s timeout each meant a genuinely bad radius could take over a
    # minute to fail, well past the frontend's 45s budget. In parallel, the
    # worst case is one timeout, not three stacked.
    executor = ThreadPoolExecutor(max_workers=len(OVERPASS_ENDPOINTS))
    futures = {
        executor.submit(_query_overpass_endpoint, ep, query, headers, http_timeout_s): ep
        for ep in OVERPASS_ENDPOINTS
    }
    data = None
    try:
        for fut in as_completed(futures):
            result = fut.result()
            if result is not None:
                data = result
                break
    finally:
        # Don't block the winner on the slower mirrors finishing - any
        # still-running request threads are simply left to finish (or time
        # out) on their own and are discarded.
        executor.shutdown(wait=False, cancel_futures=True)

    if data is None:
        return None

    results = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        if el["type"] == "node":
            elat, elng = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            elat, elng = center.get("lat"), center.get("lon")
        if elat is None or elng is None:
            continue
        amenity = tags.get("amenity", "restaurant")
        cuisine = _infer_cuisine_from_name(name, (tags.get("cuisine") or amenity).replace("_", " ").title())
        results.append({
            "id": f"osm_{el['type']}_{el['id']}",
            "name": name,
            "cuisine": cuisine,
            "tags": _tags_list_from_osm(tags, amenity),
            "price": _price_from_amenity(amenity),
            "lat": elat, "lng": elng,
            "address": tags.get("addr:street", "") or "Nearby",
            "dims": _dims_from_tags(tags, amenity),
            "distance_km": round(haversine_km(lat, lng, elat, elng), 2),
        })
    return results


def _fetch_for_radius(
    lat: float, lng: float, radius_m: int, timeout_s: int, result_cap: int, country_iso: str | None = None
) -> list[dict] | None:
    cache_key = (round(lat, 3), round(lng, 3), radius_m, country_iso)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_S:
        return cached[1]
    results = _fetch_overpass(lat, lng, radius_m, timeout_s=timeout_s, result_cap=result_cap, country_iso=country_iso)
    if results is not None:
        _cache[cache_key] = (time.time(), results)
    return results


def _within_radius(results: list[dict], radius_km: float) -> list[dict]:
    return [r for r in results if r.get("distance_km", 0) <= radius_km + RADIUS_FILTER_EPSILON_KM]


def get_candidates(
    location: dict | None,
    radius_km: float = DEFAULT_RADIUS_KM,
    same_country: bool = True,
    prefer_cuisine: str | None = None,
    route_from: dict | None = None,
    mention_text: str | None = None,
    meal: str | None = None,
) -> tuple[list[dict], str]:
    """Returns (candidates, source) where source is 'overture', 'osm' or
    'mock'. The AI decision engines see only this curated, capped list -
    see list_places() for the uncurated Explore browsing list.

    same_country=True (the default) keeps results inside whichever country
    the given location is in. Inside the bundled Overture region (see
    overture_covers()) that's exact, from each place's own country field;
    outside it, it's detect_country()'s best-effort Overpass lookup, which
    silently searches unfiltered rather than returning nothing if detection
    fails.

    prefer_cuisine, when given (see detect_cuisine_preference()), reserves
    most of the pool for that cuisine instead of picking by distance and
    diversity alone with no idea what either partner actually asked for.

    route_from, when given, is a SEPARATE {lat, lng} the final pool's
    driving distance/time is measured FROM, while `location` still drives
    the search itself and the straight-line radius cutoff. Used when a
    partner mentioned a specific place to search around (see app.py's
    extract_location_mentions/resolve_location_mention): the search centres
    on the mentioned place, but "how far is this drive" is always measured
    from the couple's own position, not from the place they merely
    mentioned - see _finalize_candidates for the trade-off this implies.

    mention_text is the couple's own words - places they NAMED are pinned
    into the shortlist, and a stated dish ranks places whose name carries it
    first. See _finalize_candidates.

    meal (see meals.detect_meal) keeps the shortlist to places that suit it -
    at lunch, no ice-cream or waffle shops - except places the couple named.

    Raises LocationRequired with no location at all, and PlacesUnavailable
    if a real location was given but nothing usable came back - see each
    class's docstring."""
    radius_km = clamp_radius_km(radius_km)
    if not location or location.get("lat") is None or location.get("lng") is None:
        raise LocationRequired()

    lat, lng = location["lat"], location["lng"]
    params = _radius_params(radius_km)

    overture_country = overture_covers(lat, lng)
    if overture_country is not None:
        country_iso = overture_country if same_country else None
        results = _fetch_overture(lat, lng, radius_km, country_iso)
        if not results:
            raise PlacesUnavailable("empty")
        final = _finalize_candidates(lat, lng, results, radius_km, params, prefer_cuisine=prefer_cuisine,
                                      route_from=route_from, mention_text=mention_text, meal=meal)
        if not final:
            raise PlacesUnavailable("empty")
        return final, "overture"

    # Outside the bundle - the existing live-Overpass path, unchanged.
    country_iso = detect_country(lat, lng) if same_country else None
    radii_km = [radius_km] + ([params["widen_km"]] if params["widen_km"] else [])

    any_fetch_succeeded = False
    best_results: list[dict] | None = None
    best_radius_km = radius_km
    for i, r_km in enumerate(radii_km):
        results = _fetch_for_radius(
            lat, lng, round(r_km * 1000), params["timeout_s"], params["result_cap"], country_iso=country_iso
        )
        if results is None:
            continue
        any_fetch_succeeded = True
        results = _within_radius(results, r_km)
        # A wider retry isn't guaranteed to return a superset (same result
        # cap, different Overpass ordering), so keep whichever attempt
        # found the most rather than just the last one tried.
        if best_results is None or len(results) > len(best_results):
            best_results = results
            best_radius_km = r_km
        if len(results) >= MIN_RESULTS_BEFORE_FALLBACK:
            if len(results) >= MIN_RESULTS_BEFORE_WIDEN or i == len(radii_km) - 1:
                best_results = results
                best_radius_km = r_km
                break

    if not any_fetch_succeeded:
        raise PlacesUnavailable("fetch")
    if not best_results:
        raise PlacesUnavailable("empty")
    # 1-2 real results is still real - return them rather than jumping to
    # the mock set (which is what put NYC restaurants 15,000km away in
    # front of a real user).
    final = _finalize_candidates(lat, lng, best_results, best_radius_km, params, prefer_cuisine=prefer_cuisine,
                                  route_from=route_from, mention_text=mention_text, meal=meal)
    if not final:
        raise PlacesUnavailable("empty")
    return final, "osm"


def _finalize_candidates(
    lat: float, lng: float, results: list[dict], radius_km: float, params: dict,
    prefer_cuisine: str | None = None, route_from: dict | None = None,
    mention_text: str | None = None, meal: str | None = None,
) -> list[dict]:
    """distance_km is only ever the cheap prefilter - a road route is never
    shorter than the straight line, so it's a safe upper bound, but it can
    meaningfully OVERSTATE how close a place actually is (a river, a
    highway with no nearby crossing, a gated community). This takes a
    diverse pool of the straight-line survivors, looks up real driving
    distance/time for the whole pool in one OSRM call, drops anything
    that's actually outside the radius by road, and only THEN makes the
    final diverse pick - so radius_km is a promise about the drive, not
    just the distance as the crow flies.

    If routing fails outright, every place in the pool just keeps its
    straight-line distance_km (see _route_table) - the radius cutoff below
    then falls back to that, exactly like before this existed.

    route_from (see get_candidates) is a separate origin the pool is routed
    FROM instead of (lat, lng) - used for a mentioned-place search, where
    the radius is about the mentioned place but the drive is about the
    couple's own position. In that case the road-distance radius refinement
    above is skipped: a route measured from somewhere other than the search
    centre isn't a valid basis to re-filter that same search's radius
    against, so the pool is taken as-is (already limited to the straight-
    line radius upstream) and only routed for display.

    mention_text is the couple's own words. It does two things a distance-
    and-diversity pick can't:
    - places they NAMED ("maybe 7spice cafe, or agneey's") are pinned: always
      in the pool, first in the shortlist, exempt from the road-distance
      radius cut - they asked for them by name, so a long drive isn't a
      reason to hide them. (They still came from the straight-line radius.)
    - a stated cuisine or dish turns off the near/mid/far ring sampling. That
      sampling exists to surface far places when nothing is asked for, but at
      50km it turned "biryani" into a random handful of unrelated places
      out of thousands - with a preference, the best MATCHES should win, not
      a spread.

    meal (see meals.filter_for_meal) narrows what's left to places that suit
    it BEFORE the pool is picked, so the 8 slots aren't spent on an ice-cream
    shop at lunch. Named places are taken out first and so are exempt: if a
    partner asked for Baskin-Robbins by name they get it, whatever the hour."""
    dishes = detect_dish_keywords(mention_text) if mention_text else []
    pinned = find_named_places(mention_text, results)[: params["max_candidates"]] if mention_text else []
    pinned_ids = {c["id"] for c in pinned}
    rest = [c for c in results if c["id"] not in pinned_ids]
    if meal:
        rest, _ = filter_for_meal(rest, meal)
    stratify = params["stratify"] and not (prefer_cuisine or dishes)
    pool_room = max(ROUTE_POOL_SIZE - len(pinned), 1)
    pool = pinned + _select_diverse(
        rest, pool_room, stratify=stratify, prefer_cuisine=prefer_cuisine, dishes=dishes
    )

    origin = (route_from["lat"], route_from["lng"]) if route_from else (lat, lng)
    routes = _route_table(origin[0], origin[1], pool)
    for c in pool:
        route = routes.get(c["id"])
        if route is not None:
            c["route_km"], c["route_min"] = route

    if route_from:
        eligible = pool
    else:
        eligible = [
            c for c in pool
            if c["id"] in pinned_ids or effective_km(c) <= radius_km + RADIUS_FILTER_EPSILON_KM
        ]
    kept_pinned = [c for c in eligible if c["id"] in pinned_ids]
    others = [c for c in eligible if c["id"] not in pinned_ids]
    return kept_pinned + _select_diverse(
        others, max(params["max_candidates"] - len(kept_pinned), 0),
        stratify=stratify, prefer_cuisine=prefer_cuisine, dishes=dishes,
    )


def _pick_diverse(bucket: list[dict], count: int) -> list[dict]:
    """From one distance bucket, prefer distinct cuisines up to `count`."""
    picked: list[dict] = []
    seen_cuisine = set()
    for r in bucket:
        if len(picked) >= count:
            break
        if r["cuisine"] not in seen_cuisine:
            picked.append(r)
            seen_cuisine.add(r["cuisine"])
    for r in bucket:
        if len(picked) >= count:
            break
        if r not in picked:
            picked.append(r)
    return picked


def _select_diverse(
    results: list[dict], max_candidates: int, stratify: bool = False, prefer_cuisine: str | None = None,
    dishes: list[str] | None = None,
) -> list[dict]:
    """Nearest first, preferring a cuisine we haven't picked yet. For the
    Road Trip tier (`stratify=True`), pick across near/mid/far distance
    rings instead so far-away places genuinely show up rather than the
    nearest 8 dominating a 15km radius.

    prefer_cuisine reserves most of max_candidates for places matching it,
    filling any remainder with the normal diverse pick from what's left - so
    "we want Indian" doesn't get diluted down to one Indian place lost among
    8 diversity picks just because it wasn't the closest. Among the
    preferred, a place whose NAME carries one of `dishes` ("Nusantara
    Briyani House" for "biryani") comes ahead of a merely-nearer one with
    only the right cuisine label; otherwise nearest first."""
    if max_candidates <= 0:
        return []
    if prefer_cuisine:
        needle = prefer_cuisine.lower()
        preferred = [r for r in results if needle in r["cuisine"].lower()]
        if preferred:
            reserved = max(1, round(max_candidates * 0.75))
            preferred = sorted(
                preferred, key=lambda r: (-_dish_affinity(r, dishes) if dishes else 0, effective_km(r))
            )[:reserved]
            remaining_needed = max_candidates - len(preferred)
            if remaining_needed <= 0:
                return preferred
            rest = [r for r in results if r not in preferred]
            filler = _select_diverse(rest, remaining_needed, stratify=stratify)
            return preferred + filler

    results = sorted(results, key=effective_km)

    if stratify and len(results) >= max_candidates:
        n = len(results)
        near, mid, far = results[: n // 3], results[n // 3 : 2 * n // 3], results[2 * n // 3 :]
        # 2 near / 3 mid / 3 far for the default max_candidates=8; scaled
        # proportionally if a tier's max ever changes.
        near_n = max(1, round(max_candidates * 0.25))
        mid_n = max(1, round(max_candidates * 0.375))
        far_n = max_candidates - near_n - mid_n
        picked = _pick_diverse(near, near_n) + _pick_diverse(mid, mid_n) + _pick_diverse(far, far_n)
        if len(picked) < max_candidates:
            remaining = [r for r in results if r not in picked]
            picked += remaining[: max_candidates - len(picked)]
        return picked[:max_candidates]

    picked, seen_cuisine = [], set()
    for r in results:
        if r["cuisine"] not in seen_cuisine:
            picked.append(r)
            seen_cuisine.add(r["cuisine"])
    for r in results:
        if len(picked) >= max_candidates:
            break
        if r not in picked:
            picked.append(r)
    return picked[:max_candidates]


def list_places(
    location: dict | None,
    radius_km: float = DEFAULT_RADIUS_KM,
    cuisine: str | None = None,
    diet: str | None = None,
    limit: int = PLACES_LIST_LIMIT,
    same_country: bool = True,
) -> tuple[list[dict], str]:
    """The Explore page's uncurated browsing list - up to `limit` places,
    nearest first, with simple cuisine/diet filters. No AI involved.

    same_country behaves exactly as in get_candidates() - see its docstring.

    Raises LocationRequired with no location at all, and PlacesUnavailable
    on the same terms as get_candidates() - see each class's docstring."""
    radius_km = clamp_radius_km(radius_km)

    if not location or location.get("lat") is None or location.get("lng") is None:
        raise LocationRequired()

    lat, lng = location["lat"], location["lng"]

    overture_country = overture_covers(lat, lng)
    if overture_country is not None:
        country_iso = overture_country if same_country else None
        fetched = _fetch_overture(lat, lng, radius_km, country_iso)
        if not fetched:
            raise PlacesUnavailable("empty")
        results, source = fetched, "overture"
    else:
        country_iso = detect_country(lat, lng) if same_country else None
        params = _radius_params(radius_km)
        fetched = _fetch_for_radius(
            lat, lng, round(radius_km * 1000), params["timeout_s"], params["result_cap"], country_iso=country_iso
        )
        if fetched is None:
            raise PlacesUnavailable("fetch")
        fetched = _within_radius(fetched, radius_km)
        if not fetched:
            raise PlacesUnavailable("empty")
        results, source = fetched, "osm"

    if cuisine:
        # Comma-separated needles, matching ANY of them - the frontend's
        # cuisine filters are grouped labels (e.g. "Western" covers
        # american/burger/steak/italian/pizza/european), not single OSM
        # cuisine strings. See web/lib/decide/cuisines.ts.
        needles = [n.strip().lower() for n in cuisine.split(",") if n.strip()]
        if needles:
            results = [r for r in results if any(n in r["cuisine"].lower() for n in needles)]
    if diet:
        results = [r for r in results if r.get("dims", {}).get("diet") == diet]

    # Sort and cap by the cheap straight-line distance BEFORE routing -
    # routing every fetched place (the Overpass path alone can return up to
    # 1500, see _radius_params) in one OSRM table call would be slow and
    # likely exceed the public demo servers' own table-size limits, and
    # only the nearest `limit` are ever shown anyway.
    results = sorted(results, key=lambda r: r.get("distance_km", 999))[:limit]

    if results:
        routes = _route_table(lat, lng, results)
        for r in results:
            route = routes.get(r["id"])
            if route is not None:
                r["route_km"], r["route_min"] = route
        results = [r for r in results if effective_km(r) <= radius_km + RADIUS_FILTER_EPSILON_KM]
        results = sorted(results, key=effective_km)

    return with_colors(results), source


def _mock_candidates(lat, lng) -> list[dict]:
    out = []
    for m in MOCK_RESTAURANTS:
        c = dict(m)
        origin = (lat, lng) if lat is not None else DEMO_CENTER
        c["distance_km"] = round(haversine_km(origin[0], origin[1], c["lat"], c["lng"]), 2)
        out.append(c)
    return out


def with_colors(candidates: list[dict]) -> list[dict]:
    for i, c in enumerate(candidates):
        c["color"] = SLICE_COLORS[i % len(SLICE_COLORS)]
    return candidates


def describe_candidate(c: dict) -> str:
    """One-line description used as the engine's criteria/label text for a
    candidate. Shared by every engine so wording stays consistent."""
    tags = ", ".join(c.get("tags", []))
    route_km = c.get("route_km")
    distance = f"{route_km} km drive" if route_km is not None else f"{c.get('distance_km', '?')} km away"
    return f"{c['name']} — {c['cuisine']}, {tags}, {c['price']}, {distance}"
