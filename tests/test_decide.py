"""
Tests for the /api/decide branching logic. Uses FakeEngine (tests/fakes.py)
injected via a throwaway EngineManager, so these run fast and never touch
torch/laya/gliner2. Overpass is mocked out too.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402
from engines import EngineManager  # noqa: E402
from fakes import FakeEngine  # noqa: E402

FIXED_CANDS = [
    {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": ["spicy", "patio"],
     "price": "$$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
     "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    {"id": "b", "name": "Thai Orchid", "cuisine": "Thai", "tags": ["spicy", "indoor"],
     "price": "$$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 1.0,
     "dims": {"service": "sit_down", "spice": "hot", "setting": "indoor", "price": "mid", "diet": "none"}},
    {"id": "c", "name": "Burger Barn", "cuisine": "American", "tags": ["burgers", "fast_food"],
     "price": "$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.3,
     "dims": {"service": "fast_food", "spice": "mild", "setting": "indoor", "price": "low", "diet": "none"}},
]

DIET_CANDS = [
    {"id": "halal_place", "name": "Halal Place", "cuisine": "Middle Eastern", "tags": ["halal"],
     "price": "$$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.4,
     "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "halal"}},
    {"id": "vegan_place", "name": "Vegan Place", "cuisine": "Vegan", "tags": ["vegan"],
     "price": "$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.6,
     "dims": {"service": "fast_food", "spice": "mild", "setting": "indoor", "price": "low", "diet": "vegan"}},
    {"id": "regular_place", "name": "Regular Place", "cuisine": "American", "tags": [],
     "price": "$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.2,
     "dims": {"service": "fast_food", "spice": "mild", "setting": "indoor", "price": "low", "diet": "none"}},
]


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


@pytest.fixture
def fake_manager():
    engine_a = FakeEngine("engine_a", label="Engine A", est_ram_mb=100)
    engine_b = FakeEngine("engine_b", label="Engine B", est_ram_mb=100)
    mgr = EngineManager([engine_a, engine_b], default_id="engine_a")
    with patch.object(app_module, "manager", mgr):
        yield mgr, engine_a, engine_b


@pytest.fixture(autouse=True)
def mock_candidates():
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "mock")):
        yield


def _post(client, **body):
    return client.post("/api/decide", json=body)


def test_empty_input_rejected(client, fake_manager):
    resp = _post(client, partner1={"text": ""}, partner2={"text": ""})
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "EMPTY_INPUT"


def test_input_too_long_rejected(client, fake_manager):
    resp = _post(client, partner1={"text": "x" * 501}, partner2={"text": ""})
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "INPUT_TOO_LONG"


def test_high_confidence_match(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    resp = _post(client, partner1={"text": "spicy patio"}, partner2={"text": "spicy"})
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["reason"] == "confident"
    assert data["winner"]["id"] == "a"
    assert data["confidence"] == 0.80
    assert data["engine"]["id"] == "engine_a"


def test_low_confidence_triggers_tiebreaker(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.45, "b": 0.40, "c": 0.15}
    resp = _post(client, partner1={"text": "something"}, partner2={"text": "something else"})
    data = resp.get_json()
    assert data["status"] == "tiebreaker"
    assert data["reason"] == "low_confidence"
    # a and b differ on 'setting' (patio vs indoor) - that should be the question.
    assert data["question"]["id"] == "setting"


def test_exact_tie_detected(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.50, "b": 0.49, "c": 0.01}
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"})
    data = resp.get_json()
    assert data["status"] == "tiebreaker"
    assert data["reason"] == "exact_tie"


def test_round_cap_forces_fair_spin(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.45, "b": 0.40, "c": 0.15}
    resp = _post(
        client,
        partner1={"text": "x"}, partner2={"text": "y"},
        round=2,
        tiebreakers=[
            {"question_id": "setting", "answer": "patio", "text": "Outdoor patio seating"},
            {"question_id": "service", "answer": "sit_down", "text": "Sit-down table service"},
        ],
    )
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["reason"] == "fair_spin"
    assert set(data["wheel_ids"]) <= {"a", "b"}


def test_budget_guard_excludes_expensive_option(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"c"}
        return {"c": 1.0}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "under $20 please"}, partner2={"text": "anything"})
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["winner"]["id"] == "c"


def test_exclusion_guard_removes_burgers(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert "c" not in ids
        return {i: 1 / len(ids) for i in ids}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "no burgers please"}, partner2={"text": "anything"})
    assert resp.get_json()["status"] in ("match", "tiebreaker")


def test_diet_guard_filters_to_halal(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert ids == ["halal_place"]
        return {"halal_place": 1.0}

    engine_a._probabilities = _predict
    with patch("app.get_candidates", return_value=(DIET_CANDS, "mock")):
        resp = _post(client, partner1={"text": "we need halal"}, partner2={"text": "anything"})
    assert resp.get_json()["winner"]["id"] == "halal_place"


def test_negated_diet_is_not_a_requirement(client, fake_manager):
    """"no vegan" should exclude the vegan venue (the generic exclusion
    guard) but must NOT be misread as a positive diet requirement - i.e.
    it must not then narrow the remaining venues down to some diet tag."""
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        # vegan_place is gone (excluded), but halal_place and regular_place
        # both survive - proving "no vegan" wasn't read as "requires halal".
        assert set(ids) == {"halal_place", "regular_place"}
        return {i: 1 / len(ids) for i in ids}

    engine_a._probabilities = _predict
    with patch("app.get_candidates", return_value=(DIET_CANDS, "mock")):
        resp = _post(client, partner1={"text": "no vegan please"}, partner2={"text": "anything"})
    assert resp.get_json()["status"] in ("match", "tiebreaker")


def test_unknown_engine_returns_400(client, fake_manager):
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, engine="bogus")
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "UNKNOWN_ENGINE"


def test_unavailable_engine_returns_503(client):
    engine_a = FakeEngine("engine_a", available=False, reason="no gpu")
    mgr = EngineManager([engine_a], default_id="engine_a")
    with patch.object(app_module, "manager", mgr):
        resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, engine="engine_a")
    assert resp.status_code == 503
    data = resp.get_json()
    assert data["code"] == "ENGINE_UNAVAILABLE"
    assert data["message"] == "no gpu"


def test_secondary_engine_failure_falls_back_to_default(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.9, "b": 0.05, "c": 0.05}
    engine_b._raise_error = True
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, engine="engine_b")
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["engine"]["id"] == "engine_a"
    assert data["engine"]["fallback_from"] == "engine_b"


def test_default_engine_failure_returns_model_error(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._raise_error = True
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"})
    assert resp.status_code == 500
    assert resp.get_json()["code"] == "MODEL_ERROR"


# --- Dev Mode -----------------------------------------------------------

def test_dev_mode_includes_comparison(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    engine_b._probabilities = {"a": 0.20, "b": 0.70, "c": 0.10}
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True)
    data = resp.get_json()
    assert data["status"] == "match"
    comparison = data["comparison"]
    assert comparison["engine_a"]["primary"] is True
    assert comparison["engine_b"]["primary"] is False
    assert comparison["engine_b"]["top_id"] == "b"
    assert comparison["engine_b"]["agrees"] is False  # winner is "a", engine_b's top is "b"


def test_dev_mode_secondary_failure_does_not_break_response(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    engine_b._raise_error = True
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True)
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["comparison"]["engine_b"]["error"] == "ENGINE_UNAVAILABLE"


def test_dev_mode_ignored_when_disallowed(client, fake_manager, monkeypatch):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    monkeypatch.setattr(app_module, "DEV_MODE_ALLOWED", False)
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True)
    data = resp.get_json()
    assert "comparison" not in data
