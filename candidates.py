"""
Restaurant candidate sourcing for The Food-Wheeler.

Tries the free OSM Overpass API for real nearby venues. The mock venue set
("demo mode") is used ONLY when no location was given at all - if the
caller supplied a real location, a fetch failure or a genuinely empty
radius is surfaced as PlacesUnavailable instead of silently substituting
demo places at the wrong end of the world (see PlacesUnavailable below).
"""
import math
import time

import requests

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
CACHE_TTL_S = 600  # 10 minutes
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
    within the radius). Only ever raised when location is not None; with no
    location, returning the mock set is the intended, silent demo-mode
    behavior, not an error."""

    def __init__(self, kind: str):
        self.kind = kind
        super().__init__(kind)

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

_cache: dict[tuple[float, float, int], tuple[float, list[dict]]] = {}

# Demo-mode venues, clustered around a fixed "demo city" point so the map
# still looks realistic when geolocation is unavailable.
DEMO_CENTER = (40.7306, -73.9866)  # a spot in NYC, used only as the demo anchor
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


def _fetch_overpass(lat: float, lng: float, radius_m: int, timeout_s: int, result_cap: int) -> list[dict] | None:
    query = f"""
    [out:json][timeout:{timeout_s}];
    (
      node["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:{radius_m},{lat},{lng});
      way["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](around:{radius_m},{lat},{lng});
    );
    out center tags {result_cap};
    """
    headers = {"User-Agent": "food-wheeler/1.0 (educational prototype)"}
    # The HTTP timeout is a few seconds looser than the query's own
    # [timeout:] so Overpass gets the chance to reply with its own timeout
    # error (still caught below) instead of us cutting the socket first.
    http_timeout_s = timeout_s + 5
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            resp = requests.post(
                endpoint, data={"data": query}, headers=headers, timeout=http_timeout_s
            )
            # 429 (rate limited) and 504 (gateway timeout) are exactly what
            # a public, shared Overpass mirror does under load - falling
            # through to the next mirror is the right response, not a hard
            # failure. raise_for_status() raises HTTPError for both (a
            # RequestException subclass), so the except below already
            # covers them the same way as a connection failure.
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError):
            continue

        results = []
        for i, el in enumerate(data.get("elements", [])):
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
    return None


def _fetch_for_radius(lat: float, lng: float, radius_m: int, timeout_s: int, result_cap: int) -> list[dict] | None:
    cache_key = (round(lat, 3), round(lng, 3), radius_m)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_S:
        return cached[1]
    results = _fetch_overpass(lat, lng, radius_m, timeout_s=timeout_s, result_cap=result_cap)
    if results is not None:
        _cache[cache_key] = (time.time(), results)
    return results


def _within_radius(results: list[dict], radius_km: float) -> list[dict]:
    return [r for r in results if r.get("distance_km", 0) <= radius_km + RADIUS_FILTER_EPSILON_KM]


def get_candidates(location: dict | None, radius_km: float = DEFAULT_RADIUS_KM) -> tuple[list[dict], str]:
    """Returns (candidates, source) where source is 'osm' or 'mock'. The AI
    decision engines see only this curated, capped list - see list_places()
    for the uncurated Explore browsing list.

    Raises PlacesUnavailable if a real location was given but nothing
    usable came back - see that class's docstring for why this must never
    silently substitute the mock set in that case."""
    radius_km = clamp_radius_km(radius_km)
    if not location or location.get("lat") is None or location.get("lng") is None:
        return _mock_candidates(None, None), "mock"

    lat, lng = location["lat"], location["lng"]
    params = _radius_params(radius_km)
    radii_km = [radius_km] + ([params["widen_km"]] if params["widen_km"] else [])

    any_fetch_succeeded = False
    best_results: list[dict] | None = None
    for i, r_km in enumerate(radii_km):
        results = _fetch_for_radius(lat, lng, round(r_km * 1000), params["timeout_s"], params["result_cap"])
        if results is None:
            continue
        any_fetch_succeeded = True
        results = _within_radius(results, r_km)
        # A wider retry isn't guaranteed to return a superset (same result
        # cap, different Overpass ordering), so keep whichever attempt
        # found the most rather than just the last one tried.
        if best_results is None or len(results) > len(best_results):
            best_results = results
        if len(results) >= MIN_RESULTS_BEFORE_FALLBACK:
            if len(results) >= MIN_RESULTS_BEFORE_WIDEN or i == len(radii_km) - 1:
                return _select_diverse(results, params["max_candidates"], stratify=params["stratify"]), "osm"

    if not any_fetch_succeeded:
        raise PlacesUnavailable("fetch")
    if not best_results:
        raise PlacesUnavailable("empty")
    # 1-2 real results is still real - return them rather than jumping to
    # the mock set (which is what put NYC restaurants 15,000km away in
    # front of a real user).
    return best_results, "osm"


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
    results = sorted(results, key=lambda r: r.get("distance_km", 999))

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
) -> tuple[list[dict], str]:
    """The Explore page's uncurated browsing list - up to `limit` places,
    nearest first, with simple cuisine/diet filters. No AI involved.

    Raises PlacesUnavailable on the same terms as get_candidates() - see
    that function's docstring."""
    radius_km = clamp_radius_km(radius_km)

    if not location or location.get("lat") is None or location.get("lng") is None:
        results, source = _mock_candidates(None, None), "mock"
    else:
        lat, lng = location["lat"], location["lng"]
        params = _radius_params(radius_km)
        fetched = _fetch_for_radius(lat, lng, round(radius_km * 1000), params["timeout_s"], params["result_cap"])
        if fetched is None:
            raise PlacesUnavailable("fetch")
        fetched = _within_radius(fetched, radius_km)
        if not fetched:
            raise PlacesUnavailable("empty")
        results, source = fetched, "osm"

    if cuisine:
        needle = cuisine.lower()
        results = [r for r in results if needle in r["cuisine"].lower()]
    if diet:
        results = [r for r in results if r.get("dims", {}).get("diet") == diet]

    results = sorted(results, key=lambda r: r.get("distance_km", 999))[:limit]
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
    return f"{c['name']} — {c['cuisine']}, {tags}, {c['price']}, {c.get('distance_km', '?')} km away"
