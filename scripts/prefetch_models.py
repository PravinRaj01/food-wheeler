"""
Run at Docker build time so the Laya and GLiNER checkpoints are baked
into the image instead of being downloaded on the Space's first request.
CLM-8B is intentionally not touched here: it's remote-only (see
engines/clm_engine.py) and never ships local weights.
"""
import sys

print("Prefetching Laya (english checkpoint)...")
try:
    from laya import Router
    router = Router()
    # Router() itself is lazy - it does NOT download any weights. The
    # actual checkpoint is only fetched the first time predict() routes
    # to a model, so we have to force that here or nothing gets baked
    # into the image and every cold start re-downloads from HF Hub
    # (and can get rate-limited on a shared cloud IP range).
    router.predict(
        "warm up",
        {"restaurant": {"type": "choice", "instructions": "warm up",
                         "criteria": {"a": "a", "b": "b"}}},
    )
    print("  Laya OK")
except Exception as exc:  # noqa: BLE001
    print(f"  Laya prefetch failed: {exc}", file=sys.stderr)
    sys.exit(1)

print("Prefetching GLiNER2.5-Decide...")
try:
    from gliner2 import AutoExtractor
    AutoExtractor.from_pretrained("fastino/GLiNER2.5-Decide")
    print("  GLiNER OK")
except Exception as exc:  # noqa: BLE001
    print(f"  GLiNER prefetch failed: {exc}", file=sys.stderr)
    sys.exit(1)

print("Prefetch complete.")
