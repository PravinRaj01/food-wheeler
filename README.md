# Food Wheeler

Your third wheel for food decisions. Two people, one phone: you each say what you want, and an
AI decision engine picks a real restaurant nearby — confidently, or by stepping in with one quick
question you answer together. An installable PWA with a Flask API behind it, built on free models
and free map data (Overture Maps, OpenStreetMap), so there are no paid API keys anywhere in the
core experience.

🔗 Live app: https://food-wheeler.vercel.app/

## What it does

- **Two sealed cards, one phone.** Each partner taps their card, types or dictates what they want
  (or taps chips like Malay, Spicy, Budget, Halal), and seals it. Sealed answers stay hidden, so
  whoever goes second can't just agree. Either partner can go first, and "Anything's fine" is a
  valid answer.
- **Real places inside a real radius — by road, not as the crow flies.** In Malaysia and Singapore,
  restaurants come from a bundled offline [Overture Maps](https://overturemaps.org) snapshot (no
  network call, no rate limits); everywhere else it falls back to OpenStreetMap's Overpass API.
  Either way, results are filtered to your own country by default (a "cross-border" switch in
  Settings turns that off near a border), and the radius is enforced against real OSRM driving
  distance, not a straight line. There is no demo data: if location is off, the app asks you to turn
  it on. Directions open in whichever app you pick — Google Maps, Waze, Apple Maps, or Android's own
  app chooser — from Decide's reveal screen or straight off an Explore card.
- **Mention a place and it searches there.** "Something near Mid Valley" re-centres the search on
  that spot instead of your own position (driving distance is still measured from wherever you
  actually are). If you each name somewhere different, it asks which one before fetching anything.
- **Hard rules before any AI.** Budgets ("under RM30", "cheap", "treat ourselves"), exclusions
  ("no seafood") and diets (halal, vegetarian, vegan) are applied deterministically in `app.py`
  before a model ever scores anything, so a model can't talk its way past "no burgers".
- **One question when it's close.** If the top pick is under 70% confident, the third wheel asks a
  single joint question built from what actually separates the finalists ("Patio or cozy
  indoors?"). After two rounds it does a fair spin between the finalists, so you're never stuck.
- **A wheel that always lands where it should.** The landing angle is solved up front, then eased
  into; a 1,000-trial property test checks the needle lands on the chosen slice for every jitter
  and slice count.
- **Pluggable engines.** Laya, GLiNER2.5-Decide, or a remote CLM-8B, picked in Settings. Developer
  mode scores each round with every available engine and shows them side by side.
- **Explore, history, offline.** Browse nearby places on a map with local cuisine filters, keep a
  synced decision history (guests' rounds are queued locally and claimed on sign-in), switch
  between light and dark themes, and install it to your home screen.

## Architecture

```
Browser (Next.js PWA)
  ├─ decide flow                  sealed cards → deciding animation → canvas wheel / mediator
  ├─ Geolocation + Web Speech     location and voice input, browser-native
  ├─ IndexedDB outbox             guest decisions, synced to History after sign-in
  ├─ service worker               app shell + branded offline page
  └─ Flask API (Cloud Run) ──────────────► /api/decide, /api/places  (CORS allowlist)

Flask API (Google Cloud Run)
  ├─ Overture bundle (offline)    Malaysia/Singapore restaurants; in-memory grid index, no network
  ├─ Overpass (OpenStreetMap)     the fallback everywhere else; 3 mirrors raced in parallel, 6 h cache
  ├─ OSRM (routing)               real driving distance/time; 2 mirrors raced, 30 min cache
  ├─ Nominatim (geocoding)        resolves a mentioned place ("near Mid Valley") to a search centre
  ├─ hard guards                  budget / exclusions / diet, applied before any model
  ├─ EngineManager                Laya · GLiNER2.5-Decide · CLM-8B (remote), lazy-loaded, RAM-budgeted
  └─ ranking + mediator           70% confidence rule, one joint question, fair spin after 2 rounds

Next.js server (Vercel)
  ├─ Auth.js v5 (JWT sessions)    Google + email/password (argon2)
  ├─ server actions               history sync, every query scoped to the signed-in user
  └─ Neon Postgres (Drizzle)      users, accounts, decisions, preferences
```

Every engine returns a plain probability per restaurant, so the confidence rule, tie detection and
the mediator behave identically whichever one is selected. Everything below `engine.score()` in
`app.py` is engine-agnostic; each engine is a small wrapper in `engines/`.

| Engine | Notes |
|---|---|
| **Laya** (default) | ConvAI's joint-attention classifier. Fast, runs on CPU. |
| **GLiNER2.5-Decide** | Fastino's CPU-first classifier; tends to honour exclusions more reliably. |
| **CLM-8B** | Stanford/NVIDIA dual-encoder. Needs a GPU embeddings server, so it's off unless configured ([below](#optional-clm-8b)). |

## Tech stack

- **Web app**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Motion, vaul,
  Leaflet
- **Auth & data**: Auth.js v5 (JWT), Drizzle ORM, Neon Postgres (serverless driver)
- **API**: Flask 3 on gunicorn (single worker, threaded), Python 3.12, CPU-only PyTorch
- **Models**: [Laya](https://huggingface.co/convaiinnovations/laya),
  [GLiNER2.5-Decide](https://huggingface.co/fastino/GLiNER2.5-Decide), optional CLM-8B;
  weights are baked into the Docker image at build time
- **Places & maps**: a bundled [Overture Maps](https://overturemaps.org) snapshot for Malaysia/
  Singapore (built with DuckDB, see `scripts/build_places.py`), OpenStreetMap Overpass API as the
  fallback elsewhere, OSRM (real driving distance/time), Nominatim (geocoding a mentioned place),
  Leaflet with OSM tiles
- **Offline**: a hand-written service worker (`web/scripts/sw.template.js`) and an IndexedDB outbox
- **Deployment**: Vercel (web app) + Google Cloud Run (API, redeployed by Cloud Build on push)

## Project structure

```
food-wheeler/
├── app.py                  Flask routes, hard guards, ranking/tie/mediator logic, location mentions, CORS, rate limiting
├── candidates.py           Overture bundle + Overpass fallback, OSRM routing, radius control, Explore listing
├── data/places_my_sg.parquet   bundled Overture snapshot (Malaysia/Singapore restaurants)
├── engines/                DecisionEngine interface, Laya/GLiNER/CLM wrappers, EngineManager
├── tests/                  pytest suite — engines are faked, Overpass/Overture/geocoding are mocked, no network needed
├── scripts/                build_places.py (rebuilds the Overture snapshot), engine probes, compare_engines.py,
│                           prefetch_models.py (Docker build)
├── Dockerfile              the API image (Cloud Run, or a Hugging Face Docker Space)
├── docs/DEPLOYMENT.md      Cloud Run + Vercel + Neon deployment guide and smoke test
└── web/                    the Next.js PWA
    ├── app/                landing page, (app) group: decide / explore / history / settings, login
    ├── components/dock.tsx      the floating macOS-style navigation dock, used at every screen size
    ├── components/decide/  partner cards, deciding animation, canvas wheel, mediator, reveal
    ├── lib/decide/         reducer state machine, API-mirroring types, shared cuisine list
    ├── lib/location/       persisted location preference + permission handling
    ├── lib/db/             Drizzle schema and user-scoped queries
    ├── lib/sync/           IndexedDB outbox for guest → account history sync
    └── scripts/            service worker build, icon generation from the logo SVG
```

## Getting started

### Prerequisites

- Python 3.12 (torch's CPU wheels aren't guaranteed on newer versions yet)
- Node.js 20+
- A [Neon](https://neon.tech) Postgres project
- A Google OAuth client — optional, email/password sign-in works without it

### Local development

Run both services: the API on port 5000 and the web app on port 3000. `localhost` counts as a
secure context, so geolocation and voice input work there.

**API** (repo root):

```bash
python -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu   # Windows: .venv\Scripts\pip
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

The first time each engine is used, it downloads its checkpoint from the Hugging Face Hub (a few
hundred MB combined). The Docker image bakes these in (`scripts/prefetch_models.py`) and sets
`HF_HUB_OFFLINE=1`, so a deployed instance never calls the Hub.

**Web app** (`web/`):

```bash
cd web
npm install
cp .env.example .env.local   # fill in the variables below
npx drizzle-kit push         # creates the tables in your Neon database
npm run dev
```

`drizzle-kit push` diffs `web/lib/db/schema.ts` against the database directly; there's no separate
migration history.

### Environment variables

API (all optional locally):

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated origins allowed to call the API. Set to your Vercel domain in production. |
| `VERCEL_PREVIEW_ORIGIN_REGEX` | `*-pravinraj01.vercel.app` | Regex for Vercel preview-deploy origins. |
| `MEMORY_BUDGET_MB` | `11000` | RAM ceiling for keeping more than one engine loaded. |
| `DEV_MODE_ALLOWED` | `1` | `0` disables the developer-mode engine comparison. |
| `CLM_EMB_URL` | unset | Remote CLM-8B embeddings server; unset keeps CLM-8B off. |

Web app (`web/.env.local`, see `web/.env.example`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The API's origin: `http://localhost:5000` locally, the Cloud Run URL in production. |
| `DATABASE_URL` | Neon **pooled** connection string (runtime). |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection string (`drizzle-kit` only). |
| `AUTH_SECRET` | Signs the session cookie: `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional Google sign-in. |

### Tests

```bash
.venv/bin/python -m pytest tests/        # 170 tests: guards, ranking/mediator, radius & location rules, same-country
                                          # filtering, the Overture bundle, OSRM routing, location-mention
                                          # extraction/geocoding, CORS, rate limit, engine manager
cd web && npm test                       # 73 tests: decide reducer, API client, wheel landing property test, sync
                                          # outbox, distance formatting, navigation-app links
cd web && npm run lint && npm run build
.venv/bin/python scripts/compare_engines.py   # real engines, real latency/confidence on sample couples
```

### Refreshing the Overture bundle

`data/places_my_sg.parquet` is a point-in-time snapshot, not a live feed. Re-run it (with the API's
own virtualenv active, so `duckdb` is already installed) when Overture publishes a new monthly
release:

```bash
.venv/bin/python scripts/build_places.py
```

It queries Overture's public dataset directly from S3 (no AWS credentials needed) and writes the
same file path, so nothing else needs to change.

### Optional: CLM-8B

CLM-8B's reference implementation needs a GPU embeddings server (the 8B model alone needs ~16 GB,
more than the API's whole RAM budget). Run `contrastive-lm`'s embeddings server on a GPU notebook
(e.g. Colab, see [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM)), expose it with a
tunnel, install the `contrastive-lm` package on the API (it isn't in `requirements.txt`), and set
`CLM_EMB_URL`. Until then it shows as unavailable in Settings and is never loaded.

### Deploying

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the Cloud Run (API) + Vercel (web app) + Neon
walkthrough, cost controls, and a production smoke-test checklist.

## Security & privacy notes

- **Location is only sent where it's needed.** Coordinates go to the API with `/api/decide` and
  `/api/places` calls; the OpenStreetMap tile server sees which map area you're viewing, as any map
  does. The last fix is cached in `localStorage` for 15 minutes so reopening the app doesn't
  re-prompt.
- **Your position and the shortlisted places are also sent to a public OSRM routing server**
  (`routing.openstreetmap.de` or `router.project-osrm.org`) to work out real driving distance and
  time — the same egress class as Overpass above, and likewise no API key involved.
- **A place you mention by name** ("near Mid Valley") is sent, along with your approximate area, to
  OpenStreetMap's Nominatim geocoder to resolve it — again no key, no account, cached so the same
  phrase isn't looked up twice. Inside Malaysia/Singapore, the restaurant search itself doesn't need
  this at all: it reads the bundled Overture snapshot locally, with no outgoing request.
- **Voice input uses the browser's own Web Speech API.** In Chrome that means audio goes to
  Google's speech service; only the resulting text ever reaches Food Wheeler.
- **Every history query is scoped to the signed-in user**, server-side. Guests' decisions stay in
  their browser's IndexedDB until they sign in.
- **The API is public but bounded.** Browsers can only call it from the web app's own origins
  (CORS allowlist), and `/api/decide` is rate-limited per IP (a burst of 10, then about one request
  every 6 seconds).
- **A Content-Security-Policy** in `web/next.config.ts` limits network calls to the app itself and
  the API, and images to the app, OSM tiles and Google profile pictures.

## Data attribution

Restaurant data comes from [Overture Maps Foundation](https://overturemaps.org) (bundled snapshot,
[CDLA-Permissive-2.0](https://cdla.dev/permissive-2-0/), aggregated from Meta, Microsoft and other
contributors) inside Malaysia/Singapore, and from
[OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors,
[ODbL](https://opendatacommons.org/licenses/odbl/)) everywhere else, for map tiles, driving
directions (OSRM) and place-name geocoding (Nominatim).

## License

No license file yet — all rights reserved by default until one is added.

---
Built by PravinRaj
