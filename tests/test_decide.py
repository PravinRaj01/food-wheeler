"""
Tests for the /api/decide branching logic. Uses FakeEngine (tests/fakes.py)
injected via a throwaway EngineManager, so these run fast and never touch
torch/laya/gliner2. Overpass is mocked out too.
"""
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402
from candidates import LocationRequired, PlacesUnavailable  # noqa: E402
from engines import EngineManager  # noqa: E402
from fakes import FakeEngine  # noqa: E402

# Captured before the no_real_geocoding autouse fixture below replaces
# app.resolve_location_mention module-wide - the tests that exercise its own
# real logic call this directly instead. Same trick as test_radius.py's
# _real_detect_country/_real_route_table: a plain function reference still
# looks up app.requests.get in the module's own namespace at call time, so
# patch("app.requests.get", ...) still takes effect through it.
_real_resolve_location_mention = app_module.resolve_location_mention

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


@pytest.fixture(autouse=True)
def no_real_geocoding():
    # None of today's fixture texts happen to trip extract_location_mentions
    # (verified by hand), but this is a defensive backstop against a REAL
    # Nominatim call all the same, matching the same "never hit a live
    # service from this suite" convention as detect_country/routing/Overture
    # above. Tests that exercise the real geocoding path patch
    # app.resolve_location_mention (or requests.get underneath it) directly.
    with patch("app.resolve_location_mention", return_value=None):
        yield


@pytest.fixture(autouse=True)
def clear_geocode_cache():
    app_module._geocode_cache.clear()
    yield
    app_module._geocode_cache.clear()


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


def test_decide_reads_a_dish_as_a_cuisine_preference(client, fake_manager):
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        _post(client, partner1={"text": "biryani, maybe agneey's"}, partner2={"text": "chicken biryani"})
    assert mock_get.call_args.kwargs.get("prefer_cuisine") == "Indian"


def test_decide_hands_the_couples_words_to_the_shortlist_for_named_places(client, fake_manager):
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        _post(client, partner1={"text": "maybe 7spice or agneey's"}, partner2={"text": "chicken biryani"})
    mention_text = mock_get.call_args.kwargs.get("mention_text")
    assert "7spice" in mention_text and "chicken biryani" in mention_text


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


# --- location mentions ("near Mid Valley") ----------------------------------

def test_extract_location_mentions_detects_a_near_phrase():
    assert app_module.extract_location_mentions("something near Mid Valley please") == ["mid valley"]


def test_extract_location_mentions_detects_somewhere_in_phrasing():
    assert app_module.extract_location_mentions("somewhere in Bukit Indah") == ["bukit indah"]


def test_extract_location_mentions_ignores_a_mood_not_a_place():
    assert app_module.extract_location_mentions("I'm in the mood for something spicy") == []


def test_extract_location_mentions_ignores_a_mentioned_cuisine():
    assert app_module.extract_location_mentions("in indian food") == []


def test_extract_location_mentions_ignores_a_mentioned_diet():
    assert app_module.extract_location_mentions("something in halal") == []


def test_extract_location_mentions_ignores_a_budget_word():
    assert app_module.extract_location_mentions("in cheap") == []


def test_extract_location_mentions_returns_empty_for_plain_text():
    assert app_module.extract_location_mentions("anything is fine") == []


def test_extract_location_mentions_caps_at_two_words():
    # "Sunway Pyramid Mall" is cut to "sunway pyramid" - a documented
    # trade-off (see the function's own docstring), not a bug: Nominatim's
    # fuzzy search usually still resolves the truncated phrase.
    assert app_module.extract_location_mentions("near Sunway Pyramid Mall tonight") == ["sunway pyramid"]


def test_same_place_true_within_threshold():
    a = {"name": "A", "lat": 1.0, "lng": 1.0}
    b = {"name": "B", "lat": 1.001, "lng": 1.0}
    assert app_module._same_place(a, b) is True


def test_same_place_false_beyond_threshold():
    a = {"name": "A", "lat": 1.0, "lng": 1.0}
    b = {"name": "B", "lat": 1.1, "lng": 1.0}
    assert app_module._same_place(a, b) is False


def test_resolve_location_mention_rejects_a_result_too_far_away():
    far_result = [{"lat": "50.0", "lon": "50.0", "display_name": "Nowhere Near"}]
    with patch("app.requests.get") as mock_get:
        mock_get.return_value.raise_for_status = lambda: None
        mock_get.return_value.json.return_value = far_result
        place = _real_resolve_location_mention("nowhere near", 1.0, 1.0, "MY")
    assert place is None


def test_resolve_location_mention_accepts_a_result_within_range():
    near_result = [{"lat": "1.05", "lon": "1.05", "display_name": "Mid Valley, Some City"}]
    with patch("app.requests.get") as mock_get:
        mock_get.return_value.raise_for_status = lambda: None
        mock_get.return_value.json.return_value = near_result
        place = _real_resolve_location_mention("mid valley", 1.0, 1.0, "MY")
    assert place == {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}


def test_resolve_location_mention_returns_none_on_request_failure():
    with patch("app.requests.get", side_effect=app_module.requests.RequestException("boom")):
        place = _real_resolve_location_mention("mid valley", 1.0, 1.0, "MY")
    assert place is None


def test_decide_uses_a_single_mentioned_place_as_the_search_center(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    mentioned = {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}
    with patch("app.resolve_location_mention", return_value=mentioned), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "overture")) as mock_get:
        _post(
            client,
            partner1={"text": "something near Mid Valley"}, partner2={"text": "anything's fine"},
            location={"lat": 1.0, "lng": 1.0},
        )
    # search_center adds a "mentioned_by" key on top of the resolved place,
    # so this checks the coordinates rather than exact dict equality.
    fetch_loc = mock_get.call_args.args[0]
    assert (fetch_loc["lat"], fetch_loc["lng"]) == (mentioned["lat"], mentioned["lng"])
    assert mock_get.call_args.kwargs.get("route_from") == {"lat": 1.0, "lng": 1.0}


def test_decide_ignores_a_mention_close_to_the_user(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    close_mention = {"name": "Right Here Mall", "lat": 1.001, "lng": 1.0}
    with patch("app.resolve_location_mention", return_value=close_mention), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "overture")) as mock_get:
        _post(
            client,
            partner1={"text": "something near Right Here Mall"}, partner2={"text": "anything's fine"},
            location={"lat": 1.0, "lng": 1.0},
        )
    assert mock_get.call_args.args[0] == {"lat": 1.0, "lng": 1.0}
    assert mock_get.call_args.kwargs.get("route_from") is None


def test_decide_asks_a_question_when_partners_mention_different_places(client, fake_manager):
    place1 = {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}
    place2 = {"name": "Bukit Indah", "lat": 1.2, "lng": 1.2}
    with patch("app.resolve_location_mention", side_effect=[place1, place2]), \
         patch("app.get_candidates") as mock_get:
        resp = _post(
            client,
            partner1={"text": "near Mid Valley"}, partner2={"text": "somewhere in Bukit Indah"},
            location={"lat": 1.0, "lng": 1.0},
        )
    data = resp.get_json()
    assert data["status"] == "tiebreaker"
    assert data["reason"] == "location_conflict"
    assert data["question"]["id"] == "location"
    labels = {opt["label"] for opt in data["question"]["options"]}
    assert labels == {"Mid Valley", "Bukit Indah"}
    mock_get.assert_not_called()


def test_decide_resolves_the_conflict_once_answered(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    place1 = {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}
    place2 = {"name": "Bukit Indah", "lat": 1.2, "lng": 1.2}
    with patch("app.resolve_location_mention", side_effect=[place1, place2]), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "overture")) as mock_get:
        _post(
            client,
            partner1={"text": "near Mid Valley"}, partner2={"text": "somewhere in Bukit Indah"},
            location={"lat": 1.0, "lng": 1.0},
            round=1,
            tiebreakers=[{"question_id": "location", "answer": "p2", "text": "Near Bukit Indah"}],
        )
    fetch_loc = mock_get.call_args.args[0]
    assert (fetch_loc["lat"], fetch_loc["lng"]) == (place2["lat"], place2["lng"])


def test_decide_spin_anyway_defaults_to_partner_ones_mention(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    place1 = {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}
    place2 = {"name": "Bukit Indah", "lat": 1.2, "lng": 1.2}
    with patch("app.resolve_location_mention", side_effect=[place1, place2]), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "overture")) as mock_get:
        _post(
            client,
            partner1={"text": "near Mid Valley"}, partner2={"text": "somewhere in Bukit Indah"},
            location={"lat": 1.0, "lng": 1.0},
            round=2,  # "Spin anyway" without ever answering the location question
        )
    fetch_loc = mock_get.call_args.args[0]
    assert (fetch_loc["lat"], fetch_loc["lng"]) == (place1["lat"], place1["lng"])


def test_decide_response_includes_search_center(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    mentioned = {"name": "Mid Valley", "lat": 1.05, "lng": 1.05}
    with patch("app.resolve_location_mention", return_value=mentioned), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "overture")):
        resp = _post(
            client,
            partner1={"text": "something near Mid Valley"}, partner2={"text": "anything's fine"},
            location={"lat": 1.0, "lng": 1.0},
        )
    data = resp.get_json()
    assert data["search_center"]["name"] == "Mid Valley"
    assert data["search_center"]["mentioned_by"] == "p1"


def test_decide_omits_search_center_when_nothing_is_mentioned(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    resp = _post(
        client,
        partner1={"text": "anything's fine"}, partner2={"text": "sure"},
        location={"lat": 1.0, "lng": 1.0},
    )
    data = resp.get_json()
    assert data["search_center"] is None


def test_returns_the_full_ranking_best_first(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    resp = _post(client, partner1={"text": "spicy patio"}, partner2={"text": "spicy"})
    data = resp.get_json()
    assert data["status"] == "ranked"
    assert data["engine"]["id"] == "engine_a"
    # b and c tie on score - the nearer drive (c, 0.3km) is listed first.
    assert [r["id"] for r in data["ranking"]] == ["a", "c", "b"]
    assert data["ranking"][0]["probability"] == 0.80
    assert "winner" not in data and "reason" not in data


def test_equal_scores_are_ordered_by_distance_never_picked_for_the_couple(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.50, "b": 0.50, "c": 0.0}
    data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}).get_json()
    assert [r["id"] for r in data["ranking"]] == ["a", "b", "c"]  # a is 0.5km, b is 1.0km


def test_a_clear_favourite_offers_no_question(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    data = _post(client, partner1={"text": "spicy patio"}, partner2={"text": "spicy"}).get_json()
    assert data["question"] is None


def test_only_one_candidate_survives_skips_scoring_entirely(client, fake_manager):
    # A single candidate (everyone else excluded by a guard, or just one
    # nearby result) never reaches the engine at all - a ranked list of one.
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "mock")):
        resp = _post(client, partner1={"text": "anything"}, partner2={"text": "anything"})
    data = resp.get_json()
    assert data["status"] == "ranked"
    assert [r["id"] for r in data["ranking"]] == ["a"]
    assert data["ranking"][0]["probability"] == 1.0
    assert data["question"] is None


def test_only_option_still_includes_dev_mode_comparison(client, fake_manager):
    # This is the bug this test guards against: the single-candidate branch
    # used to return early without ever checking dev_mode, so the comparison
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
    assert len(data["ranking"]) == 1
    assert "comparison" in data
    assert "engine_a" in data["comparison"]
    assert "engine_b" in data["comparison"]


def test_only_option_dev_mode_survives_an_empty_primary_score(client, fake_manager):
    # FakeEngine's default {} probabilities stands in for a real engine
    # degenerate-scoring a single candidate - the response must still
    # succeed (just without a comparison), matching the "Dev Mode can
    # never break the main response" rule the rest of this file follows.
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "mock")):
        resp = _post(client, partner1={"text": "anything"}, partner2={"text": "anything"}, dev_mode=True)
    data = resp.get_json()
    assert resp.status_code == 200
    assert len(data["ranking"]) == 1
    assert "comparison" not in data


def test_close_top_two_with_a_separating_dimension_offers_a_question(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.45, "b": 0.40, "c": 0.15}
    data = _post(client, partner1={"text": "something"}, partner2={"text": "something else"}).get_json()
    assert data["status"] == "ranked"
    # a and b differ on 'setting' (patio vs indoor) - that should be the question.
    assert data["question"]["id"] == "setting"
    # ...but it's only offered: the full ranking is there regardless.
    assert [r["id"] for r in data["ranking"]] == ["a", "b", "c"]


def test_close_top_two_with_nothing_separating_them_offers_no_question(client, fake_manager):
    _, engine_a, _ = fake_manager
    twin = {**FIXED_CANDS[0], "id": "twin", "name": "Casa Fuego Two"}
    engine_a._probabilities = {"a": 0.45, "twin": 0.44}
    with patch("app.get_candidates", return_value=([FIXED_CANDS[0], twin], "osm")):
        data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}).get_json()
    assert data["question"] is None
    assert len(data["ranking"]) == 2


def test_no_question_is_offered_once_the_round_cap_is_reached(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.45, "b": 0.40, "c": 0.15}
    data = _post(
        client,
        partner1={"text": "x"}, partner2={"text": "y"},
        round=2,
        tiebreakers=[
            {"question_id": "setting", "answer": "patio", "text": "Outdoor patio seating"},
            {"question_id": "service", "answer": "sit_down", "text": "Sit-down table service"},
        ],
    ).get_json()
    assert data["status"] == "ranked"
    assert data["question"] is None
    assert data["rounds_left"] == 0


def test_an_answered_question_is_never_asked_again(client, fake_manager):
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.45, "b": 0.40, "c": 0.15}
    data = _post(
        client,
        partner1={"text": "x"}, partner2={"text": "y"},
        round=1,
        tiebreakers=[{"question_id": "setting", "answer": "patio", "text": "Outdoor patio seating"}],
    ).get_json()
    assert data["status"] == "ranked"
    assert data["question"] is None or data["question"]["id"] != "setting"


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
    assert resp.get_json()["ranking"][0]["id"] == "fresh"


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
    assert resp.get_json()["ranking"][0]["id"] == "fresh"


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
    assert data["status"] == "ranked"
    assert data["ranking"][0]["id"] == "a"


def test_budget_guard_excludes_expensive_option(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"c"}
        return {"c": 1.0}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "under $20 please"}, partner2={"text": "anything"})
    data = resp.get_json()
    assert data["status"] == "ranked"
    assert data["ranking"][0]["id"] == "c"


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
    assert resp.get_json()["ranking"][0]["id"] == "c"


def test_budget_guard_low_tier_keyword_with_no_number(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"c"}  # only FIXED_CANDS entry with dims.price == "low"
        return {"c": 1.0}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "keep it cheap"}, partner2={"text": "anything"})
    assert resp.get_json()["ranking"][0]["id"] == "c"


def test_budget_guard_high_tier_keyword_excludes_cheapest(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert set(ids) == {"a", "b"}  # excludes "c", the only "low" tier entry
        return {i: 1 / len(ids) for i in ids}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "let's treat ourselves tonight"}, partner2={"text": "anything"})
    assert resp.get_json()["status"] == "ranked"


def test_exclusion_guard_removes_burgers(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert "c" not in ids
        return {i: 1 / len(ids) for i in ids}

    engine_a._probabilities = _predict
    resp = _post(client, partner1={"text": "no burgers please"}, partner2={"text": "anything"})
    assert resp.get_json()["status"] == "ranked"


def test_diet_guard_filters_to_halal(client, fake_manager):
    _, engine_a, _ = fake_manager

    def _predict(calls):
        _, ids, _ = calls[-1]
        assert ids == ["halal_place"]
        return {"halal_place": 1.0}

    engine_a._probabilities = _predict
    with patch("app.get_candidates", return_value=(DIET_CANDS, "mock")):
        resp = _post(client, partner1={"text": "we need halal"}, partner2={"text": "anything"})
    assert resp.get_json()["ranking"][0]["id"] == "halal_place"


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
    assert resp.get_json()["ranking"][0]["id"] == "veggie_place"


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
    assert resp.get_json()["status"] == "ranked"


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
    assert data["status"] == "ranked"
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
    assert data["status"] == "ranked"
    comparison = data["comparison"]
    assert comparison["engine_a"]["primary"] is True
    assert comparison["engine_b"]["primary"] is False
    assert comparison["engine_b"]["top_id"] == "b"
    assert comparison["engine_b"]["agrees"] is False  # winner is "a", engine_b's top is "b"


def test_dev_mode_secondary_engine_carries_its_own_full_ranking(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    engine_b._probabilities = {"a": 0.20, "b": 0.70, "c": 0.10}
    data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True).get_json()

    other = data["comparison"]["engine_b"]["ranking"]
    # Same row shape as the main ranking, ordered by THIS engine's scores.
    assert [r["id"] for r in other] == ["b", "a", "c"]
    assert [r["probability"] for r in other] == [0.7, 0.2, 0.1]
    assert set(other[0]) == set(data["ranking"][0])
    # ...while the main ranking is still the primary's.
    assert [r["id"] for r in data["ranking"]][0] == "a"


def test_dev_mode_secondary_ranking_breaks_ties_like_the_main_one(client, fake_manager):
    # b and c are tied for engine_b - they must come out in the same order the
    # main ranking would put them (nearest drive first), not arbitrary dict order.
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.5, "b": 0.25, "c": 0.25}
    engine_b._probabilities = {"a": 0.5, "b": 0.25, "c": 0.25}
    data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True).get_json()
    assert [r["id"] for r in data["comparison"]["engine_b"]["ranking"]] == [r["id"] for r in data["ranking"]]


class _SlowEngine(FakeEngine):
    """Blocks in score() until released - stands in for a cold model load."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.release = threading.Event()

    def score(self, state, candidates, exclusions):
        self.release.wait(timeout=5)
        return super().score(state, candidates, exclusions)


def test_dev_mode_slow_engine_is_flagged_loading_and_does_not_hold_up_the_response(client, monkeypatch):
    fast = FakeEngine("engine_a", probabilities={"a": 0.80, "b": 0.10, "c": 0.10})
    slow = _SlowEngine("engine_b", probabilities={"a": 0.20, "b": 0.70, "c": 0.10})
    mgr = EngineManager([fast, slow], default_id="engine_a")
    monkeypatch.setattr(app_module, "SECONDARY_ENGINE_TIMEOUT_S", 0.3)
    try:
        with patch.object(app_module, "manager", mgr):
            started = time.monotonic()
            data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True).get_json()
            elapsed = time.monotonic() - started
    finally:
        slow.release.set()
    assert data["status"] == "ranked"
    # Answered at the deadline - it did not wait for the slow engine (which is
    # blocked until released, well past this).
    assert elapsed < 2.0
    assert data["comparison"]["engine_b"]["error"] == "ENGINE_UNAVAILABLE"
    assert data["comparison"]["engine_b"]["loading"] is True
    assert data["comparison"]["engine_a"]["primary"] is True


def test_dev_mode_permanently_unavailable_engine_is_not_marked_loading(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    engine_b._available = False
    engine_b._reason = "GPU embeddings server not configured"
    data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True).get_json()
    entry = data["comparison"]["engine_b"]
    assert entry["error"] == "ENGINE_UNAVAILABLE"
    assert "loading" not in entry


def test_dev_mode_secondary_failure_does_not_break_response(client, fake_manager):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    engine_b._raise_error = True
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True)
    data = resp.get_json()
    assert data["status"] == "ranked"
    assert data["comparison"]["engine_b"]["error"] == "ENGINE_UNAVAILABLE"


def test_dev_mode_ignored_when_disallowed(client, fake_manager, monkeypatch):
    _, engine_a, engine_b = fake_manager
    engine_a._probabilities = {"a": 0.80, "b": 0.10, "c": 0.10}
    monkeypatch.setattr(app_module, "DEV_MODE_ALLOWED", False)
    resp = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, dev_mode=True)
    data = resp.get_json()
    assert "comparison" not in data


# --- deterministic_tiebreak uses real driving distance when it has one -----

def test_rank_tiebreak_key_prefers_route_km_over_straight_line_distance():
    # "far_by_line" looks closer by distance_km alone, but its real route is
    # longer - ordering must follow the drive, not the crow-flies line.
    far_by_line = {"id": "a", "price": "$$", "distance_km": 1.0, "route_km": 9.0}
    near_by_road = {"id": "b", "price": "$$", "distance_km": 5.0, "route_km": 2.0}
    ordered = sorted([far_by_line, near_by_road], key=app_module.rank_tiebreak_key)
    assert [c["id"] for c in ordered] == ["b", "a"]


def test_rank_tiebreak_key_falls_back_to_distance_km_without_a_route():
    nearer = {"id": "a", "price": "$$", "distance_km": 1.0}
    farther = {"id": "b", "price": "$$", "distance_km": 5.0}
    ordered = sorted([farther, nearer], key=app_module.rank_tiebreak_key)
    assert [c["id"] for c in ordered] == ["a", "b"]


def test_rank_tiebreak_key_then_prefers_the_cheaper_place():
    pricey = {"id": "a", "price": "$$$", "distance_km": 1.0}
    cheap = {"id": "b", "price": "$", "distance_km": 1.0}
    ordered = sorted([pricey, cheap], key=app_module.rank_tiebreak_key)
    assert [c["id"] for c in ordered] == ["b", "a"]


# --- Meal awareness (see meals.py) ---------------------------------------------

def _scored(fake_manager):
    # FakeEngine defaults to no probabilities, which is a MODEL_ERROR round.
    _, engine_a, _ = fake_manager
    engine_a._probabilities = {"a": 0.6, "b": 0.3, "c": 0.1}


def _meal_kwarg(client, **body):
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        resp = _post(client, partner1={"text": "spicy"}, partner2={"text": "anything"}, **body)
    return mock_get.call_args.kwargs.get("meal"), resp.get_json()


def test_decide_guesses_the_meal_from_the_local_hour(client, fake_manager):
    _scored(fake_manager)
    meal, data = _meal_kwarg(client, local_hour=13)
    assert meal == "lunch"
    assert data["meal"] == {"id": "lunch", "source": "clock"}


def test_typed_words_beat_the_clock_and_a_chosen_meal_beats_both(client, fake_manager):
    _scored(fake_manager)
    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        resp = _post(client, partner1={"text": "something sweet"}, partner2={"text": "anything"}, local_hour=13)
    assert mock_get.call_args.kwargs["meal"] == "snack"
    assert resp.get_json()["meal"] == {"id": "snack", "source": "text"}

    with patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")) as mock_get:
        resp = _post(client, partner1={"text": "something sweet"}, partner2={"text": "anything"},
                     local_hour=13, meal="dinner")
    assert mock_get.call_args.kwargs["meal"] == "dinner"
    assert resp.get_json()["meal"] == {"id": "dinner", "source": "chosen"}


def test_without_a_clock_or_words_there_is_no_meal_rule(client, fake_manager):
    _scored(fake_manager)
    meal, data = _meal_kwarg(client)
    assert meal == "any"
    assert data["meal"] == {"id": "any", "source": "none"}


def test_malformed_meal_hints_are_ignored_not_rejected(client, fake_manager):
    _scored(fake_manager)
    for bad in ({"local_hour": 99}, {"local_hour": "noon"}, {"local_hour": True}, {"meal": "brunch-ish"}, {"meal": 7}):
        meal, data = _meal_kwarg(client, **bad)
        assert data["status"] == "ranked", bad
        assert meal == "any", bad


def test_the_meal_is_echoed_even_for_a_single_surviving_place(client, fake_manager):
    with patch("app.get_candidates", return_value=(FIXED_CANDS[:1], "osm")):
        data = _post(client, partner1={"text": "x"}, partner2={"text": "y"}, local_hour=19).get_json()
    assert data["meal"] == {"id": "dinner", "source": "clock"}
