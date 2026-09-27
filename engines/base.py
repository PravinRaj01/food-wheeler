"""
Shared interface every decision engine implements, so `app.py`'s ranking,
tie-detection, threshold and mediator logic never needs to know which
engine actually answered.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class EngineResult:
    probabilities: dict[str, float]              # candidate_id -> p, normalized to sum to 1
    raw_scores: dict[str, float] | None = None    # e.g. CLM cosine sims, shown as a UI detail
    latency_ms: float = 0.0


class EngineScoreError(Exception):
    """Raised when a load engine fails mid-request (e.g. a remote timeout)."""


class DecisionEngine(ABC):
    id: str
    label: str
    est_ram_mb: int

    def available(self) -> tuple[bool, str | None]:
        """(ok, reason). `reason` is a short, user-facing string when not ok."""
        return True, None

    @property
    @abstractmethod
    def is_loaded(self) -> bool: ...

    @abstractmethod
    def load(self) -> None:
        """Load weights into memory. Must be idempotent and safe to call
        even when the model is already loaded."""

    @abstractmethod
    def unload(self) -> None:
        """Free memory. Must be safe to call even if never loaded."""

    @abstractmethod
    def score(self, state: str, candidates: list[dict], exclusions: set[str]) -> EngineResult:
        """Score every candidate against `state`. Must return a full,
        normalized probability distribution over the given candidate ids.
        Raises EngineScoreError on a request-time failure (the caller may
        fall back to another engine)."""
