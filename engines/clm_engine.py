"""
Stanford/NVIDIA CLM-8B wrapper — optional and remote-only.

CLM-8B's reference setup is a vLLM embeddings server on a GPU; the model
itself needs ~16 GB even at bf16, which would exceed a free Hugging Face
Space's whole RAM budget on its own. So this engine never loads local
weights: it only ever talks to `CLM_EMB_URL`, an OpenAI-compatible
embeddings endpoint the user points at their own free GPU (e.g. a Colab
notebook running `clm serve`, exposed through a tunnel). Without that
env var set, `available()` returns False and the engine is hidden from
the toggle ("GPU required").

`available()` returning False before any network call is what protects
the Space from ever trying to load an 8B model onto its CPU.
"""
from __future__ import annotations

import hashlib
import os
import time

from candidates import describe_candidate

from .base import DecisionEngine, EngineResult, EngineScoreError

REQUEST_TIMEOUT_S = 8
ACTION_CACHE_MAX = 256


class ClmEngine(DecisionEngine):
    id = "clm_8b"
    label = "CLM-8B"
    # Local footprint is just the HTTP client and a small vector cache —
    # the 8B model itself runs on the remote GPU server, not on this Space.
    est_ram_mb = 200

    def __init__(self):
        self._client = None
        self._action_cache: dict[str, str] = {}  # description hash -> description (cache keys only)

    def available(self):
        if not os.environ.get("CLM_EMB_URL"):
            return False, "GPU embeddings server not configured (set CLM_EMB_URL)"
        try:
            import clm  # noqa: F401
        except ImportError:
            return False, "the contrastive-lm package is not installed"
        return True, None

    @property
    def is_loaded(self) -> bool:
        return self._client is not None

    def load(self) -> None:
        if self._client is not None:
            return
        from clm import Engine
        self._client = Engine(emb_url=os.environ["CLM_EMB_URL"])

    def unload(self) -> None:
        self._client = None
        self._action_cache.clear()

    @staticmethod
    def _cache_key(candidate_id: str, description: str) -> str:
        return hashlib.sha1(f"{candidate_id}:{description}".encode()).hexdigest()

    def score(self, state: str, candidates: list[dict], exclusions: set[str]) -> EngineResult:
        if self._client is None:
            self.load()
        t0 = time.time()

        descriptions = {c["id"]: describe_candidate(c) for c in candidates}
        # Candidate ("action") descriptions are stable across tie-breaker
        # rounds, so mark them as cached; only the state text actually
        # changes round to round. We cache keys defensively against
        # unbounded growth, but the real embedding reuse happens inside
        # the CLM server when it recognizes a repeated action string.
        for cid, desc in descriptions.items():
            key = self._cache_key(cid, desc)
            if key not in self._action_cache and len(self._action_cache) < ACTION_CACHE_MAX:
                self._action_cache[key] = desc

        options = list(descriptions.values())
        desc_to_id = {desc: cid for cid, desc in descriptions.items()}

        try:
            ranked = self._client.rank(state, options, timeout=REQUEST_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001
            raise EngineScoreError(f"CLM-8B request failed: {exc}") from exc

        raw: dict[str, float] = {}
        for row in ranked:
            text = row.get("text") or row.get("option")
            prob = row.get("prob", row.get("probability"))
            cid = desc_to_id.get(text)
            if cid is not None and prob is not None:
                raw[cid] = float(prob)

        if not raw:
            raise EngineScoreError("CLM-8B returned no usable ranking")

        total = sum(raw.values()) or 1.0
        probs = {k: v / total for k, v in raw.items()}
        return EngineResult(probabilities=probs, raw_scores=raw,
                             latency_ms=(time.time() - t0) * 1000)
