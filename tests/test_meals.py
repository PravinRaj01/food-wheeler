"""Meal awareness: what kind of place something is, which meal the couple is
after, and keeping the shortlist to places that suit it. The cases are real
ones from the Overture bundle - Baskin-Robbins is an `ice_cream_shop`, "DD
Famous Waffle" is filed as a generic `restaurant`, and Malaysian kopitiams are
filed as `coffee_shop` - see meals.py for why each is classified the way it is.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import candidates  # noqa: E402
from meals import (  # noqa: E402
    BAKERY, DESSERT, DRINKS, MEAL, breakfast_friendly, detect_meal, filter_for_meal, late_friendly,
    meal_from_hour, meal_from_text, place_kind,
)


def place(name, cuisine, km=1.0, pid=None):
    return {"id": pid or name, "name": name, "cuisine": cuisine, "tags": [cuisine.lower()], "price": "~$$",
            "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": km,
            "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": "none"}}


# --- place_kind ---------------------------------------------------------------

@pytest.mark.parametrize("name,cuisine,expected", [
    ("Baskin-Robbins", "Ice Cream Shop", DESSERT),
    ("Leomag Waffle", "Dessert Shop", DESSERT),
    ("Sweet Bakes", "Bakery", BAKERY),
    ("Bread Story Kitchen", "Bakery", BAKERY),  # says baking, so a bakery despite "kitchen"
    ("Aku Carl Steamboat & Grill", "Bakery", MEAL),  # a real data mislabel seen in the bundle
    ("The Library Bar", "Bar", DRINKS),
    ("Irish Pub", "Pub", DRINKS),
    # Generic "Restaurant" labels are settled by name.
    ("DD Famous Waffle Kumbar Indah", "Restaurant", DESSERT),
    ("Liana KIOSK Waffle Ice Blended", "Restaurant", DESSERT),
    ("Cendol Pulut Haji", "Restaurant", DESSERT),
    ("Tealive Taman Molek", "Restaurant", DRINKS),
    # ...unless the name says it serves food.
    ("Waffle & Burger Kitchen", "Restaurant", MEAL),
    ("Nasi Lemak & Cendol", "Restaurant", MEAL),
    # A real cuisine is trusted whatever the name says.
    ("Uncle's Hut Burger & Waffle", "Burger", MEAL),
    ("Bar And Grill House", "Bar And Grill", MEAL),
    ("Madras Briyani Kitchen", "Indian", MEAL),
    # Cafes and coffee shops are meals unless the name is a drinks brand - a
    # kopitiam (filed as coffee_shop) or Old Town serves full meals.
    ("Starbucks Mid Valley", "Coffee Shop", DRINKS),
    ("Tealive", "Cafe", DRINKS),
    ("Old Town White Coffee", "Cafe", MEAL),
    ("Kopitiam Ah Seng", "Coffee Shop", MEAL),
    ("Kedai Kopi Wong", "Coffee Shop", MEAL),
    ("Restoran Sin Kee", "Coffee Shop", MEAL),
    ("Chick n Waffle", "Cafe", MEAL),
    ("Waffle Factory", "Cafe", DESSERT),
])
def test_place_kind(name, cuisine, expected):
    assert place_kind(place(name, cuisine)) == expected


def test_place_kind_works_on_osm_style_labels():
    assert place_kind(place("Gelato Corner", "Ice Cream;Dessert")) == DESSERT
    assert place_kind(place("Mamak Bistro", "Fast Food")) == MEAL


def test_breakfast_friendly():
    assert breakfast_friendly(place("Good Morning", "Breakfast And Brunch"))
    assert breakfast_friendly(place("Kopitiam Ah Seng", "Coffee Shop"))
    assert breakfast_friendly(place("Roti Canai Corner", "Restaurant"))
    assert breakfast_friendly(place("Sweet Bakes", "Bakery"))
    assert not breakfast_friendly(place("Baskin-Robbins", "Ice Cream Shop"))
    assert not breakfast_friendly(place("The Library Bar", "Bar"))
    assert not breakfast_friendly(place("Steakhouse", "American"))


# --- meal detection -----------------------------------------------------------

# The same cases web/lib/decide/meal.test.ts runs against meal.ts - the two
# implementations mirror each other (the chip previews what the server will
# decide), so both read this file and can't drift apart silently.
_CASES = json.loads((Path(__file__).parent / "fixtures" / "meal_text_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _CASES["text"], ids=lambda c: repr(c["text"]))
def test_meal_from_text(case):
    assert meal_from_text(case["text"]) == case["meal"]


@pytest.mark.parametrize("hour,meal", _CASES["hours"])
def test_meal_from_hour_bands(hour, meal):
    assert meal_from_hour(hour) == meal


def test_detect_meal_priority_is_chosen_then_text_then_clock():
    assert detect_meal("lunch", local_hour=20, chosen="dinner") == ("dinner", "chosen")
    assert detect_meal("lunch", local_hour=20) == ("lunch", "text")
    assert detect_meal("spicy", local_hour=13) == ("lunch", "clock")
    assert detect_meal("spicy") == ("any", "none")


def test_detect_meal_ignores_bad_hours_and_choices():
    assert detect_meal("x", local_hour=25) == ("any", "none")
    assert detect_meal("x", local_hour=-1) == ("any", "none")
    assert detect_meal("x", local_hour=True) == ("any", "none")
    assert detect_meal("x", local_hour="13") == ("any", "none")
    assert detect_meal("x", local_hour=13, chosen="brunch-ish") == ("lunch", "clock")


def test_chosen_any_switches_the_meal_rule_off_even_at_lunchtime():
    assert detect_meal("lunch", local_hour=13, chosen="any") == ("any", "chosen")


# --- filtering a pool -----------------------------------------------------------

def pool():
    return [
        place("Madras Briyani Kitchen", "Indian", 1),
        place("Restoran Ayam Penyet", "Malaysian", 2),
        place("Baskin-Robbins", "Ice Cream Shop", 0.2),
        place("DD Famous Waffle", "Restaurant", 0.3),
        place("Starbucks", "Coffee Shop", 0.4),
        place("The Library Bar", "Bar", 0.5),
        place("Sweet Bakes", "Bakery", 0.6),
        place("Kopitiam Ah Seng", "Coffee Shop", 3),
    ]


def names(places):
    return [p["name"] for p in places]


def test_lunch_and_dinner_keep_real_meals_only():
    for meal in ("lunch", "dinner"):
        kept, relaxed = filter_for_meal(pool(), meal)
        assert not relaxed
        assert names(kept) == ["Madras Briyani Kitchen", "Restoran Ayam Penyet", "Kopitiam Ah Seng"]


def test_supper_drops_only_drinks_places():
    kept, _ = filter_for_meal(pool(), "supper")
    assert "Starbucks" not in names(kept) and "The Library Bar" not in names(kept)
    assert "Baskin-Robbins" in names(kept)  # dessert is fine for supper


def test_breakfast_prefers_breakfast_friendly_places_when_there_are_enough():
    kept, _ = filter_for_meal(pool(), "breakfast")
    # Kopitiam, Starbucks (coffee shop) and Sweet Bakes qualify - three is enough to restrict to.
    assert set(names(kept)) == {"Kopitiam Ah Seng", "Starbucks", "Sweet Bakes"}


def test_breakfast_with_too_few_friendly_places_only_drops_drinks():
    few = [place("Madras Briyani Kitchen", "Indian"), place("Sweet Bakes", "Bakery"), place("The Library Bar", "Bar")]
    kept, _ = filter_for_meal(few, "breakfast")
    assert names(kept) == ["Madras Briyani Kitchen", "Sweet Bakes"]


def test_snack_restricts_to_snacky_places_when_there_are_enough():
    kept, _ = filter_for_meal(pool(), "snack")
    assert "Madras Briyani Kitchen" not in names(kept)
    assert {"Baskin-Robbins", "DD Famous Waffle", "Sweet Bakes"} <= set(names(kept))


def test_snack_with_too_few_snacky_places_changes_nothing():
    mostly_meals = [place("A", "Indian"), place("B", "Thai"), place("C", "Ice Cream Shop")]
    kept, relaxed = filter_for_meal(mostly_meals, "snack")
    assert kept == mostly_meals and not relaxed


def test_any_and_unknown_meals_change_nothing():
    p = pool()
    assert filter_for_meal(p, "any") == (p, False)
    assert filter_for_meal(p, None) == (p, False)
    assert filter_for_meal(p, "elevenses") == (p, False)


def test_a_rule_that_would_leave_nothing_is_relaxed_and_says_so():
    only_dessert = [place("Baskin-Robbins", "Ice Cream Shop"), place("Leomag Waffle", "Dessert Shop")]
    kept, relaxed = filter_for_meal(only_dessert, "lunch")
    assert kept == only_dessert and relaxed is True


def test_filter_preserves_order_and_does_not_mutate_the_input():
    p = pool()
    before = list(p)
    kept, _ = filter_for_meal(p, "lunch")
    assert p == before
    assert names(kept) == [n for n in names(before) if n in names(kept)]


# --- through the real shortlist ----------------------------------------------------

def test_finalize_at_lunch_spends_no_slots_on_dessert_shops(monkeypatch):
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    results = [place(f"Restoran {i}", "Malaysian", float(i), pid=f"m{i}") for i in range(1, 6)]
    # Closer than every real meal - on distance alone these would take the slots.
    results += [place(f"Baskin-Robbins {i}", "Ice Cream Shop", 0.1 * i, pid=f"d{i}") for i in range(1, 8)]
    params = candidates._radius_params(5)

    at_lunch = candidates._finalize_candidates(1.0, 1.0, results, 5, params, meal="lunch")
    assert {c["id"] for c in at_lunch} == {f"m{i}" for i in range(1, 6)}

    no_meal = candidates._finalize_candidates(1.0, 1.0, results, 5, params)
    assert any(c["id"].startswith("d") for c in no_meal)  # the old behaviour, unchanged


def test_a_dessert_place_named_by_the_couple_survives_the_lunch_rule(monkeypatch):
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    results = [place(f"Restoran {i}", "Malaysian", float(i), pid=f"m{i}") for i in range(1, 6)]
    results.append(place("Baskin-Robbins", "Ice Cream Shop", 2.0, pid="baskin"))
    params = candidates._radius_params(5)

    final = candidates._finalize_candidates(
        1.0, 1.0, results, 5, params, mention_text="lunch, or baskin robbins after", meal="lunch",
    )
    assert "baskin" in {c["id"] for c in final}
    assert final[0]["id"] == "baskin"  # pinned first, like any named place


def test_get_candidates_passes_the_meal_through_the_overture_path(monkeypatch):
    # Real Overture categories in, so this also covers the category -> cuisine
    # label -> kind chain end to end, not just place_kind on a hand-built dict.
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    monkeypatch.setattr(candidates, "detect_country", lambda lat, lng, timeout_s=6: None)
    places = [
        {"id": "ice", "name": "Baskin-Robbins", "lat": 1.4212, "lng": 103.659, "country": "MY",
         "category": "ice_cream_shop", "address": ""},
        {"id": "waffle", "name": "DD Famous Waffle", "lat": 1.4213, "lng": 103.659, "country": "MY",
         "category": "restaurant", "address": ""},
        {"id": "briyani", "name": "Madras Briyani Kitchen", "lat": 1.43, "lng": 103.66, "country": "MY",
         "category": "indian_restaurant", "address": ""},
        {"id": "kopi", "name": "Kopitiam Ah Seng", "lat": 1.431, "lng": 103.66, "country": "MY",
         "category": "coffee_shop", "address": ""},
    ]
    index = {}
    for p in places:
        index.setdefault(candidates._overture_grid_cell(p["lat"], p["lng"]), []).append(p)
    monkeypatch.setattr(candidates, "_overture_index", index)

    loc = {"lat": 1.4215, "lng": 103.659}
    lunch, _ = candidates.get_candidates(loc, radius_km=5, meal="lunch")
    assert {c["id"] for c in lunch} == {"briyani", "kopi"}
    anytime, _ = candidates.get_candidates(loc, radius_km=5)
    assert {c["id"] for c in anytime} == {"ice", "waffle", "briyani", "kopi"}


# --- supper: late-trading places first ---------------------------------------------

@pytest.mark.parametrize("name,expected", [
    ("Mamak Corner", True),
    ("Restoran Sin Kee 24 Jam", True),
    ("Kedai Makan 24 Hours", True),
    ("Nasi Kandar Pelita", True),
    ("Restoran TKR 24H", True),
    ("Restoran Sin Kee", False),
    ("Sushi Tei", False),
    ("Room 240 Cafe", False),          # "240" is not "24 hours"
])
def test_late_friendly(name, expected):
    assert late_friendly(place(name, "Restaurant")) is expected


def test_a_late_name_on_a_dessert_shop_is_still_not_a_supper_place():
    assert late_friendly(place("Mamak Ice Cream", "Ice Cream Shop")) is False


def test_at_supper_late_places_get_first_claim_but_nothing_is_dropped(monkeypatch):
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    plain = [place(f"Restoran {i}", "Malaysian", 0.1 * i, pid=f"p{i}") for i in range(1, 11)]
    late = [place("Mamak Bistro 24 Jam", "Malaysian", 4.0, pid="late1"),
            place("Nasi Kandar Ali", "Malaysian", 4.5, pid="late2")]
    params = candidates._radius_params(10)

    supper = candidates._finalize_candidates(1.0, 1.0, plain + late, 10, params, meal="supper")
    assert [c["id"] for c in supper[:2]] == ["late1", "late2"]
    assert any(c["id"].startswith("p") for c in supper)   # plain places still fill the rest

    dinner = candidates._finalize_candidates(1.0, 1.0, plain + late, 10, params, meal="dinner")
    # The preference is supper-only: at dinner nothing is promoted, so the
    # nearest place leads as usual (farther places may still appear via the
    # distance-ring sampling, which has nothing to do with late trading).
    assert dinner[0]["id"] == "p1"


def test_a_demanded_food_still_outranks_the_late_night_preference(monkeypatch):
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})
    results = [place("Mamak Bistro 24 Jam", "Malaysian", 0.5, pid="late"),
               place("Ayam Penyet Ali", "Malaysian", 3.0, pid="ayam")]
    results += [place(f"Restoran {i}", "Malaysian", float(i), pid=f"p{i}") for i in range(1, 6)]
    params = candidates._radius_params(10)
    final = candidates._finalize_candidates(1.0, 1.0, results, 10, params, meal="supper", musts=["chicken"])
    assert final[0]["id"] == "ayam"
