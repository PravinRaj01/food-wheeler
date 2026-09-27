"""A lightweight fake DecisionEngine for fast, deterministic tests that
never touch torch/laya/gliner2."""
from __future__ import annotations

from engines.base import DecisionEngine, EngineResult, EngineScoreError


class FakeEngine(DecisionEngine):
    def __init__(self, engine_id: str, label: str | None = None, est_ram_mb: int = 100,
                 probabilities=None, available: bool = True, reason: str | None = None,
                 raise_error: bool = False, latency_ms: float = 1.0, raw_scores=None):
        self.id = engine_id
        self.label = label or engine_id
        self.est_ram_mb = est_ram_mb
        self._probabilities = probabilities or {}
        self._available = available
        self._reason = reason
        self._raise_error = raise_error
        self._latency_ms = latency_ms
        self._raw_scores = raw_scores
        self._loaded = False
        self.calls: list[tuple] = []

    def available(self):
        return self._available, self._reason

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def load(self) -> None:
        self._loaded = True

    def unload(self) -> None:
        self._loaded = False

    def score(self, state: str, candidates: list[dict], exclusions: set[str]) -> EngineResult:
        self.calls.append((state, [c["id"] for c in candidates], set(exclusions)))
        if self._raise_error:
            raise EngineScoreError(f"fake engine {self.id} failure")
        probs = self._probabilities
        if callable(probs):
            probs = probs(self.calls)
        return EngineResult(probabilities=dict(probs), raw_scores=self._raw_scores,
                             latency_ms=self._latency_ms)
