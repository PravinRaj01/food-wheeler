"""
Probe script: confirms the exact shape of Laya's `choice`-question output,
in particular where the full per-option probability distribution lives
(not just the single top `choice`). Run once during Sprint 1 setup:

    .venv/Scripts/python.exe scripts/probe_laya.py

Prints the raw `predict()` result as JSON so we can see every key.
"""
import json
import time

from laya import Router

print("Loading Laya router (downloads the English checkpoint on first run)...")
t0 = time.time()
router = Router()
print(f"Router ready in {time.time() - t0:.1f}s")

state = (
    "Partner 1 wants: Spicy food, under $30, close by.\n"
    "Partner 2 wants: Casual with outdoor patio, no heavy burgers.\n"
    "Goal: choose the ONE restaurant that satisfies both partners best."
)

questions = {
    "restaurant": {
        "type": "choice",
        "instructions": "Which restaurant best satisfies both partners' stated preferences?",
        "criteria": {
            "casa_fuego": "Casa Fuego Cantina — Mexican, spicy, outdoor patio, casual, ~$$, 0.8 km away",
            "thai_orchid": "Thai Orchid — Thai, mild-to-spicy curries, indoor only, casual, ~$$, 1.4 km away",
            "green_bowl": "Green Bowl — vegan salads and bowls, indoor, healthy, ~$, 2.1 km away",
            "burger_barn": "Burger Barn — American burgers, fast food counter service, ~$, 0.5 km away",
            "la_trattoria": "La Trattoria — Italian, sit-down fine dining, indoor, ~$$$, 3.0 km away",
        },
    }
}

t0 = time.time()
result = router.predict(state, questions)
elapsed_ms = (time.time() - t0) * 1000

print("\n=== RAW RESULT (json) ===")
print(json.dumps(result, indent=2, default=str))
print(f"\nInference latency: {elapsed_ms:.1f} ms")

ans = result["answers"]["restaurant"]
print("\n=== answers['restaurant'] keys ===")
print(list(ans.keys()))
print("\ntop choice:", ans.get("choice"))

# Look for any key that could hold a full distribution across the 5 options.
for k, v in ans.items():
    if isinstance(v, dict) and len(v) >= 3:
        print(f"\nCandidate distribution field '{k}':")
        print(json.dumps(v, indent=2, default=str))
