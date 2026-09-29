"""
Builds data/places_my_sg.parquet - a bundled offline snapshot of Malaysia
and Singapore restaurants/cafes from Overture Maps Places, so candidates.py
doesn't depend on public OSM Overpass mirrors (which were rate-limiting
Cloud Run's shared egress IPs into an outright 503 - see the "dock/PWA
polish, border fix, place-data quality" plan) for its main country.

Run manually whenever Overture publishes a new monthly release:

    python scripts/build_places.py

Needs `duckdb` (not a runtime dependency of app.py - only this script and
candidates.py's Overture loader need it, and the loader only needs it to
read the parquet file, not to hit the network). Queries Overture's public
GeoParquet release directly from S3 (anonymous, no AWS credentials needed).
"""
import pathlib
import time

import duckdb

# Bumped whenever this script is re-run against a newer Overture release -
# see https://docs.overturemaps.org/release/ for the latest tag.
OVERTURE_RELEASE = "2026-09-23.1"
OVERTURE_PLACES = (
    f"s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}"
    "/theme=places/type=place/*.parquet"
)

# A loose bounding box covering BOTH West Malaysia+Singapore and East
# Malaysia (Sabah/Sarawak, on Borneo) - these are two disjoint landmasses
# with open ocean and other countries' waters in between, so the bbox on
# its own is deliberately generous (it exists only to let Overture's
# reader skip irrelevant row groups); addresses[1].country below is what
# actually restricts the output to MY/SG, dropping the Indonesian,
# Bruneian etc. places this loose bbox also happens to catch.
BBOX = {"min_lng": 99.5, "max_lng": 119.5, "min_lat": 0.8, "max_lat": 7.5}
COUNTRIES = ("MY", "SG")

# Every Overture "eating/drinking place" category found in this region
# (see the plan's N2 spike): every *_restaurant leaf category, plus the
# handful of standalone ones that don't follow that naming pattern.
# Deliberately excludes categories that matched a naive "restaurant"/
# "food" substring search but aren't actually a place to eat at:
# restaurant_equipment_and_supply, restaurant_wholesale, seafood_market/
# _wholesaler, food_bank, food_safety_training, food_tour, food_consultant,
# food_and_beverage_exporter/_distributor/_consultant/_store, frozen_foods_store,
# health_food_store, imported_food_store, specialty_foods_store,
# coffee_and_tea_supplies, internet_cafe, food_delivery_service, food_and_drink
# (too generic - not reliably a real venue).
RESTAURANT_SUFFIX_EXCLUDE = {"restaurant_equipment_and_supply", "restaurant_wholesale"}
EXTRA_FOOD_CATEGORIES = {
    "restaurant", "cafe", "cafeteria", "coffee_shop", "coffee_roastery", "bakery",
    "bar", "pub", "dessert_shop", "ice_cream_shop", "food_court", "food_truck_stand",
    "hong_kong_style_cafe", "soul_food",
}

# Below this, Overture's own confidence score is noisy enough (stale/
# duplicate/mis-geocoded listings) that including them hurt more than
# missing them - see the spike's confidence-bucket histogram (about 6% of
# rows fall under this, evenly spread from clearly-real to clearly-junk).
MIN_CONFIDENCE = 0.3

OUT_PATH = pathlib.Path(__file__).resolve().parent.parent / "data" / "places_my_sg.parquet"


def _food_categories() -> list[str]:
    """The *_restaurant leaves are queried fresh from Overture's own
    taxonomy each run instead of hand-typed, so a newly added cuisine
    category (Overture adds a few every release) is picked up automatically
    rather than silently missing until someone notices and updates a list."""
    con = _connect()
    q = f"""
    SELECT DISTINCT taxonomy.primary
    FROM read_parquet('{OVERTURE_PLACES}', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN {BBOX["min_lng"]} AND {BBOX["max_lng"]}
      AND bbox.ymin BETWEEN {BBOX["min_lat"]} AND {BBOX["max_lat"]}
      AND taxonomy.primary LIKE '%restaurant%'
    """
    leaves = {r[0] for r in con.execute(q).fetchall() if r[0]}
    restaurants = {c for c in leaves if c.endswith("_restaurant") and c not in RESTAURANT_SUFFIX_EXCLUDE}
    return sorted(restaurants | EXTRA_FOOD_CATEGORIES | {"restaurant"})


def _connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET s3_region='us-west-2';")
    return con


def main():
    t0 = time.time()
    con = _connect()
    categories = _food_categories()
    print(f"{len(categories)} food/drink categories, e.g. {categories[:5]}...")

    cats_sql = ",".join(f"'{c}'" for c in categories)
    countries_sql = ",".join(f"'{c}'" for c in COUNTRIES)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    query = f"""
    COPY (
        SELECT
            'overture_' || id AS id,
            names.primary AS name,
            -- Overture points store the same value in xmin/xmax and
            -- ymin/ymax; averaging is a no-op for a point and a harmless
            -- centroid approximation for the rare place with a real
            -- footprint polygon instead of a point.
            (bbox.ymin + bbox.ymax) / 2 AS lat,
            (bbox.xmin + bbox.xmax) / 2 AS lng,
            addresses[1].country AS country,
            taxonomy.primary AS category,
            coalesce(addresses[1].freeform, '') AS address,
            confidence
        FROM read_parquet('{OVERTURE_PLACES}', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {BBOX["min_lng"]} AND {BBOX["max_lng"]}
          AND bbox.ymin BETWEEN {BBOX["min_lat"]} AND {BBOX["max_lat"]}
          AND addresses[1].country IN ({countries_sql})
          AND taxonomy.primary IN ({cats_sql})
          AND confidence >= {MIN_CONFIDENCE}
          AND names.primary IS NOT NULL
    ) TO '{OUT_PATH.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """
    con.execute(query)

    count = con.execute(f"SELECT count(*) FROM read_parquet('{OUT_PATH.as_posix()}')").fetchone()[0]
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"Wrote {count} places to {OUT_PATH} ({size_mb:.1f} MB) in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
