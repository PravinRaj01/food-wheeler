"""Must-haves ("must have chicken") as a hard rule on the shortlist. See
musts.py for the two-sided design: drop what can't serve it, prefer what
clearly does, and say so when nothing shows a sign.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import candidates  # noqa: E402
from musts import detect_musts, filter_for_musts, has_sign, serves, unmet_musts  # noqa: E402


def place(name, cuisine, km=1.0, pid=None, diet="none", tags=None):
    return {"id": pid or name, "name": name, "cuisine": cuisine, "tags": tags or [cuisine.lower()], "price": "~$$",
            "lat": 1.0, "lng": 1.0, "address": "x", "distance_km": km,
            "dims": {"service": "sit_down", "spice": "mild", "setting": "indoor", "price": "mid", "diet": diet}}


# --- detection ------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("must have chicken", ["chicken"]),
    ("We MUST have chicken tonight", ["chicken"]),
    ("has to be seafood", ["seafood"]),
    ("she has to have rice", ["rice"]),
    ("need noodles", ["noodles"]),
    ("gotta have ayam", ["chicken"]),
    ("must have fried chicken", ["chicken"]),
    ("must have chicken and rice", ["chicken", "rice"]),
    ("must have chicken or fish", ["chicken", "seafood"]),
    ("definitely need mee", ["noodles"]),
    ("must have udang", ["seafood"]),
    ("have to have pizza, spicy", ["pizza"]),
    ("must have chicken, biryani if possible", ["chicken"]),
    ("spicy, must have daging", ["beef"]),
])
def test_detect_musts(text, expected):
    assert detect_musts(text) == expected


@pytest.mark.parametrize("text", [
    "chicken biryani",              # a mention, not a demand
    "I love chicken",
    "no chicken please",
    "must not have chicken",
    "we don't need rice",
    "no need for noodles",
    "we need somewhere cheap",
    "we need to decide quickly",
    "must have halal",              # diets are the diet guard's job, not a food
    "",
])
def test_detect_musts_ignores_mentions_negations_and_non_foods(text):
    assert detect_musts(text) == []


def test_a_demand_only_reaches_to_the_end_of_its_clause():
    # "rice" is in a later clause that isn't a demand.
    assert detect_musts("must have chicken, we also like rice") == ["chicken"]
    assert detect_musts("need a quiet place but love noodles") == []


# --- what a place can serve -----------------------------------------------------

def test_dessert_drinks_and_bakery_places_can_serve_nothing():
    for p in (place("Baskin-Robbins", "Ice Cream Shop"), place("Sweet Bakes", "Bakery"), place("The Bar", "Bar")):
        assert serves(p, "chicken") is False
        assert serves(p, "rice") is False


def test_clear_signs_of_chicken():
    assert serves(place("Ayam Gepuk Pak Gembus", "Indonesian"), "chicken") is True
    assert serves(place("Anything", "Chicken"), "chicken") is True            # chicken_restaurant category
    assert serves(place("KFC Taman Molek", "Fast Food"), "chicken") is True
    assert serves(place("Wing Zone", "Restaurant"), "chicken") is True


def test_a_broadly_served_food_is_not_ruled_out_just_for_lacking_a_sign():
    # Most Malay / Indian / Chinese restaurants serve chicken whatever they're called.
    assert serves(place("Restoran Sin Kee", "Malaysian"), "chicken") is None
    assert serves(place("Madras Kitchen", "Indian"), "rice") is True  # an Indian label is a sign for rice


def test_meat_musts_rule_out_vegetarian_and_vegan_places():
    veg = place("Green Leaf", "Vegetarian", diet="vegetarian")
    vegan = place("Plant Kitchen", "Vegan", diet="vegan")
    for p in (veg, vegan):
        assert serves(p, "chicken") is False
        assert serves(p, "beef") is False
        assert serves(p, "meat") is False
    assert serves(veg, "rice") is None  # rice is fine


def test_pork_rules_out_halal_places():
    assert serves(place("Halal Corner", "Malaysian", diet="halal", tags=["halal"]), "pork") is False
    assert serves(place("Ah Hock Bak Kut Teh", "Chinese"), "pork") is True


def test_specific_dishes_need_a_sign():
    # A pizza must-have isn't satisfied by a place with nothing pizza about it.
    assert serves(place("Mamak Bistro", "Indian"), "pizza") is False
    assert serves(place("Pizza Hut", "Fast Food"), "pizza") is True
    assert serves(place("Trattoria", "Italian"), "pizza") is True
    assert serves(place("Burger Barn", "American"), "burger") is True
    assert serves(place("Thai Orchid", "Thai"), "burger") is False
    assert serves(place("Sate Kajang", "Malaysian"), "satay") is True


def test_noodles_and_seafood_accept_the_cuisines_that_serve_them():
    assert serves(place("Restoran Ah Lim", "Chinese"), "noodles") is True
    assert serves(place("Steak House", "American"), "noodles") is False
    assert serves(place("Sushi Tei", "Japanese"), "seafood") is True
    assert serves(place("Burger Barn", "American"), "seafood") is False


def test_a_name_that_merely_contains_mi_is_not_a_noodle_sign():
    assert serves(place("Mi Casa", "Mexican"), "noodles") is False


# --- filtering and reporting ----------------------------------------------------

def test_filter_drops_places_that_cant_serve_and_keeps_order():
    pool = [
        place("Baskin-Robbins", "Ice Cream Shop", pid="ice"),
        place("Ayam Penyet", "Indonesian", pid="ayam"),
        place("Green Leaf", "Vegetarian", diet="vegetarian", pid="veg"),
        place("Restoran Sin Kee", "Malaysian", pid="kee"),
    ]
    assert [p["id"] for p in filter_for_musts(pool, ["chicken"])] == ["ayam", "kee"]


def test_several_musts_only_need_one_to_be_servable():
    pool = [place("Sushi Tei", "Japanese", pid="sushi"), place("Trattoria", "Italian", pid="pizza"),
            place("Burger Barn", "American", pid="burger")]
    kept = filter_for_musts(pool, ["pizza", "seafood"])
    assert {p["id"] for p in kept} == {"sushi", "pizza"}  # the burger place suits neither


def test_a_rule_that_would_leave_nothing_returns_the_pool_unfiltered():
    only = [place("Baskin-Robbins", "Ice Cream Shop"), place("Sweet Bakes", "Bakery")]
    assert filter_for_musts(only, ["chicken"]) == only


def test_no_musts_changes_nothing():
    pool = [place("Baskin-Robbins", "Ice Cream Shop")]
    assert filter_for_musts(pool, []) == pool


def test_unmet_musts_lists_what_nothing_clearly_serves():
    pool = [place("Restoran Sin Kee", "Malaysian"), place("Ayam Penyet", "Indonesian")]
    assert unmet_musts(pool, ["chicken"]) == []
    assert unmet_musts([place("Restoran Sin Kee", "Malaysian")], ["chicken"]) == ["chicken"]
    assert unmet_musts(pool, ["chicken", "pizza"]) == ["pizza"]
    assert unmet_musts(pool, []) == []


# --- through the real shortlist ---------------------------------------------------

def _no_routing(monkeypatch):
    monkeypatch.setattr(candidates, "_route_table", lambda lat, lng, places: {})


def test_places_that_clearly_serve_it_take_the_shortlist_slots_even_when_farther(monkeypatch):
    _no_routing(monkeypatch)
    # Ten unmarked restaurants closer than the two chicken places.
    results = [place(f"Restoran {i}", "Malaysian", 0.1 * i, pid=f"r{i}") for i in range(1, 11)]
    # Same cuisine as the rest, so the default one-per-cuisine pick can't
    # rescue them - only the must-have can put them first.
    results += [place("Ayam Penyet Pak Ali", "Malaysian", 4.0, pid="ayam"),
                place("Chicken Corner", "Malaysian", 4.5, pid="chicken-corner")]
    params = candidates._radius_params(5)

    with_must = candidates._finalize_candidates(1.0, 1.0, results, 5, params, musts=["chicken"])
    assert [c["id"] for c in with_must[:2]] == ["ayam", "chicken-corner"]

    without = candidates._finalize_candidates(1.0, 1.0, results, 5, params)
    assert "ayam" not in {c["id"] for c in without}  # 8 nearer places took every slot


def test_a_must_have_drops_dessert_shops_even_with_no_meal_rule(monkeypatch):
    _no_routing(monkeypatch)
    results = [place(f"Baskin-Robbins {i}", "Ice Cream Shop", 0.1 * i, pid=f"d{i}") for i in range(1, 5)]
    results += [place(f"Restoran {i}", "Malaysian", float(i), pid=f"r{i}") for i in range(1, 6)]
    params = candidates._radius_params(10)
    final = candidates._finalize_candidates(1.0, 1.0, results, 10, params, musts=["chicken"])
    assert not any(c["id"].startswith("d") for c in final)


def test_a_named_place_survives_the_must_have_rule(monkeypatch):
    _no_routing(monkeypatch)
    results = [place(f"Restoran {i}", "Malaysian", float(i), pid=f"r{i}") for i in range(1, 6)]
    results.append(place("Baskin-Robbins", "Ice Cream Shop", 2.0, pid="baskin"))
    params = candidates._radius_params(10)
    final = candidates._finalize_candidates(
        1.0, 1.0, results, 10, params, mention_text="must have chicken, then baskin robbins", musts=["chicken"],
    )
    assert final[0]["id"] == "baskin"


def test_get_candidates_applies_musts_and_the_meal_together_on_overture_data(monkeypatch):
    _no_routing(monkeypatch)
    monkeypatch.setattr(candidates, "detect_country", lambda lat, lng, timeout_s=6: None)
    raw = [
        ("ice", "Baskin-Robbins", "ice_cream_shop", 0.001),
        ("waffle", "DD Famous Waffle", "restaurant", 0.002),
        ("veg", "Green Leaf", "vegetarian_restaurant", 0.003),
        ("chicken", "Chicken House", "chicken_restaurant", 0.030),
        ("ayam", "Ayam Penyet Ali", "indonesian_restaurant", 0.031),
        ("plain", "Restoran Sin Kee", "chinese_restaurant", 0.004),
    ]
    places = [{"id": i, "name": n, "lat": 1.4215 + off, "lng": 103.659, "country": "MY", "category": cat,
               "address": ""} for i, n, cat, off in raw]
    index = {}
    for p in places:
        index.setdefault(candidates._overture_grid_cell(p["lat"], p["lng"]), []).append(p)
    monkeypatch.setattr(candidates, "_overture_index", index)

    final, _ = candidates.get_candidates({"lat": 1.4215, "lng": 103.659}, radius_km=5, meal="lunch",
                                         musts=["chicken"])
    ids = [c["id"] for c in final]
    assert ids[:2] == ["chicken", "ayam"]                     # clear signs first
    assert "plain" in ids                                      # not ruled out
    assert not {"ice", "waffle", "veg"} & set(ids)             # can't serve it / not a meal
