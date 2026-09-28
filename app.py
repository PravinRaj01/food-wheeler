"""
The Food-Wheeler — Flask backend.

Two partners on one phone enter their preferences (typed or via the
browser's Web Speech API). This backend fetches nearby restaurants
(real via OSM Overpass, or mock in demo mode), scores them against both
partners' text with a pluggable decision engine (Laya, GLiNER2.5-Decide,
or the optional remote CLM-8B), and either returns a confident winner or
a mediator tie-breaker question. All engine-specific logic lives in
engines/; everything below the engine.score() call is engine-agnostic.
"""
import os
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from functools import wraps

from flask import Flask, jsonify, request

from candidates import DEFAULT_RADIUS_KM, PRICE_TIER_MAX, clamp_radius_km, get_candidates, list_places, with_colors
from engines import (
    EngineManager,
    EngineScoreError,
    EngineUnavailableError,
    UnknownEngineError,
    build_default_registry,
)

app = Flask(__name__)

# ---------------------------------------------------------------------------
# CORS — the frontend (Next.js on Vercel) is a separate origin from this API
# (Cloud Run). No flask-cors dependency; this is small enough to do by hand.
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = {
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()
}
# Vercel preview deploys get a unique per-branch/per-commit subdomain; this
# matches any of them under the account rather than hardcoding one.
VERCEL_PREVIEW_RE = re.compile(
    os.environ.get("VERCEL_PREVIEW_ORIGIN_REGEX", r"^https://[a-z0-9-]+-pravinraj01\.vercel\.app$")
)


def _origin_allowed(origin: str | None) -> bool:
    if not origin:
        return False
    return origin in ALLOWED_ORIGINS or bool(VERCEL_PREVIEW_RE.match(origin))


@app.after_request
def _add_cors_headers(response):
    origin = request.headers.get("Origin")
    if _origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Max-Age"] = "86400"
    return response


@app.route("/api/<path:_unused>", methods=["OPTIONS"])
def _cors_preflight(_unused):
    return "", 204

# ---------------------------------------------------------------------------
# Rate limiting — /api/decide runs the AI engine and (on a cache miss) an
# Overpass query, so it's the endpoint worth protecting on a public API with
# no auth in front of it. A plain in-memory token bucket per IP is enough:
# the Dockerfile runs a single gunicorn worker, so there's exactly one
# process holding this dict — no Redis needed. Stale IPs are pruned lazily
# (a 1-in-500 chance per request) rather than on a schedule, so the bucket
# dict never grows unbounded over a long-running container's lifetime.
# ---------------------------------------------------------------------------
RATE_LIMIT_CAPACITY = 10  # burst allowance
RATE_LIMIT_REFILL_PER_SEC = 10 / 60  # sustained ~1 request per 6s per IP
RATE_LIMIT_STALE_AFTER_S = 600

_rate_limit_lock = threading.Lock()
_rate_limit_buckets: dict[str, tuple[float, float]] = {}  # ip -> (tokens, last_seen)


def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _rate_limit_hit(ip: str) -> bool:
    now = time.time()
    with _rate_limit_lock:
        if secrets.randbelow(500) == 0:
            stale = [k for k, (_, last) in _rate_limit_buckets.items() if now - last > RATE_LIMIT_STALE_AFTER_S]
            for k in stale:
                del _rate_limit_buckets[k]

        tokens, last = _rate_limit_buckets.get(ip, (float(RATE_LIMIT_CAPACITY), now))
        tokens = min(RATE_LIMIT_CAPACITY, tokens + (now - last) * RATE_LIMIT_REFILL_PER_SEC)
        if tokens < 1:
            _rate_limit_buckets[ip] = (tokens, now)
            return True
        _rate_limit_buckets[ip] = (tokens - 1, now)
        return False


def rate_limited(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if _rate_limit_hit(_client_ip()):
            return jsonify({
                "status": "error", "code": "RATE_LIMITED",
                "message": "Too many requests — please wait a few seconds and try again.",
            }), 429
        return f(*args, **kwargs)
    return wrapper


MAX_INPUT_CHARS = 500
TIE_EPSILON = 0.02
MAX_TIEBREAKER_ROUNDS = 2
CONFIDENCE_THRESHOLDS = {"laya": 0.70, "gliner": 0.70, "clm_8b": 0.70}
DEFAULT_THRESHOLD = 0.70
DEV_MODE_ALLOWED = os.environ.get("DEV_MODE_ALLOWED", "1") != "0"
SECONDARY_ENGINE_TIMEOUT_S = 8


def confidence_threshold(engine_id: str) -> float:
    return CONFIDENCE_THRESHOLDS.get(engine_id, DEFAULT_THRESHOLD)


# ---------------------------------------------------------------------------
# Engine manager — lazy-loads every engine except the default, which is
# warmed at import time. See engines/__init__.py for the memory-safe
# load/evict logic that keeps this within a free Space's RAM budget.
# ---------------------------------------------------------------------------
manager = EngineManager(build_default_registry())
_default_engine_error: str | None = None
try:
    manager.get(manager.default_id)
except (UnknownEngineError, EngineUnavailableError) as exc:
    _default_engine_error = str(exc)


# ---------------------------------------------------------------------------
# Mediator question bank
# ---------------------------------------------------------------------------
DIMENSION_ORDER = ["service", "spice", "setting", "price", "diet", "cuisine"]

DIMENSION_VALUES = {
    "service": {
        "fast_food": {"label": "Fast Food", "emoji": "🌮", "text": "Quick casual counter service"},
        "sit_down": {"label": "Sit-down Dining", "emoji": "🍽️", "text": "Sit-down table service"},
    },
    "spice": {
        "hot": {"label": "Spicy", "emoji": "🌶️", "text": "Bring the heat"},
        "mild": {"label": "Mild", "emoji": "🥛", "text": "Keep it mild"},
    },
    "setting": {
        "patio": {"label": "Patio", "emoji": "🌳", "text": "Outdoor patio seating"},
        "indoor": {"label": "Cozy Indoors", "emoji": "🏠", "text": "Indoor seating"},
    },
    "price": {
        "low": {"label": "Cheap Eats", "emoji": "💸", "text": "Keep it budget-friendly"},
        "mid": {"label": "Mid-range", "emoji": "💵", "text": "Mid-range price is fine"},
        "high": {"label": "Treat Ourselves", "emoji": "💎", "text": "Let's splurge a little"},
    },
    "diet": {
        "vegan": {"label": "Vegan-friendly", "emoji": "🌱", "text": "Needs to be vegan-friendly"},
        "halal": {"label": "Halal", "emoji": "🥙", "text": "Needs to be halal"},
        "gluten_free": {"label": "Gluten-free", "emoji": "🌾", "text": "Needs to be gluten-free"},
        "none": {"label": "No restrictions", "emoji": "🍖", "text": "No dietary restrictions"},
    },
}

MEDIATOR_PROMPT = "Vibes are conflicting! Decide together:"


def _cuisine_option(cuisine: str) -> dict:
    return {"label": cuisine, "emoji": "🍴", "text": f"{cuisine} food"}


def build_mediator_question(top1: dict, top2: dict, asked_ids: set[str]) -> dict | None:
    for dim in DIMENSION_ORDER:
        if dim in asked_ids:
            continue
        if dim == "cuisine":
            v1, v2 = top1.get("cuisine"), top2.get("cuisine")
        else:
            v1, v2 = top1["dims"].get(dim), top2["dims"].get(dim)
        if not v1 or not v2 or v1 == v2:
            continue

        bank = DIMENSION_VALUES.get(dim, {})
        opt1 = bank.get(v1) or _cuisine_option(str(v1).replace("_", " ").title())
        opt2 = bank.get(v2) or _cuisine_option(str(v2).replace("_", " ").title())
        return {
            "id": dim,
            "prompt": MEDIATOR_PROMPT,
            "options": [
                {"answer": v1, **opt1},
                {"answer": v2, **opt2},
            ],
        }
    return None


# ---------------------------------------------------------------------------
# Hard-constraint guards (regex-based, run before any engine so explicit
# exclusions, budgets and diet requirements can't be overridden by a model).
# ---------------------------------------------------------------------------
_EXCLUSION_RE = re.compile(r"\b(?:no|not|avoid|without)\s+([a-z]+(?:\s[a-z]+)?)", re.IGNORECASE)
_BUDGET_RE = re.compile(r"(?:under|below|less than)\s*\$?\s*(\d+)", re.IGNORECASE)
_EXCLUSION_STOPWORDS = {"please", "thanks", "really", "very", "so", "too", "any", "more"}
_NEGATION_WORDS = {"no", "not", "avoid", "without"}
_DIET_PATTERNS = [
    ("vegan", re.compile(r"\bvegan\b")),
    ("halal", re.compile(r"\bhalal\b")),
    ("gluten_free", re.compile(r"\bgluten[\s-]?free\b")),
]


def _is_negated(text_lower: str, match_start: int) -> bool:
    prefix_words = text_lower[:match_start].split()
    return bool(prefix_words) and prefix_words[-1] in _NEGATION_WORDS


def _detect_diet_requirement(text_lower: str) -> str | None:
    for diet_id, pattern in _DIET_PATTERNS:
        for m in pattern.finditer(text_lower):
            if not _is_negated(text_lower, m.start()):
                return diet_id
    return None


def apply_guards(combined_text: str, cands: list[dict]) -> tuple[list[dict], set[str]]:
    """Returns (filtered_candidates, exclusion_keywords). Filtering happens
    here in Python so every engine sees the same, already-narrowed list —
    this is what fixed the real failure we measured where a model ignored
    an explicit "no burgers" instruction."""
    text_lower = combined_text.lower()
    filtered = list(cands)

    budget_match = _BUDGET_RE.search(text_lower)
    if budget_match:
        budget = int(budget_match.group(1))
        by_budget = [c for c in filtered if PRICE_TIER_MAX.get(c["price"].lstrip("~"), 999) <= budget]
        if by_budget:
            filtered = by_budget

    exclusions = set()
    for m in _EXCLUSION_RE.finditer(text_lower):
        # Split the captured 1-2 word phrase so the meaningful keyword is
        # matched on its own, e.g. "no heavy burgers" -> {"heavy", "burgers"}
        # rather than a phrase that won't appear verbatim in any tag.
        for word in m.group(1).split():
            if word not in _EXCLUSION_STOPWORDS:
                exclusions.add(word)
    if exclusions:
        def excluded(c):
            haystack = " ".join([c["name"], c["cuisine"], *c["tags"]]).lower()
            return any(ex in haystack for ex in exclusions)

        by_exclusion = [c for c in filtered if not excluded(c)]
        if by_exclusion:
            filtered = by_exclusion

    diet_req = _detect_diet_requirement(text_lower)
    if diet_req:
        by_diet = [c for c in filtered if c.get("dims", {}).get("diet") == diet_req]
        if by_diet:
            filtered = by_diet
        # If nothing matches, we keep the wider list — the diet tag is still
        # visible in each candidate's description, so the engine can weigh
        # it even though nothing can be guaranteed to satisfy it.

    return (filtered if filtered else cands), exclusions


# ---------------------------------------------------------------------------
# State construction (shared by every engine)
# ---------------------------------------------------------------------------
def build_state(partner1_text: str, partner2_text: str, tiebreakers: list[dict]) -> str:
    lines = []
    lines.append(f"Partner 1 wants: {partner1_text}." if partner1_text else "Partner 1: no preference.")
    lines.append(f"Partner 2 wants: {partner2_text}." if partner2_text else "Partner 2: no preference.")
    for tb in tiebreakers:
        text = tb.get("text")
        if text:
            lines.append(f"Both agreed: {text}.")
    lines.append("Goal: choose the ONE restaurant that satisfies both partners best.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Deterministic tie-break, used only when no mediator dimension separates
# the tied venues (so asking a question would be pointless).
# ---------------------------------------------------------------------------
def deterministic_tiebreak(tied: list[dict]) -> dict:
    def sort_key(c):
        return (c.get("distance_km", 999), PRICE_TIER_MAX.get(c["price"].lstrip("~"), 999))

    ranked = sorted(tied, key=sort_key)
    best = ranked[0]
    if len(ranked) > 1 and sort_key(ranked[0]) == sort_key(ranked[1]):
        tied_best = [c for c in ranked if sort_key(c) == sort_key(ranked[0])]
        best = secrets.choice(tied_best)
    return best


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
class ValidationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message


def _validate(body: dict):
    p1 = (body.get("partner1") or {}).get("text", "") or ""
    p2 = (body.get("partner2") or {}).get("text", "") or ""
    p1, p2 = p1.strip(), p2.strip()

    if not p1 and not p2:
        raise ValidationError("EMPTY_INPUT", "At least one partner needs to say something!")
    if len(p1) > MAX_INPUT_CHARS or len(p2) > MAX_INPUT_CHARS:
        raise ValidationError("INPUT_TOO_LONG", f"Keep it under {MAX_INPUT_CHARS} characters each.")

    tiebreakers = body.get("tiebreakers") or []
    round_num = int(body.get("round") or 0)
    location = body.get("location")
    candidates_in = body.get("candidates")  # optional full echo from a previous response
    source_in = body.get("source")
    engine_id = body.get("engine") or manager.default_id
    dev_mode = bool(body.get("dev_mode")) and DEV_MODE_ALLOWED
    radius_km = clamp_radius_km(body.get("radius_km", DEFAULT_RADIUS_KM))
    return p1, p2, tiebreakers, round_num, location, candidates_in, source_in, engine_id, dev_mode, radius_km


# ---------------------------------------------------------------------------
# Ranking, ties and branching — identical for every engine. This is what
# lets the One Joint Tap mediator flow behave the same no matter which
# engine answered.
# ---------------------------------------------------------------------------
def rank_and_branch(probs: dict, filtered: list[dict], round_num: int, source: str,
                     cands: list[dict], asked_dims: set[str], engine_meta: dict, t0: float) -> dict:
    by_id = {c["id"]: c for c in filtered}
    ranking = sorted(
        ({"id": cid, "name": by_id[cid]["name"], "probability": p, "color": by_id[cid]["color"]}
         for cid, p in probs.items() if cid in by_id),
        key=lambda r: r["probability"], reverse=True,
    )
    if not ranking:
        raise ValueError("engine returned no usable probabilities for the given candidates")

    threshold = confidence_threshold(engine_meta["id"])
    top = ranking[0]
    second = ranking[1] if len(ranking) > 1 else None
    is_tie = second is not None and (top["probability"] - second["probability"]) < TIE_EPSILON

    if round_num >= MAX_TIEBREAKER_ROUNDS:
        tied_group = [r for r in ranking if top["probability"] - r["probability"] < TIE_EPSILON] \
            if is_tie else ranking[:2]
        tied_ids = {r["id"] for r in tied_group}
        winner_cand = deterministic_tiebreak([c for c in filtered if c["id"] in tied_ids])
        winner_row = next(r for r in ranking if r["id"] == winner_cand["id"])
        return _match_payload(winner_cand, ranking, "fair_spin", winner_row["probability"],
                               source, cands, round_num, t0, engine_meta, wheel_ids=list(tied_ids))

    if top["probability"] >= threshold and not is_tie:
        winner_cand = by_id[top["id"]]
        return _match_payload(winner_cand, ranking, "confident", top["probability"],
                               source, cands, round_num, t0, engine_meta)

    top1_cand = by_id[top["id"]]
    top2_cand = by_id[second["id"]] if second else None
    question = build_mediator_question(top1_cand, top2_cand, asked_dims) if top2_cand else None

    if question is None:
        # No dimension separates the leaders — resolve deterministically
        # instead of asking a pointless question.
        tied_group = [top1_cand] + ([top2_cand] if top2_cand else [])
        winner_cand = deterministic_tiebreak(tied_group)
        winner_row = next(r for r in ranking if r["id"] == winner_cand["id"])
        return _match_payload(winner_cand, ranking, "fair_spin", winner_row["probability"],
                               source, cands, round_num, t0, engine_meta,
                               wheel_ids=[c["id"] for c in tied_group])

    reason = "exact_tie" if is_tie else "low_confidence"
    return {
        "status": "tiebreaker",
        "reason": reason,
        "confidence": round(top["probability"], 4),
        "round": round_num,
        "rounds_left": MAX_TIEBREAKER_ROUNDS - round_num,
        "question": question,
        "contenders": [top, second],
        "candidates": cands,
        "source": source,
        "engine": engine_meta,
    }


def _match_payload(winner_cand, ranking, reason, confidence, source, cands, round_num, t0,
                    engine_meta, wheel_ids=None):
    payload = {
        "status": "match",
        "reason": reason,
        "confidence": round(confidence, 4),
        "source": source,
        "winner": winner_cand,
        "ranking": [{**r, "probability": round(r["probability"], 4)} for r in ranking],
        "candidates": cands,
        "round": round_num,
        "latency_ms": round((time.time() - t0) * 1000, 1),
        "engine": engine_meta,
    }
    if wheel_ids:
        payload["wheel_ids"] = wheel_ids
    return payload


# ---------------------------------------------------------------------------
# Dev Mode: scores every other available engine alongside the primary one,
# purely for comparison. It can never change the game's outcome and can
# never fail the main request — a broken secondary engine just shows up as
# unavailable in the comparison payload.
# ---------------------------------------------------------------------------
def _score_secondary(engine_id: str, state: str, filtered: list[dict], exclusions: set[str],
                      by_id: dict, winner_id: str | None, primary_id: str) -> dict:
    try:
        engine = manager.get(engine_id, protect={primary_id})
        result = engine.score(state, filtered, exclusions)
        if not result.probabilities:
            raise EngineScoreError("no probabilities returned")
        top_id, top_p = max(result.probabilities.items(), key=lambda kv: kv[1])
        return {
            "top_id": top_id,
            "top_name": by_id.get(top_id, {}).get("name", top_id),
            "top_p": round(top_p, 4),
            "winner_p": round(result.probabilities.get(winner_id, 0.0), 4) if winner_id else None,
            "latency_ms": round(result.latency_ms, 1),
            "primary": False,
            "agrees": (top_id == winner_id) if winner_id else None,
        }
    except Exception as exc:  # noqa: BLE001 - Dev Mode must never break the main response
        reason = exc.reason if isinstance(exc, EngineUnavailableError) else str(exc)
        return {"error": "ENGINE_UNAVAILABLE", "reason": reason}


def run_dev_mode_comparison(primary_engine_id: str, primary_result, state: str,
                             filtered: list[dict], exclusions: set[str], winner_id: str | None) -> dict:
    by_id = {c["id"]: c for c in filtered}
    comparison = {}

    primary_top_id, primary_top_p = max(primary_result.probabilities.items(), key=lambda kv: kv[1])
    comparison[primary_engine_id] = {
        "top_id": primary_top_id,
        "top_name": by_id.get(primary_top_id, {}).get("name", primary_top_id),
        "top_p": round(primary_top_p, 4),
        "winner_p": round(primary_result.probabilities.get(winner_id, 0.0), 4) if winner_id else None,
        "latency_ms": round(primary_result.latency_ms, 1),
        "primary": True,
        "agrees": True,
    }

    other_ids = [eid for eid in manager.ids() if eid != primary_engine_id]
    if not other_ids:
        return comparison

    with ThreadPoolExecutor(max_workers=len(other_ids)) as pool:
        futures = {
            pool.submit(_score_secondary, eid, state, filtered, exclusions, by_id,
                        winner_id, primary_engine_id): eid
            for eid in other_ids
        }
        for fut, eid in futures.items():
            try:
                comparison[eid] = fut.result(timeout=SECONDARY_ENGINE_TIMEOUT_S)
            except FutureTimeoutError:
                comparison[eid] = {"error": "ENGINE_UNAVAILABLE", "reason": "timed out"}
            except Exception as exc:  # noqa: BLE001 - defense in depth
                comparison[eid] = {"error": "ENGINE_UNAVAILABLE", "reason": str(exc)}

    return comparison


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def index():
    # v1's single-page frontend (templates/index.html) is retired - the real
    # UI is the Next.js app in web/, deployed separately (Vercel). This API
    # has no page of its own to serve; a small JSON banner is more useful
    # here than a 404 for anyone who lands on the bare API origin directly.
    return jsonify({
        "service": "food-wheeler-api",
        "status": "ok",
        "docs": "https://github.com/PravinRaj01/food-wheeler",
    })


@app.get("/api/health")
def health():
    return jsonify({
        "model_ready": manager.default_id in manager.loaded_ids(),
        "model_error": _default_engine_error,
        "engines_loaded": manager.loaded_ids(),
        "ram_available_mb": round(manager.available_ram_mb(), 1),
    })


@app.get("/api/engines")
def list_engines():
    return jsonify(manager.list_status())


@app.get("/api/places")
def places_route():
    """The Explore page's browsing endpoint - up to 60 nearby places, no AI
    scoring involved. Separate from /api/decide's curated, capped list."""
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    location = {"lat": lat, "lng": lng} if lat is not None and lng is not None else None

    radius_km = clamp_radius_km(request.args.get("radius_km", DEFAULT_RADIUS_KM, type=float))
    cuisine = request.args.get("cuisine") or None
    diet = request.args.get("diet") or None

    places, source = list_places(location, radius_km=radius_km, cuisine=cuisine, diet=diet)
    return jsonify({"places": places, "source": source, "radius_km": radius_km})


@app.post("/api/engines/<engine_id>/warm")
def warm_engine(engine_id):
    return jsonify(manager.warm(engine_id))


@app.post("/api/decide")
@rate_limited
def decide():
    body = request.get_json(silent=True) or {}
    try:
        (p1, p2, tiebreakers, round_num, location, candidates_in,
         source_in, engine_id, dev_mode, radius_km) = _validate(body)
    except ValidationError as e:
        return jsonify({"status": "error", "code": e.code, "message": e.message}), 400

    try:
        engine = manager.get(engine_id, protect={engine_id})
    except UnknownEngineError as e:
        return jsonify({"status": "error", "code": "UNKNOWN_ENGINE",
                         "message": f"Unknown engine: {e.engine_id}"}), 400
    except EngineUnavailableError as e:
        return jsonify({"status": "error", "code": "ENGINE_UNAVAILABLE",
                         "message": e.reason, "engine_id": e.engine_id}), 503

    t0 = time.time()

    if candidates_in:
        cands, source = candidates_in, source_in or "osm"
    else:
        cands, source = get_candidates(location, radius_km=radius_km)
    cands = with_colors(cands)

    combined_text = " ".join([p1, p2] + [tb.get("text", "") for tb in tiebreakers])
    filtered, exclusions = apply_guards(combined_text, cands)
    asked_dims = {tb["question_id"] for tb in tiebreakers if tb.get("question_id")}

    if len(filtered) == 1:
        winner = filtered[0]
        engine_meta = {"id": engine.id, "label": engine.label, "score_type": "probability",
                        "raw_top": None, "fallback_from": None, "latency_ms": 0.0}
        payload = _match_payload(winner, [{**winner, "probability": 1.0}], "only_option", 1.0,
                                  source, cands, round_num, t0, engine_meta)
        if dev_mode:
            # Normally this path skips scoring entirely - the outcome is
            # forced regardless of what any engine says. Dev Mode is the one
            # exception: it explicitly asks "how would every engine have
            # scored this", so it's worth the extra (still fast, one
            # candidate) score call purely for that comparison payload.
            state = build_state(p1, p2, tiebreakers)
            try:
                result = engine.score(state, filtered, exclusions)
                if not result.probabilities:
                    raise EngineScoreError("no probabilities returned")
                payload["comparison"] = run_dev_mode_comparison(
                    engine.id, result, state, filtered, exclusions, winner["id"])
            except EngineScoreError:
                pass  # comparison is best-effort - never break the only_option response over it
        return jsonify(payload)

    state = build_state(p1, p2, tiebreakers)

    fallback_from = None
    try:
        result = engine.score(state, filtered, exclusions)
        engine_used = engine
    except EngineScoreError as exc:
        if engine.id == manager.default_id:
            return jsonify({"status": "error", "code": "MODEL_ERROR", "message": str(exc)}), 500
        try:
            engine_used = manager.get(manager.default_id, protect={engine.id})
            result = engine_used.score(state, filtered, exclusions)
            fallback_from = engine.id
        except (EngineUnavailableError, EngineScoreError) as fallback_exc:
            return jsonify({"status": "error", "code": "MODEL_ERROR",
                             "message": f"{exc}; fallback also failed: {fallback_exc}"}), 500

    engine_meta = {
        "id": engine_used.id, "label": engine_used.label, "score_type": "probability",
        "raw_top": (max(result.raw_scores.values()) if result.raw_scores else None),
        "fallback_from": fallback_from,
        "latency_ms": round(result.latency_ms, 1),
    }

    try:
        payload = rank_and_branch(result.probabilities, filtered, round_num, source, cands,
                                   asked_dims, engine_meta, t0)
    except ValueError as exc:
        return jsonify({"status": "error", "code": "MODEL_ERROR", "message": str(exc)}), 500

    if dev_mode:
        winner_id = payload.get("winner", {}).get("id")
        payload["comparison"] = run_dev_mode_comparison(
            engine_used.id, result, state, filtered, exclusions, winner_id)

    return jsonify(payload)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
