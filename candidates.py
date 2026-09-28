"""
Restaurant candidate sourcing for The Food-Wheeler.

Tries the free OSM Overpass API for real nearby venues; falls back to a
fixed set of mock venues ("demo mode") when location is unavailable, the
lookup fails, or too few real venues are nearby.
"""
import math
import time

import requests

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
CACHE_TTL_S = 600  # 10 minutes
MIN_RESULTS_BEFORE_WIDEN = 5
MIN_RESULTS_BEFORE_FALLBACK = 3

# Radius tiers ("the Expand Radius flex" - Phase 4). "local" widens to a
# second, larger radius if too few results come back nearby; "city" and
# "roadtrip" query their full radius directly since a sparse result at 5-15km
# usually just means a sparse area, not a bad first guess.
RADIUS_TIERS_M = {"local": 1500, "city": 5000, "roadtrip": 15000}
WIDEN_RADIUS_M = {"local": 3000}
MAX_CANDIDATES_BY_TIER = {"local": 6, "city": 8, "roadtrip": 8}
# A wider radius can genuinely return hundreds of venues in a dense city;
# capping the Overpass response keeps the query fast and the payload small.
OVERPASS_RESULT_CAP = {"local": 200, "city": 300, "roadtrip": 400}
OVERPASS_TIMEOUT_S_BY_TIER = {"local": 6, "city": 8, "roadtrip": 10}
DEFAULT_RADIUS_TIER = "local"
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
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            resp = requests.post(
                endpoint, data={"data": query}, headers=headers, timeout=timeout_s
            )
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


def _fetch_for_tier(lat: float, lng: float, radius_m: int, radius_tier: str) -> list[dict] | None:
    cache_key = (round(lat, 3), round(lng, 3), radius_m)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_S:
        return cached[1]
    results = _fetch_overpass(
        lat, lng, radius_m,
        timeout_s=OVERPASS_TIMEOUT_S_BY_TIER[radius_tier],
        result_cap=OVERPASS_RESULT_CAP[radius_tier],
    )
    if results is not None:
        _cache[cache_key] = (time.time(), results)
    return results


def get_candidates(location: dict | None, radius_tier: str = DEFAULT_RADIUS_TIER) -> tuple[list[dict], str]:
    """Returns (candidates, source) where source is 'osm' or 'mock'. The AI
    decision engines see only this curated, capped list - see list_places()
    for the uncurated Explore browsing list."""
    radius_tier = radius_tier if radius_tier in RADIUS_TIERS_M else DEFAULT_RADIUS_TIER
    if not location or location.get("lat") is None or location.get("lng") is None:
        return _mock_candidates(None, None), "mock"

    lat, lng = location["lat"], location["lng"]
    radii = [RADIUS_TIERS_M[radius_tier]]
    if radius_tier in WIDEN_RADIUS_M:
        radii.append(WIDEN_RADIUS_M[radius_tier])

    max_candidates = MAX_CANDIDATES_BY_TIER[radius_tier]
    stratify = radius_tier == "roadtrip"

    for i, radius_m in enumerate(radii):
        results = _fetch_for_tier(lat, lng, radius_m, radius_tier)
        if results is not None and len(results) >= MIN_RESULTS_BEFORE_FALLBACK:
            if len(results) >= MIN_RESULTS_BEFORE_WIDEN or i == len(radii) - 1:
                return _select_diverse(results, max_candidates, stratify=stratify), "osm"

    return _mock_candidates(lat, lng), "mock"


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
    radius_tier: str = DEFAULT_RADIUS_TIER,
    cuisine: str | None = None,
    diet: str | None = None,
    limit: int = PLACES_LIST_LIMIT,
) -> tuple[list[dict], str]:
    """The Explore page's uncurated browsing list - up to `limit` places,
    nearest first, with simple cuisine/diet filters. No AI involved."""
    radius_tier = radius_tier if radius_tier in RADIUS_TIERS_M else DEFAULT_RADIUS_TIER

    if not location or location.get("lat") is None or location.get("lng") is None:
        results, source = _mock_candidates(None, None), "mock"
    else:
        lat, lng = location["lat"], location["lng"]
        radius_m = RADIUS_TIERS_M[radius_tier]
        fetched = _fetch_for_tier(lat, lng, radius_m, radius_tier)
        if fetched is not None and len(fetched) >= MIN_RESULTS_BEFORE_FALLBACK:
            results, source = fetched, "osm"
        else:
            results, source = _mock_candidates(lat, lng), "mock"

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
