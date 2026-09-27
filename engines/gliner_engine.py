"""Fastino GLiNER2.5-Decide wrapper. See scripts/probe_gliner.py:

`classify_text(..., multi_label=True, cls_threshold=0.0, include_confidence=True)`
returns every label with its own INDEPENDENT confidence (a sigmoid, not a
softmax — the values don't sum to 1). We normalize by dividing by their
sum so this engine satisfies the same "returns a probability
distribution" contract as every other engine.

GLiNER's schema builder supports real exclusion/implication constraints
(gliner2.classification.constraints.Excludes), but the simple
label-dict form used here doesn't expose them, and by the time an
engine's score() runs, app.apply_guards() has already dropped excluded
candidates from the list. `exclusions` is accepted for interface
symmetry and is not currently needed as a second line of defense.
"""
from __future__ import annotations

import gc
import time

from candidates import describe_candidate

from .base import DecisionEngine, EngineResult, EngineScoreError

MODEL_ID = "fastino/GLiNER2.5-Decide"
_WARMUP_LABELS = {"a": "Pizza place", "b": "Sushi place"}


class GlinerEngine(DecisionEngine):
    id = "gliner"
    label = "GLiNER"
    est_ram_mb = 1400

    def __init__(self):
        self._model = None

    def available(self):
        try:
            import gliner2  # noqa: F401
        except ImportError:
            return False, "the gliner2 package is not installed"
        return True, None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        from gliner2 import AutoExtractor
        model = AutoExtractor.from_pretrained(MODEL_ID)
        model.classify_text(
            "warm up",
            {"restaurant": {"labels": _WARMUP_LABELS, "multi_label": True, "cls_threshold": 0.0}},
            include_confidence=True,
        )
        self._model = model

    def unload(self) -> None:
        self._model = None
        gc.collect()

    def score(self, state: str, candidates: list[dict], exclusions: set[str]) -> EngineResult:
        if self._model is None:
            self.load()
        t0 = time.time()
        labels = {c["id"]: describe_candidate(c) for c in candidates}
        try:
            result = self._model.classify_text(
                state,
                {"restaurant": {"labels": labels, "multi_label": True, "cls_threshold": 0.0}},
                include_confidence=True,
            )
        except Exception as exc:  # noqa: BLE001
            raise EngineScoreError(f"GLiNER request failed: {exc}") from exc

        rows = result.get("restaurant", [])
        raw = {row["label"]: row["confidence"] for row in rows}
        total = sum(raw.values()) or 1.0
        probs = {k: v / total for k, v in raw.items()}
        return EngineResult(probabilities=probs, raw_scores=raw,
                             latency_ms=(time.time() - t0) * 1000)
