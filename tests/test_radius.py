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


def _fake_place(id_, distance_km, cuisine="Mexican"):
    return {
        "id": id_, "name": id_, "cuisine": cuisine, "tags": [], "price": "$$",
        "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": distance_km,
        "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "none"},
    }


@pytest.fixture(autouse=True)
def clear_cache():
    candidates._cache.clear()
    yield
    candidates._cache.clear()


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
    assert huge["result_cap"] <= 600  # capped, not unbounded


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


# --- get_candidates ----------------------------------------------------------

def test_get_candidates_uses_the_given_radius_in_meters():
    calls = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        calls.append(radius_m)
        return [_fake_place(f"p{i}", i * 0.5, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)

    assert source == "osm"
    assert calls[0] == 5000


def test_get_candidates_extends_past_the_old_15km_cap():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(12)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=30)

    assert mock_fetch.call_args[0][2] == 30000  # radius_m
    assert len(cands) <= 8


def test_out_of_range_radius_clamps_instead_of_erroring():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=9999)

    assert mock_fetch.call_args_list[0][0][2] == round(candidates.RADIUS_KM_MAX * 1000)


def test_small_radius_widens_on_sparse_results():
    call_radii = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        call_radii.append(radius_m)
        # First (1.5km) call returns too few; second (3km, the 2x widen) returns enough.
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(2 if radius_m == 1500 else 8)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=1.5)

    assert call_radii == [1500, 3000]
    assert source == "osm"


def test_large_radius_does_not_retry_wider_on_sparse_results():
    call_radii = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
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
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        return [_fake_place("near", 2.0), _fake_place("far", 200.0)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_km=5)
    assert [c["id"] for c in cands] == ["near"]


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
