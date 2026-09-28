"""Tests for the hand-rolled CORS handling in app.py."""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app as app_module  # noqa: E402
from engines import EngineManager  # noqa: E402
from fakes import FakeEngine  # noqa: E402


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def test_allowed_origin_gets_cors_header(client):
    resp = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"


def test_disallowed_origin_gets_no_cors_header(client):
    resp = client.get("/api/health", headers={"Origin": "https://evil.example.com"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_vercel_preview_origin_matches_regex(client):
    origin = "https://food-wheeler-git-main-pravinraj01.vercel.app"
    resp = client.get("/api/health", headers={"Origin": origin})
    assert resp.headers.get("Access-Control-Allow-Origin") == origin


def test_vercel_lookalike_origin_rejected(client):
    # A different account's vercel.app subdomain must not match.
    origin = "https://food-wheeler-someoneelse.vercel.app"
    resp = client.get("/api/health", headers={"Origin": origin})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_options_preflight_on_decide(client):
    # Flask auto-generates an OPTIONS responder (200) for any route that has
    # one registered; our after_request hook still attaches CORS headers to
    # it. The custom catch-all in app.py exists only for hypothetical /api/*
    # paths with no route of their own.
    resp = client.options(
        "/api/decide",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
    assert "POST" in resp.headers.get("Access-Control-Allow-Methods", "")


def test_options_preflight_on_engines_warm_subpath(client):
    resp = client.options(
        "/api/engines/laya/warm",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
    )
    assert resp.status_code == 200


def test_actual_post_response_still_carries_cors_header(client):
    engine_a = FakeEngine("engine_a", est_ram_mb=100)
    engine_a._probabilities = {"a": 0.9}
    mgr = EngineManager([engine_a], default_id="engine_a")
    fixed_cands = [
        {"id": "a", "name": "Casa Fuego", "cuisine": "Mexican", "tags": [], "price": "$$",
         "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": 0.5,
         "dims": {"service": "sit_down", "spice": "hot", "setting": "patio", "price": "mid", "diet": "none"}},
    ]
    with patch.object(app_module, "manager", mgr), patch("app.get_candidates", return_value=(fixed_cands, "mock")):
        resp = client.post(
            "/api/decide",
            json={"partner1": {"text": "x"}, "partner2": {"text": "y"}},
            headers={"Origin": "http://localhost:3000"},
        )
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000"
