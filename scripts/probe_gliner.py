"""
Probe script: confirms the exact shape of GLiNER2.5-Decide's classification
output. Run once during Sprint 1b:

    .venv/Scripts/python.exe scripts/probe_gliner.py

FINDINGS (kept here for reference):
- Plain `classify_text(text, {"q": {"labels": {...}}})` returns only the
  winning label as a string: {"restaurant": "casa_fuego"}. No scores.
- `multi_label=True, cls_threshold=0.0` plus `include_confidence=True`
  returns every label with its own independent confidence:
      {"restaurant": [{"label": "casa_fuego", "confidence": 0.85}, ...]}
  These are NOT softmax probabilities (they don't sum to 1) — each label
  is scored independently, so `engines/gliner_engine.py` normalizes them
  by dividing by their sum before returning `EngineResult.probabilities`.
- On Windows, GLiNER's own startup banner prints an emoji; run with
  PYTHONUTF8=1 or it raises UnicodeEncodeError on the default cp1252
  console.
"""
import json
import time

from gliner2 import AutoExtractor

print("Loading fastino/GLiNER2.5-Decide (downloads on first run)...")
t0 = time.time()
model = AutoExtractor.from_pretrained("fastino/GLiNER2.5-Decide")
print(f"Model ready in {time.time() - t0:.1f}s")

state = (
    "Partner 1 wants: Spicy food, under $30, close by.\n"
    "Partner 2 wants: Casual with outdoor patio, no heavy burgers.\n"
    "Goal: choose the ONE restaurant that satisfies both partners best."
)

labels = {
    "casa_fuego": "Casa Fuego Cantina — Mexican, spicy, outdoor patio, casual, ~$$, 0.8 km away",
    "thai_orchid": "Thai Orchid — Thai, mild-to-spicy curries, indoor only, casual, ~$$, 1.4 km away",
    "green_bowl": "Green Bowl — vegan salads and bowls, indoor, healthy, ~$, 2.1 km away",
    "burger_barn": "Burger Barn — American burgers, fast food counter service, ~$, 0.5 km away",
    "la_trattoria": "La Trattoria — Italian, sit-down fine dining, indoor, ~$$$, 3.0 km away",
}

print("\n=== classify_text (multi_label, include_confidence) — the shape we use ===")
t0 = time.time()
result = model.classify_text(
    state,
    {"restaurant": {"labels": labels, "multi_label": True, "cls_threshold": 0.0}},
    include_confidence=True,
)
elapsed_ms = (time.time() - t0) * 1000
print(json.dumps(result, indent=2, default=str))
print(f"\nInference latency: {elapsed_ms:.1f} ms")

raw = {row["label"]: row["confidence"] for row in result["restaurant"]}
total = sum(raw.values()) or 1.0
normalized = {k: round(v / total, 4) for k, v in raw.items()}
print("\nNormalized to a probability distribution (sums to 1):")
print(json.dumps(normalized, indent=2))
