"""ConvAI Laya wrapper. See scripts/probe_laya.py for the confirmed
output schema: answers.restaurant.probabilities is a {id: p} dict that
already sums to ~1 (softmax)."""
from __future__ import annotations

import gc
import time

from candidates import describe_candidate

from .base import DecisionEngine, EngineResult, EngineScoreError

_WARMUP_CRITERIA = {"a": "Pizza place", "b": "Sushi place"}


class LayaEngine(DecisionEngine):
    id = "laya"
    label = "Laya"
    est_ram_mb = 1600

    def __init__(self):
        self._router = None

    def available(self):
        try:
            import laya  # noqa: F401
        except ImportError:
            return False, "the laya package is not installed"
        return True, None

    @property
    def is_loaded(self) -> bool:
        return self._router is not None

    def load(self) -> None:
        if self._router is not None:
            return
        from laya import Router
        router = Router()
        router.predict(
            "warm up",
            {"restaurant": {"type": "choice", "instructions": "warm up", "criteria": _WARMUP_CRITERIA}},
        )
        self._router = router

    def unload(self) -> None:
        self._router = None
        gc.collect()

    def score(self, state: str, candidates: list[dict], exclusions: set[str]) -> EngineResult:
        if self._router is None:
            self.load()
        t0 = time.time()
        criteria = {c["id"]: describe_candidate(c) for c in candidates}
        try:
            result = self._router.predict(state, {
                "restaurant": {
                    "type": "choice",
                    "instructions": "Which restaurant best satisfies both partners' stated preferences?",
                    "criteria": criteria,
                }
            })
        except Exception as exc:  # noqa: BLE001
            raise EngineScoreError(f"Laya request failed: {exc}") from exc

        probs = result["answers"]["restaurant"]["probabilities"]
        return EngineResult(probabilities=dict(probs), raw_scores=None,
                             latency_ms=(time.time() - t0) * 1000)
