"""
Runs a handful of sample couples through Laya and GLiNER and prints a
top-pick / confidence / latency table, to sanity-check real behavior and
help tune CONFIDENCE_THRESHOLDS. Run from the project root:

    .venv/Scripts/python.exe scripts/compare_engines.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from candidates import MOCK_RESTAURANTS, with_colors  # noqa: E402
from engines import build_default_registry  # noqa: E402

CASES = [
    ("Aligned", "Spicy Mexican food, patio seating, under $30", "Something casual with a patio, okay with spice"),
    ("Conflicting", "Spicy food, close by", "Casual with outdoor patio, no heavy burgers, vegan-friendly"),
    ("Budget", "Cheap eats please, under $15", "Anything is fine as long as it's quick"),
    ("Diet", "We need halal options", "Doesn't matter to me"),
    ("Vague", "Something good", "I don't know, surprise me"),
]


def build_state(p1, p2):
    return f"Partner 1 wants: {p1}.\nPartner 2 wants: {p2}.\nGoal: choose the ONE restaurant that satisfies both partners best."


def main():
    cands = with_colors([dict(c) for c in MOCK_RESTAURANTS])
    engines = {e.id: e for e in build_default_registry() if e.available()[0]}
    print(f"Available engines: {list(engines)}\n")

    rows = []
    for label, p1, p2 in CASES:
        state = build_state(p1, p2)
        row = {"case": label}
        for eid, engine in engines.items():
            t0 = time.time()
            try:
                result = engine.score(state, cands, set())
                elapsed = (time.time() - t0) * 1000
                top_id, top_p = max(result.probabilities.items(), key=lambda kv: kv[1])
                top_name = next(c["name"] for c in cands if c["id"] == top_id)
                row[eid] = f"{top_name} ({top_p:.0%}, {elapsed:.0f}ms)"
            except Exception as exc:  # noqa: BLE001
                row[eid] = f"ERROR: {exc}"
        rows.append(row)

    col_width = 42
    header = f"{'Case':<14}" + "".join(f"{eid:<{col_width}}" for eid in engines)
    print(header)
    print("-" * len(header))
    for row in rows:
        line = f"{row['case']:<14}"
        for eid in engines:
            line += f"{row.get(eid, ''):<{col_width}}"
        print(line)


if __name__ == "__main__":
    main()
