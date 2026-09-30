"""Which meal the couple is after, and which places suit it.

The place data says nothing about opening hours or what a place is FOR, and
the decision models only ever see a name and a category tag - so at lunch a
dessert shop could rank first purely because the other shortlisted places were
weak (a real round at lunchtime returned Baskin-Robbins and a waffle shop).
This decides it up front, in plain code like the other hard guards: work out
the meal, then keep the shortlist to places that are actually that kind of
place. Pure functions, no I/O, so they're cheap to test.
"""
from __future__ import annotations

import re

MEALS = ("breakfast", "lunch", "dinner", "supper", "snack", "any")

# What a place is, as far as a meal is concerned.
MEAL, DESSERT, DRINKS, BAKERY = "meal", "dessert", "drinks", "bakery"

# Below this many suitable places, a "restrict to X" rule (breakfast, snack)
# isn't worth applying - a list of one or two would be worse than the honest
# wider one.
MIN_RESTRICTED_POOL = 3


# ---------------------------------------------------------------------------
# What kind of place is it?
#
# Category first (the bundle's own label survives as the candidate's `cuisine`:
# "Ice Cream Shop", "Dessert Shop", "Bakery", "Bar", "Coffee Shop", "Cafe"...),
# then the NAME for the labels that are too vague to trust - a generic
# "Restaurant" called "DD Famous Waffle" is a dessert place. Deliberately
# conservative about drinks: in Malaysia `coffee_shop` covers hundreds of
# kopitiams that serve full meals (and so do chains like Old Town), so a cafe or
# coffee shop only counts as drinks-only when its NAME is a known drinks brand
# and says nothing about food.
# ---------------------------------------------------------------------------
_DESSERT_LABELS = ("ice cream", "dessert", "gelato", "frozen yogurt", "waffle", "crepe", "donut", "doughnut", "creamery")
_DRINK_LABELS = {"bar", "pub", "wine bar", "cocktail bar", "beer garden", "juice bar", "tea room", "tea house"}
_CAFE_LABELS = {"cafe", "coffee shop", "coffee roastery", "cafeteria"}
_GENERIC_LABELS = {"restaurant", "", "food truck stand"}

_DESSERT_NAME = re.compile(
    r"\b(waffles?|ice[\s-]?cream|gelato|gelateria|cendol|ais kacang|crepes?|cr[eê]pes?|donuts?|doughnuts?|"
    r"creamery|baskin|llaollao|ice blended|froyo|dessert|desserts|sundae)\b"
)
_DRINK_NAME = re.compile(
    r"\b(starbucks|coffee bean|tealive|chatime|gong cha|zus|luckin|kenangan|boba|bubble tea|milk tea|"
    r"juice|smoothies?|ice blended|tea ?house|dunkin)\b"
)
# A name that says it serves food overrides a drinks/dessert reading.
_MEAL_NAME = re.compile(
    r"\b(restoran|restaurant|kopitiam|kopi tiam|kedai kopi|nasi|mee|rice|chick|chicken|ayam|kitchen|bistro|"
    r"steak|burger|noodles?|mamak|grill|food court|roti|curry|laksa|satay|seafood|pizza|pasta|bbq|"
    r"bak kut teh|dim sum|claypot|hotpot)\b"
)
_BAKERY_NAME = re.compile(r"\b(bakery|bakeries|bake|bakes|bakehouse|bread|pastry|pastries|cakes?|patisserie|boulangerie)\b")
_BREAKFAST_NAME = re.compile(
    r"\b(kopitiam|kopi tiam|kedai kopi|mamak|roti|nasi lemak|dim sum|bak kut teh|congee|porridge|bubur|"
    r"toast|brunch|breakfast|sarapan|kaya)\b"
)
_BREAKFAST_LABELS = {"cafe", "coffee shop", "bakery"}


def _label(c: dict) -> str:
    return (c.get("cuisine") or "").strip().lower()


def _name(c: dict) -> str:
    return (c.get("name") or "").lower()


def place_kind(c: dict) -> str:
    """One of MEAL / DESSERT / DRINKS / BAKERY. Anything not clearly
    something else is a meal - wrongly hiding a real restaurant is worse than
    letting a borderline place through."""
    label = _label(c)
    name = _name(c)

    if any(k in label for k in _DESSERT_LABELS):
        return DESSERT
    if label == "bakery" or "patisserie" in label:
        # The category is sometimes wrong ("Aku Carl Steamboat & Grill" is
        # filed as a bakery) - a name that says it serves food, and nothing
        # about baking, is a restaurant.
        if _MEAL_NAME.search(name) and not _BAKERY_NAME.search(name):
            return MEAL
        return BAKERY
    if label in _DRINK_LABELS:
        return DRINKS

    serves_food = bool(_MEAL_NAME.search(name))
    if label in _CAFE_LABELS:
        if not serves_food and _DRINK_NAME.search(name):
            return DRINKS
        if not serves_food and _DESSERT_NAME.search(name):
            return DESSERT
        return MEAL
    if label in _GENERIC_LABELS and not serves_food:
        if _DESSERT_NAME.search(name):
            return DESSERT
        if _DRINK_NAME.search(name):
            return DRINKS
    return MEAL


def breakfast_friendly(c: dict) -> bool:
    """Plausibly somewhere to have breakfast: a cafe, bakery, brunch place or
    coffee shop, or a name that says kopitiam / mamak / roti / dim sum / nasi
    lemak. Never a dessert shop or a bar."""
    label = _label(c)
    if place_kind(c) == DESSERT or label in ("bar", "pub"):
        return False
    return "breakfast" in label or label in _BREAKFAST_LABELS or bool(_BREAKFAST_NAME.search(_name(c)))


def is_snacky(c: dict) -> bool:
    """Somewhere to grab a snack, a sweet or a drink rather than a full meal."""
    return place_kind(c) != MEAL or _label(c) in ("cafe", "coffee shop")


# ---------------------------------------------------------------------------
# Which meal?
# ---------------------------------------------------------------------------
# Order matters only for documentation - a text that matches more than one
# distinct meal ("lunch... then dessert") is treated as "any", see detect_meal.
_MEAL_WORDS: list[tuple[str, re.Pattern]] = [
    ("breakfast", re.compile(r"\b(breakfast|brekkie|breakkie|brunch|sarapan)\b")),
    ("lunch", re.compile(r"\b(lunch|lunchy|tengah hari)\b")),
    ("dinner", re.compile(r"\b(dinner|dindin|din din)\b")),
    ("supper", re.compile(r"\b(supper|late night|late-night|midnight|after midnight)\b")),
    ("snack", re.compile(
        r"\b(snacks?|dessert|desserts|something sweet|sweet tooth|ice cream|cake|tea time|teatime|tea break|"
        r"light bite)\b"
    )),
]
_NEGATIONS = {"no", "not", "without", "avoid", "except"}


def _negated(text: str, start: int) -> bool:
    before = text[:start].split()
    return bool(before) and before[-1] in _NEGATIONS


def meal_from_text(text: str) -> str | None:
    """The single meal the text asks for, or None if it names none - or names
    several (two partners asking for different things, or "lunch then
    dessert"), where picking one would override the other."""
    lower = (text or "").lower()
    found = set()
    for meal, pattern in _MEAL_WORDS:
        for m in pattern.finditer(lower):
            if not _negated(lower, m.start()):
                found.add(meal)
                break
    return found.pop() if len(found) == 1 else None


def meal_from_hour(hour: int) -> str:
    """The local hour (0-23) -> the meal someone is most likely after."""
    if 5 <= hour <= 10:
        return "breakfast"
    if 11 <= hour <= 15:
        return "lunch"
    if hour == 16:
        return "snack"
    if 17 <= hour <= 21:
        return "dinner"
    return "supper"


def detect_meal(text: str, local_hour: int | None = None, chosen: str | None = None) -> tuple[str, str]:
    """(meal, source) - source is "chosen" (the couple set it), "text" (a
    partner said it), "clock" (guessed from the local hour) or "none". Words
    typed beat the clock, and an explicit choice beats both. Text that names
    several different meals is left alone ("any") rather than guessed at."""
    if chosen in MEALS:
        return chosen, "chosen"
    from_text = meal_from_text(text)
    if from_text:
        return from_text, "text"
    if isinstance(local_hour, int) and not isinstance(local_hour, bool) and 0 <= local_hour <= 23:
        return meal_from_hour(local_hour), "clock"
    return "any", "none"


# ---------------------------------------------------------------------------
# Filtering a pool of places for a meal
# ---------------------------------------------------------------------------
def filter_for_meal(places: list[dict], meal: str | None) -> tuple[list[dict], bool]:
    """(places suitable for `meal`, relaxed). `relaxed` is True when the rule
    would have left nothing, so the pool is returned unfiltered - it never
    returns an empty list for a non-empty input. Order is preserved.

    - lunch / dinner: real meals only - no dessert, drinks or bakery places.
    - supper: no drinks-only places.
    - breakfast: breakfast-friendly places when there are enough of them,
      otherwise just no drinks-only places.
    - snack: snacky places (dessert, bakery, drinks, cafes) when there are
      enough of them, otherwise everything.
    - any / unknown: untouched."""
    if meal in (None, "any") or meal not in MEALS or not places:
        return places, False

    if meal in ("lunch", "dinner"):
        keep = [p for p in places if place_kind(p) == MEAL]
    elif meal == "supper":
        keep = [p for p in places if place_kind(p) != DRINKS]
    elif meal == "breakfast":
        friendly = [p for p in places if breakfast_friendly(p)]
        keep = friendly if len(friendly) >= MIN_RESTRICTED_POOL else [p for p in places if place_kind(p) != DRINKS]
    else:  # snack
        snacky = [p for p in places if is_snacky(p)]
        keep = snacky if len(snacky) >= MIN_RESTRICTED_POOL else places

    if not keep:
        return places, True
    return keep, False
