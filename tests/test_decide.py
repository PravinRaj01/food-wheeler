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
from candidates import LocationRequired, PlacesUnavailable  # noqa: E402
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
    {"id": "veggie_place", "name": "Veggie Place", "cuisine": "Vegetarian", "tags": ["vegetarian"],
     "price": "$", "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
     "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "vegetarian"}},
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


@pytest.fixture(autouse=True)
def no_real_country_detection():
    # decide()'s response includes `country`, looked up via app.py's own
    # imported `detect_country` name (not candidates.detect_country - see
    # test_radius.py's fixture of the same name for why that distinction
    # matters) - without this, every test below would make a REAL Overpass
    # call. None matches production's own "couldn't determine it" fallback.
    with patch("app.detect_country", return_value=None):
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


def test_decide_biases_the_pool_toward_a_mentioned_cuisine(client, fake_manager):
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        _post(client, partner1={"text": "something indian"}, partner2={"text": "anything's fine"})
    assert mock_get.call_args.kwargs.get("prefer_cuisine") == "Indian"


def test_decide_passes_no_cuisine_preference_when_nothing_is_mentioned(client, fake_manager):
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        _post(client, partner1={"text": "anything's fine"}, partner2={"text": "sure"})
    assert mock_get.call_args.kwargs.get("prefer_cuisine") is None


def test_decide_does_not_re_detect_cuisine_preference_for_trusted_candidates_in(client, fake_manager):
    # candidates_in is only trusted with a real location (see
    # _candidates_in_still_valid) - get_candidates() must not be called at
    # all in that case, preference or not.
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    with patch("app.get_candidates") as mock_get:
        resp = _post(
            client,
            partner1={"text": "something indian"}, partner2={"text": "y"},
            location={"lat": 1.0, "lng": 1.0},
            candidates=FIXED_CANDS, source="osm",
        )
    assert resp.status_code == 200
    mock_get.assert_not_called()


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


def test_only_one_candidate_survives_skips_scoring_entirely(client, fake_manager):
    # A single candidate (everyone else excluded by a guard, or just one
    # nearby result) never reaches the engine at all - it's an automatic
    # "only_option" match at 100% confidence. The frontend's reducer skips
    # the wheel for exactly this reason (see lib/decide/machine.ts).
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "mock")):
        resp = _post(client, partner1={"text": "anything"}, partner2={"text": "anything"})
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["reason"] == "only_option"
    assert data["confidence"] == 1.0
    assert data["winner"]["id"] == "a"


def test_only_option_still_includes_dev_mode_comparison(client, fake_manager):
    # This is the bug this test guards against: the only_option branch used
    # to return early without ever checking dev_mode, so the comparison
    # panel silently never appeared even with Dev Mode on.
    _, engine_a, engine_b = fake_manager
    # A real engine scoring a single candidate trivially returns 100% for it
    # (nothing else to rank against) - FakeEngine defaults to {} instead, so
    # this has to be set explicitly for the comparison call to have anything
    # to work with.
    engine_a._probabilities = {"a": 1.0}
    engine_b._probabilities = {"a": 1.0}
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "mock")):
        resp = _post(client, partner1={"text": "anything"}, partner2={"text": "anything"}, dev_mode=True)
    data = resp.get_json()
    assert data["reason"] == "only_option"
    assert "comparison" in data
    assert "engine_a" in data["comparison"]
    assert "engine_b" in data["comparison"]


def test_only_option_dev_mode_survives_an_empty_primary_score(client, fake_manager):
    # FakeEngine's default {} probabilities stands in for a real engine
    # degenerate-scoring a single candidate - the only_option response must
    # still succeed (just without a comparison), matching the "Dev Mode can
    # never break the main response" rule the rest of this file follows.
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "mock")):
        resp = _post(client, partner1={"text": "anything"}, partner2={"text": "anything"}, dev_mode=True)
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["reason"] == "only_option"
    assert "comparison" not in data


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


def test_decide_returns_503_when_every_overpass_endpoint_fails(client, fake_manager):
    with patch("app.get_candidates", side_effect=PlacesUnavailable("fetch")):
        resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"})
    assert resp.status_code == 503
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "PLACES_UNAVAILABLE"


def test_decide_returns_no_places_nearby_when_radius_is_empty(client, fake_manager):
    with patch("app.get_candidates", side_effect=PlacesUnavailable("empty")):
        resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"})
    assert resp.status_code == 503
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "NO_PLACES_NEARBY"


def test_decide_requires_location_with_no_candidates_in(client, fake_manager):
    # No location and nothing usable echoed back from a previous round -
    # there is no demo/mock fallback any more, this is a hard stop.
    with patch("app.get_candidates", side_effect=LocationRequired()):
        resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"})
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "LOCATION_REQUIRED"


def test_decide_discards_mock_sourced_candidates_in_and_refetches(client, fake_manager):
    # This is the exact bug a real user hit: a demo/mock candidate list from
    # an earlier round (e.g. before location came online) must never ride
    # along into a later round just because the client echoed it back.
    fresh = [{**FIXED_CANDS[0], "id": "fresh"}]
    with patch("app.get_candidates", return_value=(fresh, "osm")) as mock_get:
        resp = _post(
            client,
            partner1={"text": "anything"}, partner2={"text": "anything"},
            location={"lat": 1.0, "lng": 1.0},
            candidates=FIXED_CANDS, source="mock",
        )
    mock_get.assert_called_once()
    assert resp.get_json()["winner"]["id"] == "fresh"


def test_decide_discards_candidates_in_that_drifted_outside_the_radius(client, fake_manager):
    far = [{**FIXED_CANDS[0], "lat": 50.0, "lng": 50.0}]
    fresh = [{**FIXED_CANDS[0], "id": "fresh"}]
    with patch("app.get_candidates", return_value=(fresh, "osm")) as mock_get:
        resp = _post(
            client,
            partner1={"text": "anything"}, partner2={"text": "anything"},
            location={"lat": 1.0, "lng": 1.0}, radius_km=5,
            candidates=far, source="osm",
        )
    mock_get.assert_called_once()
    assert resp.get_json()["winner"]["id"] == "fresh"


def test_decide_trusts_fresh_in_radius_candidates_in_without_refetching(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.8, "b": 0.1, "c": 0.1}
    with patch("app.get_candidates") as mock_get:
        resp = _post(
            client,
            partner1={"text": "anything"}, partner2={"text": "anything"},
            location={"lat": 1.0, "lng": 1.0}, radius_km=5,
            candidates=FIXED_CANDS, source="osm",
        )
    mock_get.assert_not_called()
    data = resp.get_json()
    assert data["status"] == "match"
    assert data["winner"]["id"] == "a"


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


def test_budget_guard_recognizes_ringgit(client, fake_manager):
    # Same numeric guard, but with RM/MYR instead of $ - the app's actual
    # userbase in Malaysia was typing "under RM30" and getting ignored.
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"c"}
        return {"c": 1.0}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "under RM20 please"}, partner2={"text": "anything"})
    assert resp.get_json()["winner"]["id"] == "c"


def test_budget_guard_low_tier_keyword_with_no_number(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"c"}  # only FIXED_CANDS entry with dims.price == "low"
        return {"c": 1.0}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "keep it cheap"}, partner2={"text": "anything"})
    assert resp.get_json()["winner"]["id"] == "c"


def test_budget_guard_high_tier_keyword_excludes_cheapest(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"a", "b"}  # excludes "c", the only "low" tier entry
        return {i: 1 / len(ids) for i in ids}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "let's treat ourselves tonight"}, partner2={"text": "anything"})
    assert resp.get_json()["status"] in ("match", "tiebreaker")


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


def test_diet_guard_filters_to_vegetarian(client, fake_manager):
    # "vegetarian" must resolve to its own dims.diet value, not fall through
    # to "none" or get conflated with "vegan" - they're different tags.
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert ids == ["veggie_place"]
        return {"veggie_place": 1.0}

    engine_a._probabilities = _predict
    with patch("app.get_candidates", return_value=(DIET_CANDS, "mock")):
        resp = _post(client, partner1={"text": "I'm vegetarian"}, partner2={"text": "anything"})
    assert resp.get_json()["winner"]["id"] == "veggie_place"


def test_negated_diet_is_not_a_requirement(client, fake_manager):
    """"no vegan" should exclude the vegan venue (the generic exclusion
    guard) but must NOT be misread as a positive diet requirement - i.e.
    it must not then narrow the remaining venues down to some diet tag."""
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        # vegan_place is gone (excluded), but everything else survives -
        # proving "no vegan" wasn't read as "requires halal" (or any other
        # single diet tag).
        assert set(ids) == {"halal_place", "veggie_place", "regular_place"}
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


# --- deterministic_tiebreak uses real driving distance when it has one -----

def test_deterministic_tiebreak_prefers_route_km_over_straight_line_distance():
    # "far_by_line" looks closer by distance_km alone, but its real route is
    # longer - the tiebreak must pick on the drive, not the crow-flies line.
    far_by_line = {"id": "a", "price": "$$", "distance_km": 1.0, "route_km": 9.0}
    near_by_road = {"id": "b", "price": "$$", "distance_km": 5.0, "route_km": 2.0}
    winner = app_module.deterministic_tiebreak([far_by_line, near_by_road])
    assert winner["id"] == "b"


def test_deterministic_tiebreak_falls_back_to_distance_km_without_a_route():
    nearer = {"id": "a", "price": "$$", "distance_km": 1.0}
    farther = {"id": "b", "price": "$$", "distance_km": 5.0}
    winner = app_module.deterministic_tiebreak([farther, nearer])
    assert winner["id"] == "a"
