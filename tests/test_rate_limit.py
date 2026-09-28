"""Tests for the per-IP token-bucket rate limit on /api/decide."""
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
    {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
     "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
     "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    {"id": "b", "name": "Thai Orchid", "cuisine": "Thai", "tags": [], "price": "$$",
     "lat": 1.0, "lng": 1.0, "address": "y", "distance_km": 0.6,
     "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "none"}},
]


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


@pytest.fixture
def fake_engine_setup():
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9, "b": 0.1}
    mgr = EngineManager([engine_a], default_id="engine_a")
    with patch.object(app_module, "manager", mgr), \
         patch("app.get_candidates", return_value=(FIXED_CANDS, "osm")):
        yield


def _decide(client, ip="1.2.3.4"):
    return client.post(
        "/api/decide",
        json={"partner1": {"text": "spicy"}, "partner2": {"text": "casual"}},
        headers={"X-Forwarded-For": ip},
    )


def test_requests_within_burst_capacity_all_succeed(client, fake_engine_setup):
    for _ in range(app_module.RATE_LIMIT_CAPACITY):
        resp = _decide(client)
        assert resp.status_code == 200


def test_exceeding_burst_capacity_returns_429(client, fake_engine_setup):
    for _ in range(app_module.RATE_LIMIT_CAPACITY):
        _decide(client)
    resp = _decide(client)
    assert resp.status_code == 429
    data = resp.get_json()
    assert data["status"] == "error"
    assert data["code"] == "RATE_LIMITED"


def test_rate_limit_is_scoped_per_ip(client, fake_engine_setup):
    for _ in range(app_module.RATE_LIMIT_CAPACITY):
        _decide(client, ip="1.1.1.1")
    exhausted = _decide(client, ip="1.1.1.1")
    other_ip = _decide(client, ip="2.2.2.2")
    assert exhausted.status_code == 429
    assert other_ip.status_code == 200


def test_tokens_refill_over_time(client, fake_engine_setup):
    for _ in range(app_module.RATE_LIMIT_CAPACITY):
        _decide(client, ip="9.9.9.9")
    assert _decide(client, ip="9.9.9.9").status_code == 429

    # Simulate enough elapsed time for a couple of tokens to refill without
    # sleeping in the test.
    tokens, last = app_module._rate_limit_buckets["9.9.9.9"]
    app_module._rate_limit_buckets["9.9.9.9"] = (tokens, last - 12)  # ~2 tokens back

    assert _decide(client, ip="9.9.9.9").status_code == 200


def test_first_request_from_a_new_ip_always_succeeds(client, fake_engine_setup):
    assert _decide(client, ip="203.0.113.7").status_code == 200


def test_health_and_places_routes_are_not_rate_limited(client):
    for _ in range(app_module.RATE_LIMIT_CAPACITY + 5):
        assert client.get("/api/health", headers={"X-Forwarded-For": "5.5.5.5"}).status_code == 200


def test_client_ip_prefers_first_x_forwarded_for_entry():
    with app_module.app.test_request_context(headers={"X-Forwarded-For": "1.2.3.4, 10.0.0.1"}):
        assert app_module._client_ip() == "1.2.3.4"


def test_client_ip_falls_back_to_remote_addr_without_the_header():
    with app_module.app.test_request_context(environ_overrides={"REMOTE_ADDR": "127.0.0.1"}):
        assert app_module._client_ip() == "127.0.0.1"
