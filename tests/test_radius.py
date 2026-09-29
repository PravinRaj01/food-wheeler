"""Tests for the continuous radius control (candidates.py) and the
/api/places endpoint. Radius was originally 3 fixed tiers (local/city/
roadtrip); this now accepts any value in [RADIUS_KM_MIN, RADIUS_KM_MAX] via
a slider on the frontend, with every Overpass-tuning knob derived from that
value instead of looked up from a tier name."""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402
import candidates  # noqa: E402
from engines import EngineManager  # noqa: E402
from fakes import FakeEngine  # noqa: E402

# Captured before the autouse fixture below replaces candidates.detect_country
# module-wide - the tests that exercise detect_country()'s own real logic
# call this directly instead. A plain function reference still looks up
# _query_overpass_endpoint (and everything else) in the candidates module's
# namespace at call time, so patch.object(candidates, "_query_overpass_endpoint", ...)
# still takes effect through it exactly as it would through the live name.
_real_detect_country = candidates.detect_country
# Same trick for _route_table - see no_real_routing below.
_real_route_table = candidates._route_table


def _fake_place(id_, distance_km, cuisine="Mexican"):
    return {
        "id": id_, "name": id_, "cuisine": cuisine, "tags": [], "price": "$$",
        "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": distance_km,
        "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "none"},
    }


@pytest.fixture(autouse=True)
def clear_cache():
    candidates._cache.clear()
    candidates._country_cache.clear()
    candidates._route_cache.clear()
    yield
    candidates._cache.clear()
    candidates._country_cache.clear()
    candidates._route_cache.clear()


@pytest.fixture(autouse=True)
def no_real_country_detection(monkeypatch):
    # get_candidates()/list_places() default to same_country=True, which
    # calls detect_country() before every fetch - without this, every test
    # below would make a REAL Overpass call for country detection (slow,
    # flaky, and exactly the live-network-in-tests problem this suite
    # otherwise avoids). Returning None matches this suite's existing
    # fixtures/expectations exactly: it's the same "couldn't determine it"
    # fallback get_candidates() already has to handle in production, which
    # runs country_iso=None through _fetch_overpass() - i.e. the identical
    # query every test here was already written against.
    #
    # Two names, not one: app.py did `from candidates import detect_country`,
    # which copies a reference into app.py's OWN module namespace at import
    # time - patching candidates.detect_country never touches that copy, so
    # this file's Flask-route tests (which go through app.py's
    # _country_for_response) need app.detect_country patched too.
    monkeypatch.setattr(candidates, "detect_country", lambda lat, lng, timeout_s=6: None)
    monkeypatch.setattr(app_module, "detect_country", lambda lat, lng, timeout_s=6: None)
    yield


@pytest.fixture(autouse=True)
def no_real_routing(monkeypatch):
    # get_candidates()/list_places() both call _route_table() on every
    # result pool now - without this, every test below would fire a REAL
    # OSRM request. Returning {} means "no route found for anyone", which
    # is exactly the routing-failed fallback: effective_km() falls back to
    # distance_km, matching every existing straight-line expectation in
    # this file unchanged. Tests that exercise real routing behavior call
    # _real_route_table directly instead (same two-names trick as
    # detect_country above).
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    yield


@pytest.fixture(autouse=True)
def no_real_overture_data(monkeypatch):
    # get_candidates()/list_places() check overture_covers() before ever
    # touching Overpass now - without this, the FIRST test in the whole
    # suite to call either would load the real bundled parquet file (fine,
    # just an unnecessary disk read every test file that doesn't care about
    # Overture would otherwise pay once). An empty index is exactly what a
    # dev checkout without the bundle file sees in production too (see
    # _load_overture_index's own docstring), so every existing fixture/
    # expectation in this file (all using the (1, 1) test coordinate, nowhere
    # near the real bundle's Malaysia/Singapore coverage anyway) is
    # unaffected either way. Tests that exercise the real Overture path set
    # candidates._overture_index to a fake populated dict instead.
    monkeypatch.setattr(candidates, "_overture_index", {})
    yield


# --- clamp_radius_km / _radius_params ---------------------------------------

def test_clamp_radius_km_accepts_values_in_range():
    assert candidates.clamp_radius_km(5) == 5


def test_clamp_radius_km_clamps_below_minimum():
    assert candidates.clamp_radius_km(0.1) == candidates.RADIUS_KM_MIN


def test_clamp_radius_km_clamps_above_maximum():
    assert candidates.clamp_radius_km(500) == candidates.RADIUS_KM_MAX


def test_clamp_radius_km_falls_back_to_default_on_garbage_input():
    assert candidates.clamp_radius_km("not-a-number") == candidates.DEFAULT_RADIUS_KM
    assert candidates.clamp_radius_km(None) == candidates.DEFAULT_RADIUS_KM
    assert candidates.clamp_radius_km(float("nan")) == candidates.DEFAULT_RADIUS_KM


def test_radius_params_scale_up_with_distance():
    small = candidates._radius_params(1.5)
    mid = candidates._radius_params(5)
    large = candidates._radius_params(15)
    huge = candidates._radius_params(50)

    assert small["timeout_s"] <= mid["timeout_s"] <= large["timeout_s"] <= huge["timeout_s"]
    assert small["result_cap"] <= mid["result_cap"] <= large["result_cap"] <= huge["result_cap"]
    assert huge["timeout_s"] <= 25  # capped, not unbounded
    assert huge["result_cap"] <= 1500  # capped, not unbounded


def test_radius_params_keeps_wheel_readable_regardless_of_distance():
    # The AI-curated wheel stays at a readable size even for a 50km search.
    assert candidates._radius_params(1.5)["max_candidates"] == 6
    assert candidates._radius_params(50)["max_candidates"] == 8


def test_radius_params_only_widens_small_radii():
    assert candidates._radius_params(1.5)["widen_km"] == 3.0
    assert candidates._radius_params(candidates.STRATIFY_THRESHOLD_KM)["widen_km"] is None
    assert candidates._radius_params(50)["widen_km"] is None


def test_radius_params_only_stratifies_past_the_threshold():
    assert candidates._radius_params(2)["stratify"] is False
    assert candidates._radius_params(candidates.STRATIFY_THRESHOLD_KM)["stratify"] is True
    assert candidates._radius_params(30)["stratify"] is True


# --- Overpass mirror racing --------------------------------------------------

def test_fetch_overpass_uses_first_successful_mirror():
    # Mirrors are queried in parallel now, not one after another - a mirror
    # earlier in OVERPASS_ENDPOINTS failing must not stop a later one's
    # success from being used.
    def fake_query(endpoint, query, headers, http_timeout_s):
        if endpoint == candidates.OVERPASS_ENDPOINTS[0]:
            return None
        return {"elements": [{
            "type": "node", "id": 1, "lat": 1.001, "lon": 1.001,
            "tags": {"name": "Test Place", "amenity": "restaurant"},
        }]}

    with patch.object(candidates, "_query_overpass_endpoint", side_effect=fake_query):
        results = candidates._fetch_overpass(1.0, 1.0, 1000, timeout_s=8, result_cap=50)
    assert results is not None
    assert results[0]["name"] == "Test Place"


def test_fetch_overpass_returns_none_when_every_mirror_fails():
    with patch.object(candidates, "_query_overpass_endpoint", return_value=None):
        results = candidates._fetch_overpass(1.0, 1.0, 1000, timeout_s=8, result_cap=50)
    assert results is None


def test_fetch_overpass_adds_a_country_area_filter_when_given():
    seen_queries = []

    def fake_query(endpoint, query, headers, http_timeout_s):
        seen_queries.append(query)
        return {"elements": []}

    with patch.object(candidates, "_query_overpass_endpoint", side_effect=fake_query):
        candidates._fetch_overpass(1.0, 1.0, 1000, timeout_s=8, result_cap=50, country_iso="MY")
    assert any('area["ISO3166-1:alpha2"="MY"]' in q and "(area.country)" in q for q in seen_queries)


def test_fetch_overpass_has_no_area_filter_by_default():
    seen_queries = []

    def fake_query(endpoint, query, headers, http_timeout_s):
        seen_queries.append(query)
        return {"elements": []}

    with patch.object(candidates, "_query_overpass_endpoint", side_effect=fake_query):
        candidates._fetch_overpass(1.0, 1.0, 1000, timeout_s=8, result_cap=50)
    assert all("ISO3166-1" not in q and "area.country" not in q for q in seen_queries)


# --- detect_country ------------------------------------------------------------

def test_detect_country_extracts_the_iso_code_from_the_area_element():
    def fake_query(endpoint, query, headers, http_timeout_s):
        return {"elements": [{"type": "area", "tags": {"ISO3166-1:alpha2": "my", "boundary": "administrative"}}]}

    with patch.object(candidates, "_query_overpass_endpoint", side_effect=fake_query):
        country = _real_detect_country(1.4215, 103.659)
    assert country == "MY"  # upper-cased regardless of how OSM tagged it


def test_detect_country_returns_none_when_no_mirror_has_area_data():
    with patch.object(candidates, "_query_overpass_endpoint", return_value={"elements": []}):
        country = _real_detect_country(1.4215, 103.659)
    assert country is None


def test_detect_country_returns_none_when_every_mirror_fails():
    with patch.object(candidates, "_query_overpass_endpoint", return_value=None):
        country = _real_detect_country(1.4215, 103.659)
    assert country is None


def test_detect_country_is_cached_across_calls():
    calls = []

    def fake_query(endpoint, query, headers, http_timeout_s):
        calls.append(1)
        return {"elements": [{"type": "area", "tags": {"ISO3166-1:alpha2": "MY"}}]}

    with patch.object(candidates, "_query_overpass_endpoint", side_effect=fake_query):
        first = _real_detect_country(1.4215, 103.659)
        second = _real_detect_country(1.4215, 103.659)
    assert first == second == "MY"
    # Every mirror is raced on the first call; none should fire again on the
    # second now that it's cached.
    assert len(calls) == len(candidates.OVERPASS_ENDPOINTS)


# --- _route_table (OSRM) -----------------------------------------------------

def test_route_table_returns_km_and_minutes_per_place():
    places = [{"id": "a", "lat": 1.1, "lng": 1.1}, {"id": "b", "lat": 1.2, "lng": 1.2}]

    def fake_query(base_url, coords, params):
        # index 0 is the user (distance/duration to itself, unused); indices
        # 1 and 2 are places "a" and "b" in the order passed in.
        return {"code": "Ok", "distances": [[0, 4200, 9100]], "durations": [[0, 300, 620]]}

    with patch.object(candidates, "_query_osrm_endpoint", side_effect=fake_query):
        routes = _real_route_table(1.0, 1.0, places)

    assert routes["a"] == (4.2, 5)
    assert routes["b"] == (9.1, 10)


def test_route_table_returns_none_per_place_when_every_mirror_fails():
    places = [{"id": "a", "lat": 1.1, "lng": 1.1}]
    with patch.object(candidates, "_query_osrm_endpoint", return_value=None):
        routes = _real_route_table(1.0, 1.0, places)
    assert routes == {"a": None}


def test_route_table_is_cached_per_grid_cell_and_place():
    places = [{"id": "a", "lat": 1.1, "lng": 1.1}]

    with patch.object(
        candidates, "_query_osrm_endpoint",
        return_value={"code": "Ok", "distances": [[0, 1000]], "durations": [[0, 60]]},
    ) as mock_query:
        first = _real_route_table(1.0, 1.0, places)
        calls_after_first = mock_query.call_count
        second = _real_route_table(1.0, 1.0, places)

    assert first == second == {"a": (1.0, 1)}
    assert calls_after_first >= 1
    # Nothing should reach the mirrors again on the second call - it's
    # served entirely from the grid-cell+place-id cache.
    assert mock_query.call_count == calls_after_first


def test_route_table_puts_the_user_at_coordinate_zero():
    seen_coords = []

    def fake_query(base_url, coords, params):
        seen_coords.append(coords)
        return None

    with patch.object(candidates, "_query_osrm_endpoint", side_effect=fake_query):
        _real_route_table(1.0, 2.0, [{"id": "a", "lat": 3.0, "lng": 4.0}])

    assert seen_coords[0].startswith("2.0,1.0;")  # lng,lat for the user, first


def test_effective_km_prefers_route_km_when_present():
    assert candidates.effective_km({"distance_km": 5.0, "route_km": 8.2}) == 8.2


def test_effective_km_falls_back_to_distance_km_without_a_route():
    assert candidates.effective_km({"distance_km": 5.0}) == 5.0


def test_describe_candidate_says_drive_when_a_route_is_known():
    c = {"name": "X", "cuisine": "Thai", "tags": [], "price": "$$", "distance_km": 3.0, "route_km": 4.1}
    assert "4.1 km drive" in candidates.describe_candidate(c)


def test_describe_candidate_falls_back_to_distance_km_away_without_a_route():
    c = {"name": "X", "cuisine": "Thai", "tags": [], "price": "$$", "distance_km": 3.0}
    assert "3.0 km away" in candidates.describe_candidate(c)


# --- Overture Maps bundle -----------------------------------------------------

def _fake_overture_place(id_, name, lat, lng, country="MY", category="restaurant", address=""):
    return {"id": id_, "name": name, "lat": lat, "lng": lng, "country": country, "category": category, "address": address}


def _install_fake_overture_index(monkeypatch, places):
    index = {}
    for p in places:
        index.setdefault(candidates._overture_grid_cell(p["lat"], p["lng"]), []).append(p)
    monkeypatch.setattr(candidates, "_overture_index", index)


def test_overture_covers_returns_the_nearest_places_country(monkeypatch):
    _install_fake_overture_index(monkeypatch, [_fake_overture_place("a", "A", 1.42, 103.66, country="MY")])
    assert candidates.overture_covers(1.4215, 103.659) == "MY"


def test_overture_covers_returns_none_when_nothing_is_within_search_radius(monkeypatch):
    _install_fake_overture_index(monkeypatch, [_fake_overture_place("a", "A", 10.0, 50.0, country="MY")])
    assert candidates.overture_covers(1.4215, 103.659) is None


def test_overture_covers_returns_none_when_the_index_is_empty(monkeypatch):
    monkeypatch.setattr(candidates, "_overture_index", {})
    assert candidates.overture_covers(1.4215, 103.659) is None


def test_fetch_overture_filters_by_country_and_radius(monkeypatch):
    places = [
        _fake_overture_place("near_my", "Near MY", 1.42, 103.66, country="MY"),
        _fake_overture_place("near_sg", "Near SG", 1.42, 103.66, country="SG"),
        _fake_overture_place("far", "Far", 5.0, 110.0, country="MY"),
    ]
    _install_fake_overture_index(monkeypatch, places)
    results = candidates._fetch_overture(1.4215, 103.659, radius_km=5, country_iso="MY")
    assert [c["id"] for c in results] == ["near_my"]


def test_fetch_overture_without_a_country_filter_includes_every_country(monkeypatch):
    places = [
        _fake_overture_place("near_my", "Near MY", 1.42, 103.66, country="MY"),
        _fake_overture_place("near_sg", "Near SG", 1.42, 103.66, country="SG"),
    ]
    _install_fake_overture_index(monkeypatch, places)
    results = candidates._fetch_overture(1.4215, 103.659, radius_km=5, country_iso=None)
    assert {c["id"] for c in results} == {"near_my", "near_sg"}


def test_fetch_overture_returns_the_candidate_dict_shape(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("a", "7 Spice Indian Cuisine", 1.42, 103.66,
                              country="MY", category="indian_restaurant", address="Jalan X"),
    ])
    results = candidates._fetch_overture(1.4215, 103.659, radius_km=5, country_iso=None)
    assert len(results) == 1
    c = results[0]
    assert c["id"] == "a"
    assert c["cuisine"] == "Indian"
    assert c["dims"]["diet"] == "none"
    assert c["dims"]["spice"] == "hot"
    assert c["address"] == "Jalan X"
    assert isinstance(c["distance_km"], float)


def test_overture_dims_map_diet_categories():
    assert candidates._dims_from_overture_category("halal_restaurant")["diet"] == "halal"
    assert candidates._dims_from_overture_category("vegan_restaurant")["diet"] == "vegan"
    assert candidates._dims_from_overture_category("vegetarian_restaurant")["diet"] == "vegetarian"
    assert candidates._dims_from_overture_category("restaurant")["diet"] == "none"


def test_overture_dims_map_service_and_price():
    assert candidates._dims_from_overture_category("fast_food_restaurant")["service"] == "fast_food"
    assert candidates._dims_from_overture_category("restaurant")["service"] == "sit_down"
    assert candidates._price_from_overture_category("fast_food_restaurant") == "~$"
    assert candidates._price_from_overture_category("indian_restaurant") == "~$$"


def test_overture_cuisine_label_matches_the_frontends_needle_table():
    # web/lib/decide/cuisines.ts's "Malay" filter needle is "malay" - the raw
    # Overture category is "malaysian_restaurant", so the humanized label
    # must still contain that substring for Explore's cuisine filter to work.
    place = {**_fake_overture_place("a", "Some Malaysian Place", 1.0, 1.0, category="malaysian_restaurant"),
             "distance_km": 1.0}
    c = candidates._overture_to_candidate(place)
    assert "malay" in c["cuisine"].lower()


# --- name-based cuisine inference and free-text cuisine preference ----------

def test_infer_cuisine_from_name_detects_indian_keywords():
    assert candidates._infer_cuisine_from_name("Nasi Kandar Line Clear", "Restaurant") == "Indian"
    assert candidates._infer_cuisine_from_name("Restoran Briyani King", "Restaurant") == "Indian"


def test_infer_cuisine_from_name_leaves_an_already_specific_cuisine_alone():
    assert candidates._infer_cuisine_from_name("Nasi Kandar Somewhere", "Chinese") == "Chinese"


def test_infer_cuisine_from_name_leaves_unmatched_names_alone():
    assert candidates._infer_cuisine_from_name("Joe's Diner", "Restaurant") == "Restaurant"


def test_detect_cuisine_preference_finds_a_mentioned_cuisine():
    assert candidates.detect_cuisine_preference("something indian please") == "Indian"
    assert candidates.detect_cuisine_preference("sushi tonight") == "Japanese"


def test_detect_cuisine_preference_returns_none_when_nothing_matches():
    assert candidates.detect_cuisine_preference("anything is fine") is None


def test_select_diverse_reserves_slots_for_the_preferred_cuisine():
    results = (
        [_fake_place(f"indian{i}", 10 + i, cuisine="Indian") for i in range(2)]
        + [_fake_place(f"other{i}", i, cuisine=f"C{i}") for i in range(6)]
    )
    picked = candidates._select_diverse(results, max_candidates=6, prefer_cuisine="Indian")
    assert sum(1 for c in picked if c["cuisine"] == "Indian") == 2
    assert len(picked) == 6


def test_select_diverse_falls_back_to_normal_pick_without_any_preferred_matches():
    results = [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(6)]
    picked = candidates._select_diverse(results, max_candidates=6, prefer_cuisine="Indian")
    assert len(picked) == 6


# --- get_candidates ----------------------------------------------------------

def test_get_candidates_uses_the_given_radius_in_meters():
    calls = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        calls.append(radius_m)
        return [_fake_place(f"p{i}", i * 0.5, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert source == "osm"
    assert calls[0] == 5000


def test_get_candidates_passes_the_detected_country_into_the_fetch():
    seen_country = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        seen_country.append(country_iso)
        return [_fake_place(f"p{i}", i * 0.5, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "detect_country", return_value="MY"), \
         patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert seen_country[0] == "MY"


def test_get_candidates_same_country_false_never_calls_detect_country():
    with patch.object(candidates, "detect_country") as mock_detect, \
         patch.object(candidates, "_fetch_overpass", return_value=[_fake_place("a", 1.0)]):
        candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5, same_country=False)

    mock_detect.assert_not_called()


def test_get_candidates_falls_back_to_unfiltered_when_country_cant_be_detected():
    # detect_country() returning None (couldn't determine it) must still
    # search - never LocationRequired/PlacesUnavailable just because
    # detection itself failed.
    seen_country = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        seen_country.append(country_iso)
        return [_fake_place("a", 1.0)]

    with patch.object(candidates, "detect_country", return_value=None), \
         patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert seen_country[0] is None
    assert source == "osm"
    assert len(cands) == 1


def test_get_candidates_extends_past_the_old_15km_cap():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(12)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=30)

    assert mock_fetch.call_args[0][2] == 30000  # radius_m
    assert len(cands) <= 8


def test_out_of_range_radius_clamps_instead_of_erroring():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=9999)

    assert mock_fetch.call_args_list[0][0][2] == round(candidates.RADIUS_KM_MAX * 1000)


def test_small_radius_widens_on_sparse_results():
    call_radii = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        call_radii.append(radius_m)
        # First (1.5km) call returns too few; second (3km, the 2x widen) returns enough.
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(2 if radius_m == 1500 else 8)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=1.5)

    assert call_radii == [1500, 3000]
    assert source == "osm"


def test_large_radius_does_not_retry_wider_on_sparse_results():
    call_radii = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        call_radii.append(radius_m)
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(2)]  # always sparse

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=15)

    # Past WIDEN_THRESHOLD_KM there's no second, wider attempt - a sparse
    # result at 15km means a sparse area, not a bad first guess. The 2 real
    # results found are still returned, not swapped for mock data - a real
    # location never silently falls back to demo places.
    assert call_radii == [15000]
    assert source == "osm"
    assert len(cands) == 2


def test_get_candidates_raises_when_every_endpoint_fails():
    with patch.object(candidates, "_fetch_overpass", return_value=None):
        with pytest.raises(candidates.PlacesUnavailable) as exc_info:
            candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)
    assert exc_info.value.kind == "fetch"


def test_get_candidates_raises_when_real_fetch_is_empty():
    with patch.object(candidates, "_fetch_overpass", return_value=[]):
        with pytest.raises(candidates.PlacesUnavailable) as exc_info:
            candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)
    assert exc_info.value.kind == "empty"


def test_get_candidates_requires_a_real_location():
    # No demo mode any more - no location at all is a hard stop, not a
    # silent NYC mock list.
    with pytest.raises(candidates.LocationRequired):
        candidates.get_candidates(None, radius_km=5)


def test_get_candidates_requires_lat_and_lng_together():
    with pytest.raises(candidates.LocationRequired):
        candidates.get_candidates({"lat": 1.0}, radius_km=5)


def test_get_candidates_filters_out_of_radius_results():
    # Overpass's own `around` filter should already enforce this server
    # side, but the defensive client-side filter must catch a stray result
    # outside the requested radius too - this is the exact bug that put a
    # "15317 km away" mock result in front of a real user.
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("near", 2.0), _fake_place("far", 200.0)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)
    assert [c["id"] for c in cands] == ["near"]


def test_get_candidates_sets_route_km_and_route_min_when_routing_succeeds():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(3)]

    def fake_route_table(lat, lng, places):
        return {p["id"]: (p["distance_km"] + 1.0, 10) for p in places}

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", side_effect=fake_route_table):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert cands  # sanity: routing/radius math above didn't drop everyone
    assert all(c["route_km"] == c["distance_km"] + 1.0 and c["route_min"] == 10 for c in cands)


def test_get_candidates_drops_a_place_whose_real_route_exceeds_the_radius():
    # "near" looks in-radius by straight line, but its real drive (a river,
    # a highway with no nearby crossing) is actually longer than the radius
    # - it must be dropped even though distance_km alone would have kept it.
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("near", 2.0, cuisine="A"), _fake_place("also_near", 3.0, cuisine="B")]

    def fake_route_table(lat, lng, places):
        return {"near": (9.0, 20), "also_near": (4.0, 8)}

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", side_effect=fake_route_table):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert [c["id"] for c in cands] == ["also_near"]


def test_get_candidates_keeps_straight_line_distance_when_routing_fails():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("a", 2.0)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", return_value={}):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert cands[0]["distance_km"] == 2.0
    assert "route_km" not in cands[0]


def test_get_candidates_uses_overture_when_the_location_is_covered(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place(f"p{i}", f"Place {i}", 1.4215 + i * 0.001, 103.659, country="MY")
        for i in range(3)
    ])
    with patch.object(candidates, "_fetch_overpass") as mock_overpass:
        cands, source = candidates.get_candidates({"lat": 1.4215, "lng": 103.659}, radius_km=5)

    assert source == "overture"
    mock_overpass.assert_not_called()
    assert len(cands) == 3


def test_get_candidates_falls_back_to_overpass_outside_the_bundle():
    # no_real_overture_data leaves the index empty - (1, 1) isn't covered by
    # the real bundle either, but this makes the fallback explicit either way.
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("a", 1.0)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)
    assert source == "osm"


def test_get_candidates_overture_same_country_excludes_other_countries(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("my1", "MY Place", 1.4215, 103.659, country="MY"),
        _fake_overture_place("sg1", "SG Place", 1.4215, 103.659, country="SG"),
    ])
    cands, source = candidates.get_candidates({"lat": 1.4215, "lng": 103.659}, radius_km=5, same_country=True)
    assert source == "overture"
    assert [c["id"] for c in cands] == ["my1"]


def test_get_candidates_overture_cross_border_includes_every_country(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("my1", "MY Place", 1.4215, 103.659, country="MY"),
        _fake_overture_place("sg1", "SG Place", 1.4215, 103.659, country="SG"),
    ])
    cands, source = candidates.get_candidates({"lat": 1.4215, "lng": 103.659}, radius_km=5, same_country=False)
    assert {c["id"] for c in cands} == {"my1", "sg1"}


def test_get_candidates_overture_raises_empty_when_nothing_is_in_the_requested_radius(monkeypatch):
    # ~8.7km away - overture_covers' 100km search still finds it (so this
    # location IS treated as covered by the bundle), but it's well outside
    # the requested radius, so the actual fetch must come back empty.
    _install_fake_overture_index(monkeypatch, [_fake_overture_place("far", "Far", 1.5, 103.659, country="MY")])
    with pytest.raises(candidates.PlacesUnavailable) as exc_info:
        candidates.get_candidates({"lat": 1.4215, "lng": 103.659}, radius_km=1)
    assert exc_info.value.kind == "empty"


def test_get_candidates_overture_applies_prefer_cuisine(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("indian1", "Indian One", 1.4215, 103.659, country="MY", category="indian_restaurant"),
        _fake_overture_place("indian2", "Indian Two", 1.4216, 103.659, country="MY", category="indian_restaurant"),
        _fake_overture_place("chinese", "Chinese", 1.4217, 103.659, country="MY", category="chinese_restaurant"),
        _fake_overture_place("thai", "Thai", 1.4218, 103.659, country="MY", category="thai_restaurant"),
    ])
    cands, source = candidates.get_candidates(
        {"lat": 1.4215, "lng": 103.659}, radius_km=5, prefer_cuisine="Indian"
    )
    assert sum(1 for c in cands if c["cuisine"] == "Indian") == 2


def test_list_places_requires_a_real_location():
    with pytest.raises(candidates.LocationRequired):
        candidates.list_places(None, radius_km=5)


def test_list_places_raises_when_every_endpoint_fails():
    with patch.object(candidates, "_fetch_overpass", return_value=None):
        with pytest.raises(candidates.PlacesUnavailable) as exc_info:
            candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)
    assert exc_info.value.kind == "fetch"


def test_list_places_raises_when_real_fetch_is_empty():
    with patch.object(candidates, "_fetch_overpass", return_value=[]):
        with pytest.raises(candidates.PlacesUnavailable) as exc_info:
            candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)
    assert exc_info.value.kind == "empty"


def test_roadtrip_stratifies_across_distance_rings():
    # 9 results spread 0..8.9 km apart, so the far ring genuinely has
    # far-away entries that a plain nearest-N selection would drop.
    results = [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(9)]
    picked = candidates._select_diverse(results, max_candidates=8, stratify=True)
    distances = sorted(r["distance_km"] for r in picked)
    assert max(distances) >= 6  # at least one far-ring pick survived
    assert min(distances) <= 2  # at least one near-ring pick survived


# --- list_places --------------------------------------------------------------

def test_list_places_sorts_by_route_km_not_straight_line_distance():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("straight_near", 1.0, cuisine="A"), _fake_place("straight_far", 2.0, cuisine="B")]

    def fake_route_table(lat, lng, places):
        # Route distances invert the straight-line order.
        return {"straight_near": (4.0, 9), "straight_far": (1.0, 3)}

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", side_effect=fake_route_table):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)

    assert [p["id"] for p in places] == ["straight_far", "straight_near"]


def test_list_places_drops_a_place_whose_real_route_exceeds_the_radius():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("far_by_road", 1.0, cuisine="A"), _fake_place("near_by_road", 4.0, cuisine="B")]

    def fake_route_table(lat, lng, places):
        # Straight-line makes "far_by_road" look closest, but its real
        # route is actually the longer, out-of-radius one.
        return {"far_by_road": (8.0, 15), "near_by_road": (2.0, 5)}

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", side_effect=fake_route_table):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)

    assert [p["id"] for p in places] == ["near_by_road"]


def test_list_places_falls_back_to_distance_km_when_routing_fails():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap, country_iso=None):
        return [_fake_place("a", 2.0), _fake_place("b", 3.0)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch), \
         patch.object(candidates, "_route_table", return_value={}):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)

    assert [p["id"] for p in places] == ["a", "b"]
    assert all("route_km" not in p for p in places)


def test_list_places_filters_by_cuisine_and_diet():
    results = [
        _fake_place("thai1", 1.0, cuisine="Thai"),
        _fake_place("mex1", 2.0, cuisine="Mexican"),
        _fake_place("italian1", 3.0, cuisine="Italian"),
    ]
    results[1]["dims"]["diet"] = "halal"

    # radius_km=5 so the within-radius filter doesn't clip any of the fake
    # 1-3km distances before cuisine/diet filtering runs.
    with patch.object(candidates, "_fetch_for_radius", return_value=results):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, radius_km=5, cuisine="thai")
    assert [p["id"] for p in places] == ["thai1"]

    with patch.object(candidates, "_fetch_for_radius", return_value=results):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, radius_km=5, diet="halal")
    assert [p["id"] for p in places] == ["mex1"]


def test_list_places_cuisine_filter_matches_any_comma_separated_needle():
    # A frontend group like "Western" sends several needles at once (see
    # web/lib/decide/cuisines.ts) - matching ANY of them, not requiring the
    # whole comma-joined string as one literal substring.
    results = [
        _fake_place("thai1", 1.0, cuisine="Thai"),
        _fake_place("american1", 2.0, cuisine="American"),
        _fake_place("italian1", 3.0, cuisine="Italian"),
    ]
    with patch.object(candidates, "_fetch_for_radius", return_value=results):
        places, source = candidates.list_places(
            {"lat": 1, "lng": 1}, radius_km=5, cuisine="western,american,italian"
        )
    assert {p["id"] for p in places} == {"american1", "italian1"}


def test_list_places_returns_real_results_even_when_sparse():
    # A single real nearby place is still real - it must never be swapped
    # for the mock set just because it's the only one found.
    with patch.object(candidates, "_fetch_for_radius", return_value=[_fake_place("only-one", 0.1)]):
        places, source = candidates.list_places({"lat": 1, "lng": 1})
    assert source == "osm"
    assert [p["id"] for p in places] == ["only-one"]


def test_list_places_respects_limit():
    results = [_fake_place(f"p{i}", i * 0.1, cuisine=f"C{i}") for i in range(80)]
    with patch.object(candidates, "_fetch_for_radius", return_value=results):
        places, _ = candidates.list_places({"lat": 1, "lng": 1}, limit=10)
    assert len(places) == 10


def test_list_places_accepts_a_large_radius():
    results = [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(10)]
    with patch.object(candidates, "_fetch_for_radius", return_value=results) as mock_fetch:
        candidates.list_places({"lat": 1, "lng": 1}, radius_km=40)
    assert mock_fetch.call_args[0][2] == 40000  # radius_m


def test_list_places_passes_the_detected_country_into_the_fetch():
    results = [_fake_place("a", 1.0)]
    with patch.object(candidates, "detect_country", return_value="MY"), \
         patch.object(candidates, "_fetch_for_radius", return_value=results) as mock_fetch:
        candidates.list_places({"lat": 1, "lng": 1}, radius_km=5)
    assert mock_fetch.call_args.kwargs["country_iso"] == "MY"


def test_list_places_same_country_false_never_calls_detect_country():
    results = [_fake_place("a", 1.0)]
    with patch.object(candidates, "detect_country") as mock_detect, \
         patch.object(candidates, "_fetch_for_radius", return_value=results):
        candidates.list_places({"lat": 1, "lng": 1}, radius_km=5, same_country=False)
    mock_detect.assert_not_called()


def test_list_places_uses_overture_when_the_location_is_covered(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("a", "Place A", 1.4215, 103.659, country="MY", category="indian_restaurant"),
    ])
    with patch.object(candidates, "_fetch_overpass") as mock_overpass:
        places, source = candidates.list_places({"lat": 1.4215, "lng": 103.659}, radius_km=5)

    assert source == "overture"
    mock_overpass.assert_not_called()
    assert places[0]["cuisine"] == "Indian"


def test_list_places_overture_respects_cuisine_and_diet_filters(monkeypatch):
    _install_fake_overture_index(monkeypatch, [
        _fake_overture_place("indian", "Indian Place", 1.4215, 103.659, country="MY", category="indian_restaurant"),
        _fake_overture_place("halal", "Halal Place", 1.4216, 103.659, country="MY", category="halal_restaurant"),
    ])
    by_cuisine, _ = candidates.list_places({"lat": 1.4215, "lng": 103.659}, radius_km=5, cuisine="indian")
    assert [p["id"] for p in by_cuisine] == ["indian"]

    by_diet, _ = candidates.list_places({"lat": 1.4215, "lng": 103.659}, radius_km=5, diet="halal")
    assert [p["id"] for p in by_diet] == ["halal"]


# --- Flask routes ------------------------------------------------------------

@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def test_places_route_returns_json(client):
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")):
        resp = client.get("/api/places?lat=1&lng=1&radius_km=5")
    data = resp.get_json()
    assert data["source"] == "osm"
    assert data["radius_km"] == 5
    assert data["places"][0]["id"] == "a"


def test_places_route_without_location_returns_400(client):
    resp = client.get("/api/places")
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "LOCATION_REQUIRED"


def test_places_route_rejects_garbage_radius_gracefully(client):
    # Mocked so this only tests radius parsing, not live Overpass behavior
    # for lat=1/lng=1 (open ocean) - that coupling was incidental and made
    # the test depend on real network access.
    with patch("app.list_places", return_value=([], "mock")) as mock_list:
        resp = client.get("/api/places?lat=1&lng=1&radius_km=not-a-number")
    assert resp.status_code == 200
    assert resp.get_json()["radius_km"] == candidates.DEFAULT_RADIUS_KM
    assert mock_list.call_args.kwargs["radius_km"] == candidates.DEFAULT_RADIUS_KM


def test_places_route_clamps_an_out_of_range_radius(client):
    with patch("app.list_places", return_value=([], "mock")) as mock_list:
        resp = client.get("/api/places?lat=1&lng=1&radius_km=9999")
    assert resp.status_code == 200
    assert resp.get_json()["radius_km"] == candidates.RADIUS_KM_MAX
    assert mock_list.call_args.kwargs["radius_km"] == candidates.RADIUS_KM_MAX


def test_places_route_returns_503_on_fetch_failure(client):
    with patch("app.list_places", side_effect=candidates.PlacesUnavailable("fetch")):
        resp = client.get("/api/places?lat=1&lng=1&radius_km=5")
    assert resp.status_code == 503
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "PLACES_UNAVAILABLE"


def test_places_route_returns_no_places_nearby_when_empty(client):
    with patch("app.list_places", side_effect=candidates.PlacesUnavailable("empty")):
        resp = client.get("/api/places?lat=1&lng=1&radius_km=5")
    assert resp.status_code == 503
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "NO_PLACES_NEARBY"


def test_decide_passes_radius_km_through(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(fixed_cands, "osm")) as mock_get:
        client.post(
            "/api/decide",
            json={"partner1": {"text": "x"}, "partner2": {"text": "y"}, "radius_km": 25},
        )
    assert mock_get.call_args.kwargs["radius_km"] == 25


def test_decide_defaults_radius_km_when_missing(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(fixed_cands, "osm")) as mock_get:
        client.post("/api/decide", json={"partner1": {"text": "x"}, "partner2": {"text": "y"}})
    assert mock_get.call_args.kwargs["radius_km"] == candidates.DEFAULT_RADIUS_KM


def test_decide_defaults_to_same_country(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(fixed_cands, "osm")) as mock_get:
        client.post("/api/decide", json={"partner1": {"text": "x"}, "partner2": {"text": "y"}})
    assert mock_get.call_args.kwargs["same_country"] is True


def test_decide_cross_border_true_disables_same_country(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(fixed_cands, "osm")) as mock_get:
        client.post(
            "/api/decide",
            json={"partner1": {"text": "x"}, "partner2": {"text": "y"}, "cross_border": True},
        )
    assert mock_get.call_args.kwargs["same_country"] is False


def test_decide_response_includes_country(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(fixed_cands, "osm")), \
         patch("app.detect_country", return_value="MY"):
        resp = client.post(
            "/api/decide",
            json={"partner1": {"text": "x"}, "partner2": {"text": "y"}, "location": {"lat": 1.4, "lng": 103.6}},
        )
    assert resp.get_json()["country"] == "MY"


def test_places_route_defaults_to_same_country(client):
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")) as mock_list:
        client.get("/api/places?lat=1&lng=1&radius_km=5")
    assert mock_list.call_args.kwargs["same_country"] is True


def test_places_route_cross_border_1_disables_same_country(client):
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")) as mock_list:
        client.get("/api/places?lat=1&lng=1&radius_km=5&cross_border=1")
    assert mock_list.call_args.kwargs["same_country"] is False


def test_places_route_cross_border_0_does_not_disable_same_country(client):
    # The classic Flask/Python trap: bool("0") is True. ?cross_border=0 must
    # not accidentally turn cross-border ON.
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")) as mock_list:
        client.get("/api/places?lat=1&lng=1&radius_km=5&cross_border=0")
    assert mock_list.call_args.kwargs["same_country"] is True


def test_places_route_response_includes_country(client):
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")), \
         patch("app.detect_country", return_value="SG"):
        resp = client.get("/api/places?lat=1.35&lng=103.8&radius_km=5")
    assert resp.get_json()["country"] == "SG"
