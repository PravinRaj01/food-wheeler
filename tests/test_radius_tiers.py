"""Tests for radius tiers (candidates.py) and the /api/places endpoint."""
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


def test_get_candidates_uses_tier_radius_and_params():
    calls = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        calls.append((radius_m, timeout_s, result_cap))
        return [_fake_place(f"p{i}", i * 0.5, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_tier="city")

    assert source == "osm"
    assert calls[0] == (5000, 8, 300)
    assert len(cands) <= candidates.MAX_CANDIDATES_BY_TIER["city"]


def test_get_candidates_roadtrip_uses_larger_radius():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(12)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_tier="roadtrip")

    assert mock_fetch.call_args[0][2] == 15000  # radius_m
    assert len(cands) <= candidates.MAX_CANDIDATES_BY_TIER["roadtrip"]


def test_unknown_tier_falls_back_to_local():
    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(10)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch) as mock_fetch:
        candidates.get_candidates({"lat": 1, "lng": 1}, radius_tier="bogus")

    assert mock_fetch.call_args_list[0][0][2] == candidates.RADIUS_TIERS_M["local"]


def test_local_tier_widens_on_sparse_results():
    call_radii = []

    def fake_fetch(lat, lng, radius_m, timeout_s, result_cap):
        call_radii.append(radius_m)
        # First (1.5km) call returns too few; second (3km) returns enough.
        return [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(2 if radius_m == 1500 else 8)]

    with patch.object(candidates, "_fetch_overpass", side_effect=fake_fetch):
        cands, source = candidates.get_candidates({"lat": 1, "lng": 1}, radius_tier="local")

    assert call_radii == [1500, 3000]
    assert source == "osm"


def test_roadtrip_stratifies_across_distance_rings():
    # 9 results spread 0..8.9 km apart, so the far ring genuinely has
    # far-away entries that a plain nearest-N selection would drop.
    results = [_fake_place(f"p{i}", i, cuisine=f"C{i}") for i in range(9)]
    picked = candidates._select_diverse(results, max_candidates=8, stratify=True)
    distances = sorted(r["distance_km"] for r in picked)
    assert max(distances) >= 6  # at least one far-ring pick survived
    assert min(distances) <= 2  # at least one near-ring pick survived


def test_list_places_filters_by_cuisine_and_diet():
    # At least MIN_RESULTS_BEFORE_FALLBACK entries, or list_places correctly
    # falls back to mock data (same rule get_candidates uses).
    results = [
        _fake_place("thai1", 1.0, cuisine="Thai"),
        _fake_place("mex1", 2.0, cuisine="Mexican"),
        _fake_place("italian1", 3.0, cuisine="Italian"),
    ]
    results[1]["dims"]["diet"] = "halal"

    with patch.object(candidates, "_fetch_for_tier", return_value=results):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, cuisine="thai")
    assert [p["id"] for p in places] == ["thai1"]

    with patch.object(candidates, "_fetch_for_tier", return_value=results):
        places, source = candidates.list_places({"lat": 1, "lng": 1}, diet="halal")
    assert [p["id"] for p in places] == ["mex1"]


def test_list_places_falls_back_to_mock_on_sparse_results():
    with patch.object(candidates, "_fetch_for_tier", return_value=[_fake_place("only-one", 0.1)]):
        places, source = candidates.list_places({"lat": 1, "lng": 1})
    assert source == "mock"
    assert len(places) == len(candidates.MOCK_RESTAURANTS)


def test_list_places_respects_limit():
    results = [_fake_place(f"p{i}", i * 0.1, cuisine=f"C{i}") for i in range(80)]
    with patch.object(candidates, "_fetch_for_tier", return_value=results):
        places, _ = candidates.list_places({"lat": 1, "lng": 1}, limit=10)
    assert len(places) == 10


# --- Flask route -----------------------------------------------------------

@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def test_places_route_returns_json(client):
    with patch("app.list_places", return_value=([_fake_place("a", 1.0)], "osm")):
        resp = client.get("/api/places?lat=1&lng=1&tier=city")
    data = resp.get_json()
    assert data["source"] == "osm"
    assert data["tier"] == "city"
    assert data["places"][0]["id"] == "a"


def test_places_route_without_location_uses_mock(client):
    resp = client.get("/api/places")
    data = resp.get_json()
    assert data["source"] == "mock"


def test_places_route_rejects_unknown_tier_gracefully(client):
    resp = client.get("/api/places?lat=1&lng=1&tier=bogus")
    assert resp.status_code == 200
    assert resp.get_json()["tier"] == "local"


def test_decide_passes_radius_tier_through(client):
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
            json={"partner1": {"text": "x"}, "partner2": {"text": "y"}, "radius_tier": "roadtrip"},
        )
    assert mock_get.call_args.kwargs["radius_tier"] == "roadtrip"
