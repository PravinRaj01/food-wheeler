"""
Engine registry and the memory-safe manager that lazy-loads, evicts and
serves DecisionEngine instances.
"""
from __future__ import annotations

import gc
import os
import threading
import time

try:
    import psutil
except ImportError:  # pragma: no cover - psutil is a hard requirement in prod
    psutil = None

try:
    import torch
    # Cloud Run runs this on 2 vCPUs (see the Dockerfile's OMP_NUM_THREADS,
    # set for the same reason). torch defaults to one thread per *logical*
    # core it sees, which on a bigger dev machine or a mis-reported
    # container can wildly oversubscribe the real CPU budget and slow every
    # engine call down rather than speed it up - pinning it here makes the
    # thread count match what's actually available regardless of what torch
    # detects.
    torch.set_num_threads(int(os.environ.get("TORCH_NUM_THREADS", "2")))
except ImportError:  # pragma: no cover - torch is a hard requirement in prod
    pass

from .base import DecisionEngine, EngineResult, EngineScoreError
from .clm_engine import ClmEngine
from .gliner_engine import GlinerEngine
from .laya_engine import LayaEngine

DEFAULT_ENGINE_ID = "laya"


class UnknownEngineError(Exception):
    def __init__(self, engine_id: str):
        self.engine_id = engine_id
        super().__init__(f"Unknown engine: {engine_id}")


class EngineUnavailableError(Exception):
    def __init__(self, engine_id: str, reason: str):
        self.engine_id = engine_id
        self.reason = reason
        super().__init__(f"Engine {engine_id} unavailable: {reason}")


def build_default_registry() -> list[DecisionEngine]:
    return [LayaEngine(), GlinerEngine(), ClmEngine()]


class EngineManager:
    """
    Lazy-loads engines on first use, keeps the default engine warm, and
    evicts the least-recently-used *non-default, non-requested* engine
    when loading a new one would exceed the RAM budget. The primary
    engine driving the current request is never evicted to make room for
    a Dev Mode comparison pass — see app.py's dev-mode scoring.
    """

    def __init__(self, engines: list[DecisionEngine], default_id: str = DEFAULT_ENGINE_ID,
                 memory_budget_mb: int | None = None):
        self._engines = {e.id: e for e in engines}
        self.default_id = default_id
        self.memory_budget_mb = memory_budget_mb or int(os.environ.get("MEMORY_BUDGET_MB", 11000))
        self._load_locks = {e.id: threading.Lock() for e in engines}
        self._last_used: dict[str, float] = {}

    def ids(self) -> list[str]:
        return list(self._engines.keys())

    def list_status(self) -> list[dict]:
        out = []
        for e in self._engines.values():
            ok, reason = e.available()
            out.append({
                "id": e.id, "label": e.label,
                "available": ok, "reason": reason,
                "loaded": e.is_loaded, "default": e.id == self.default_id,
            })
        return out

    def _available_ram_mb(self) -> float:
        if psutil is None:
            return float("inf")
        return psutil.virtual_memory().available / (1024 * 1024)

    def available_ram_mb(self) -> float:
        """Public wrapper, e.g. for /api/health."""
        return self._available_ram_mb()

    def loaded_ids(self) -> list[str]:
        return [e.id for e in self._engines.values() if e.is_loaded]

    def _ensure_budget(self, engine: DecisionEngine, protect: set[str]) -> bool:
        """Evict LRU loaded engines (never the default, never anything in
        `protect`) until there's room for `engine`, or report failure."""
        needed_mb = engine.est_ram_mb * 1.3
        if self._available_ram_mb() >= needed_mb:
            return True

        evictable = [
            e for e in self._engines.values()
            if e.is_loaded and e.id != self.default_id and e.id != engine.id and e.id not in protect
        ]
        evictable.sort(key=lambda e: self._last_used.get(e.id, 0))
        for e in evictable:
            e.unload()
            gc.collect()
            self._last_used.pop(e.id, None)
            if self._available_ram_mb() >= needed_mb:
                return True
        return self._available_ram_mb() >= needed_mb

    def get(self, engine_id: str | None, protect: set[str] | None = None) -> DecisionEngine:
        """Returns a loaded, available engine or raises UnknownEngineError /
        EngineUnavailableError. `protect` names engine ids that must not be
        evicted to make room (used so Dev Mode never evicts the primary
        engine while loading a secondary one)."""
        engine_id = engine_id or self.default_id
        engine = self._engines.get(engine_id)
        if engine is None:
            raise UnknownEngineError(engine_id)

        ok, reason = engine.available()
        if not ok:
            raise EngineUnavailableError(engine_id, reason or "not available")

        if not engine.is_loaded:
            with self._load_locks[engine_id]:
                if not engine.is_loaded:
                    if not self._ensure_budget(engine, protect or set()):
                        raise EngineUnavailableError(
                            engine_id, "not enough memory available to load this engine")
                    engine.load()

        self._last_used[engine_id] = time.time()
        return engine

    def warm(self, engine_id: str) -> dict:
        """Used by POST /api/engines/<id>/warm. Loads the engine (or
        reports why it can't) without scoring anything."""
        try:
            engine = self.get(engine_id)
            return {"id": engine_id, "loaded": engine.is_loaded}
        except UnknownEngineError:
            return {"id": engine_id, "loaded": False, "error": "UNKNOWN_ENGINE"}
        except EngineUnavailableError as exc:
            return {"id": engine_id, "loaded": False, "error": "ENGINE_UNAVAILABLE", "reason": exc.reason}


__all__ = [
    "DecisionEngine", "EngineResult", "EngineScoreError",
    "EngineManager", "UnknownEngineError", "EngineUnavailableError",
    "build_default_registry", "DEFAULT_ENGINE_ID",
]
