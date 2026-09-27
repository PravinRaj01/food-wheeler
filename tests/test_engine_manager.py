"""Tests for EngineManager's lazy loading, RAM-budget eviction and the
`protect` set that keeps Dev Mode from evicting the primary engine."""
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from engines import EngineManager, EngineUnavailableError, UnknownEngineError  # noqa: E402
from fakes import FakeEngine  # noqa: E402


def test_unknown_engine_raises():
    mgr = EngineManager([FakeEngine("a")], default_id="a")
    try:
        mgr.get("nope")
        assert False, "expected UnknownEngineError"
    except UnknownEngineError as e:
        assert e.engine_id == "nope"


def test_unavailable_engine_raises_with_reason():
    mgr = EngineManager([FakeEngine("a", available=False, reason="no gpu")], default_id="a")
    try:
        mgr.get("a")
        assert False, "expected EngineUnavailableError"
    except EngineUnavailableError as e:
        assert e.reason == "no gpu"


def test_default_engine_loads_on_first_get():
    a = FakeEngine("a")
    mgr = EngineManager([a], default_id="a")
    assert not a.is_loaded
    mgr.get("a")
    assert a.is_loaded


def test_eviction_frees_room_without_touching_default():
    a = FakeEngine("a", est_ram_mb=100)  # default
    b = FakeEngine("b", est_ram_mb=100)
    c = FakeEngine("c", est_ram_mb=100)
    mgr = EngineManager([a, b, c], default_id="a")

    mgr.get("a")  # load default
    mgr.get("b")  # load a second engine
    assert a.is_loaded and b.is_loaded

    # Pretend RAM is only free once b (the LRU non-default engine) is unloaded.
    with patch.object(mgr, "_available_ram_mb", side_effect=lambda: 10000.0 if not b.is_loaded else 50.0):
        mgr.get("c")

    assert a.is_loaded, "the default engine must never be evicted"
    assert not b.is_loaded, "the LRU non-default engine should have been evicted"
    assert c.is_loaded


def test_protect_set_prevents_eviction_of_primary():
    a = FakeEngine("a", est_ram_mb=100)  # default
    b = FakeEngine("b", est_ram_mb=100)  # acting as a Dev Mode "primary" engine
    c = FakeEngine("c", est_ram_mb=100)
    mgr = EngineManager([a, b, c], default_id="a")

    mgr.get("b")  # b is loaded and, in this scenario, is the request's primary engine
    assert b.is_loaded

    # RAM never frees up in this test, so the only way c could load is by
    # evicting b - which `protect` must forbid.
    with patch.object(mgr, "_available_ram_mb", return_value=10.0):
        try:
            mgr.get("c", protect={"b"})
            assert False, "expected EngineUnavailableError since b may not be evicted"
        except EngineUnavailableError:
            pass

    assert b.is_loaded, "b must still be loaded: it was protected from eviction"


def test_warm_reports_unknown_and_unavailable():
    a = FakeEngine("a")
    mgr = EngineManager([a], default_id="a")
    assert mgr.warm("nope") == {"id": "nope", "loaded": False, "error": "UNKNOWN_ENGINE"}

    unavailable = FakeEngine("x", available=False, reason="missing dep")
    mgr2 = EngineManager([unavailable], default_id="x")
    result = mgr2.warm("x")
    assert result["loaded"] is False
    assert result["error"] == "ENGINE_UNAVAILABLE"
    assert result["reason"] == "missing dep"


def test_list_status_reports_default_and_availability():
    a = FakeEngine("a", label="A")
    b = FakeEngine("b", label="B", available=False, reason="GPU required")
    mgr = EngineManager([a, b], default_id="a")
    status = {row["id"]: row for row in mgr.list_status()}
    assert status["a"]["default"] is True
    assert status["b"]["default"] is False
    assert status["b"]["available"] is False
    assert status["b"]["reason"] == "GPU required"
