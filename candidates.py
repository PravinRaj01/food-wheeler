"""
Restaurant candidate sourcing for The Food-Wheeler.

Tries the free OSM Overpass API for real nearby venues. There is no demo
mode in production any more: get_candidates()/list_places() require a real
location and raise LocationRequired without one. A fetch failure or a
genuinely empty radius is surfaced as PlacesUnavailable, never silently
substituted with demo places at the wrong end of the world (see
PlacesUnavailable below). MOCK_RESTAURANTS survives only as fixture data for
tests and scripts/compare_engines.py.
"""
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

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
    result_cap = round(max(200, min(600, 150 + radius_km * 9)))
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
        cuisine = (tags.get("cuisine") or amenity).replace("_", " ").title()
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
    location: dict | None, radius_km: float = DEFAULT_RADIUS_KM, same_country: bool = True
) -> tuple[list[dict], str]:
    """Returns (candidates, source) where source is 'osm' or 'mock'. The AI
    decision engines see only this curated, capped list - see list_places()
    for the uncurated Explore browsing list.

    same_country=True (the default) keeps results inside whichever country
    the given location is in - see detect_country(). If detection fails,
    this silently searches unfiltered rather than returning nothing.

    Raises LocationRequired with no location at all, and PlacesUnavailable
    if a real location was given but nothing usable came back - see each
    class's docstring."""
    radius_km = clamp_radius_km(radius_km)
    if not location or location.get("lat") is None or location.get("lng") is None:
        raise LocationRequired()

    lat, lng = location["lat"], location["lng"]
    country_iso = detect_country(lat, lng) if same_country else None
    params = _radius_params(radius_km)
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
    final = _finalize_candidates(lat, lng, best_results, best_radius_km, params)
    if not final:
        raise PlacesUnavailable("empty")
    return final, "osm"


def _finalize_candidates(
    lat: float, lng: float, results: list[dict], radius_km: float, params: dict
) -> list[dict]:
    """distance_km is only ever the cheap Overpass prefilter - a road route
    is never shorter than the straight line, so it's a safe upper bound, but
    it can meaningfully OVERSTATE how close a place actually is (a river, a
    highway with no nearby crossing, a gated community). This takes a
    diverse pool of the straight-line survivors, looks up real driving
    distance/time for the whole pool in one OSRM call, drops anything
    that's actually outside the radius by road, and only THEN makes the
    final diverse pick - so radius_km is a promise about the drive, not
    just the distance as the crow flies.

    If routing fails outright, every place in the pool just keeps its
    straight-line distance_km (see _route_table) - the radius cutoff below
    then falls back to that, exactly like before this existed."""
    pool = _select_diverse(results, ROUTE_POOL_SIZE, stratify=params["stratify"])
    routes = _route_table(lat, lng, pool)
    for c in pool:
        route = routes.get(c["id"])
        if route is not None:
            c["route_km"], c["route_min"] = route
    in_radius = [c for c in pool if effective_km(c) <= radius_km + RADIUS_FILTER_EPSILON_KM]
    return _select_diverse(in_radius, params["max_candidates"], stratify=params["stratify"])


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


def _select_diverse(results: list[dict], max_candidates: int, stratify: bool = False) -> list[dict]:
    """Nearest first, preferring a cuisine we haven't picked yet. For the
    Road Trip tier (`stratify=True`), pick across near/mid/far distance
    rings instead so far-away places genuinely show up rather than the
    nearest 8 dominating a 15km radius."""
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
    # routing all of `result_cap` (up to 600) places in one OSRM table call
    # would be slow and likely exceed the public demo servers' own
    # table-size limits, and only the nearest `limit` are ever shown anyway.
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
