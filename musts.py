"""Must-haves: "must have chicken", "has to be seafood", "need rice".

A partner saying they MUST have something is a hard requirement, not a
preference - but until now it reached the decision model only as a sentence of
text, and models rank relatively, so a round where one partner said "must have
chicken" still came back with ice-cream and waffle shops. This turns it into a
rule in plain code, like the budget / "no X" / diet guards in app.py.

The rule is deliberately two-sided, because place data can't say what a menu
contains:
- a place that CAN'T serve it is dropped (a dessert or drinks shop, a
  vegetarian place for a meat must-have, a halal place for pork) - and for
  specific dishes (pizza, burgers, steak, satay, noodles, seafood) a place
  with no sign of it is dropped too;
- a place that clearly DOES serve it (a chicken-restaurant category, "Ayam" in
  the name) is preferred for the shortlist slots.
Broadly served foods (chicken, rice, beef, meat...) are not dropped for lacking
a sign - most Malay, Indian and Chinese restaurants serve chicken whatever
they're called. When no shortlisted place shows a sign at all, the round says
so (unmet_musts) instead of pretending.

Plain mentions with no "must" ("chicken biryani") stay soft hints - this only
fires on a demand.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from meals import MEAL, place_kind


@dataclass(frozen=True)
class Food:
    words: re.Pattern          # in a place's NAME: clear sign it serves this
    labels: tuple[str, ...]    # in its cuisine label / tags: clear sign
    strict: bool = False       # True: no sign at all -> assume it doesn't serve it
    meat: bool = False         # excludes vegetarian / vegan places
    pork: bool = False         # excludes halal places


def _w(*terms: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(terms) + r")\b")


FOODS: dict[str, Food] = {
    "chicken": Food(_w("chicken", "ayam", "chick", "rotisserie", "kfc", "popeyes", "nando'?s?", "marrybrown",
                       "kenny rogers", "texas chicken", "4fingers", "wingstop", "wings?"),
                    ("chicken",), meat=True),
    "beef": Food(_w("beef", "daging", "wagyu", "steak", "bulgogi", "brisket"), ("steak", "barbecue"), meat=True),
    "mutton": Food(_w("mutton", "lamb", "kambing", "kebab", "arab", "arabic"),
                   ("middle eastern", "arabian", "turkish", "kebab", "lebanese"), meat=True),
    "pork": Food(_w("pork", "babi", "bak kut teh", "char siew", "siew", "roast pork"), ("german",),
                 meat=True, pork=True),
    "meat": Food(_w("bbq", "grill", "barbecue", "steak", "satay", "chicken", "ayam", "beef", "mutton", "lamb",
                    "bak kut teh", "kebab", "roast", "yakiniku"), ("barbecue", "steak", "chicken", "kebab"), meat=True),
    "seafood": Food(_w("seafood", "fish", "ikan", "prawn", "udang", "crab", "ketam", "squid", "sotong", "sushi",
                       "lobster", "siakap", "claypot"),
                    ("seafood", "sushi", "fish", "japanese", "thai", "chinese", "malaysian", "asian"), strict=True),
    "noodles": Food(_w("noodles?", "mee", "ramen", "laksa", "pho", "udon", "soba", "kuey teow", "kuetiau", "bihun",
                       "wantan", "wanton", "pan mee"),
                    ("ramen", "noodle", "chinese", "thai", "japanese", "vietnamese", "taiwanese", "korean",
                     "malaysian", "asian"), strict=True),
    "rice": Food(_w("rice", "nasi", "claypot", "briyani", "biryani"),
                 ("indian", "malaysian", "chinese", "thai", "indonesian", "japanese", "korean", "asian")),
    "pizza": Food(_w("pizza", "pizzeria", "domino'?s?"), ("pizza", "italian"), strict=True),
    "burger": Food(_w("burgers?", "mcdonald'?s?", "burger king", "wendy'?s?", "carl'?s jr", "ramly"),
                   ("burger", "american"), strict=True),
    "steak": Food(_w("steak", "steakhouse", "chop house", "grill"), ("steak", "american", "barbecue"), strict=True),
    "satay": Food(_w("satay", "sate"), ("satay",), strict=True),
}

# Words a partner types -> the food above. Malay terms included.
_TERMS: dict[str, str] = {
    "chicken": "chicken", "ayam": "chicken", "fried chicken": "chicken",
    "beef": "beef", "daging": "beef",
    "mutton": "mutton", "lamb": "mutton", "kambing": "mutton",
    "pork": "pork", "babi": "pork",
    "meat": "meat",
    "seafood": "seafood", "fish": "seafood", "ikan": "seafood", "prawn": "seafood", "prawns": "seafood",
    "udang": "seafood", "crab": "seafood", "ketam": "seafood", "squid": "seafood", "sotong": "seafood",
    "noodle": "noodles", "noodles": "noodles", "mee": "noodles", "ramen": "noodles", "laksa": "noodles",
    "pho": "noodles", "udon": "noodles", "kuey teow": "noodles", "bihun": "noodles",
    "rice": "rice", "nasi": "rice",
    "pizza": "pizza",
    "burger": "burger", "burgers": "burger",
    "steak": "steak",
    "satay": "satay", "sate": "satay",
}

# "must have", "has to be", "need"... then a few words. Not "must not", and
# not "no need for" / "don't need" - see _negated.
_TRIGGER = re.compile(
    r"\b(?:must (?:have|be|serve|get|eat)|has to (?:have|be|serve)|have to (?:have|be|eat)|"
    r"need|needs|gotta have|got to have|definitely (?:want|need)|insist on)\b"
)
_NEGATIONS = {"no", "not", "dont", "don't", "never", "doesnt", "doesn't", "without"}
_STOP = re.compile(r"[,.;!?\n]|\bbut\b|\bthen\b|\bafter\b|\bmaybe\b")
_WINDOW_WORDS = 6


def _negated(text: str, start: int) -> bool:
    before = text[:start].split()
    return bool(before) and before[-1].strip(",.") in _NEGATIONS


def detect_musts(text: str) -> list[str]:
    """The foods a partner demanded, in order ("must have chicken and rice" ->
    ["chicken", "rice"]), or []. Only what follows a demand phrase counts."""
    lower = (text or "").lower()
    found: list[str] = []
    for m in _TRIGGER.finditer(lower):
        if _negated(lower, m.start()):
            continue
        tail = lower[m.end():]
        stop = _STOP.search(tail)
        if stop:
            tail = tail[: stop.start()]
        words = re.findall(r"[a-z']+", tail)[:_WINDOW_WORDS]
        i = 0
        while i < len(words):
            pair = " ".join(words[i:i + 2])
            if pair in _TERMS:
                food, step = _TERMS[pair], 2
            elif words[i] in _TERMS:
                food, step = _TERMS[words[i]], 1
            else:
                food, step = None, 1
            if food and food not in found:
                found.append(food)
            i += step
    return found


def serves(c: dict, food: str) -> bool | None:
    """True = clear sign this place serves `food`; False = it can't (or, for a
    specific dish, shows no sign of it); None = might - not ruled out."""
    spec = FOODS[food]
    if place_kind(c) != MEAL:
        return False
    tags = " ".join(c.get("tags") or []).lower()
    label = f"{(c.get('cuisine') or '').lower()} {tags}"
    diet = (c.get("dims") or {}).get("diet")
    if spec.meat and (diet in ("vegetarian", "vegan") or "vegetarian" in label or "vegan" in label):
        return False
    if spec.pork and (diet == "halal" or "halal" in label):
        return False
    if spec.words.search((c.get("name") or "").lower()) or any(l in label for l in spec.labels):
        return True
    return False if spec.strict else None


def _best(c: dict, musts: list[str]) -> bool | None:
    """Across several must-haves a place only has to suit ONE (two partners
    asking for different things can't both be satisfied by one place)."""
    results = [serves(c, m) for m in musts]
    if True in results:
        return True
    return None if None in results else False


def has_sign(c: dict, musts: list[str]) -> bool:
    return _best(c, musts) is True


def filter_for_musts(places: list[dict], musts: list[str]) -> list[dict]:
    """`places` without any that can't serve the must-haves. Order preserved.
    Never empty for non-empty input: if even the loosest reading of the rule
    would leave nothing, the pool is returned as is (the round then reports
    the must-have as unmet rather than showing nothing)."""
    if not musts or not places:
        return places
    kept = [p for p in places if _best(p, musts) is not False]
    return kept if kept else places


def unmet_musts(places: list[dict], musts: list[str]) -> list[str]:
    """The must-haves no place in `places` clearly serves - so the list can
    say "nothing nearby clearly serves chicken" instead of quietly ignoring
    the demand."""
    return [m for m in musts if not any(serves(c, m) is True for c in places)]
