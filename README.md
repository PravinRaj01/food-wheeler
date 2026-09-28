---
title: Food Wheeler
emoji: 🎡
colorFrom: pink
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Food Wheeler

Your third wheel for food decisions. Two partners, one phone: type or
dictate what you each want, and a pluggable AI "System 1" decision engine
picks a restaurant — confidently, or by stepping in with one quick
tie-breaker question you answer together. It's also a real installable
PWA: an app shell with navigation, offline-first history sync, light/dark
theming, and accounts, matching the feel of a native app on both desktop
and phone.

100% free stack where it matters most: [Laya](https://huggingface.co/convaiinnovations/laya)
and [GLiNER2.5-Decide](https://huggingface.co/fastino/GLiNER2.5-Decide) as
decision engines, OpenStreetMap (Overpass + Leaflet) for real nearby
restaurants and the map, and the browser's native Web Speech and
Geolocation APIs for voice and location — no paid API keys for the core
experience. Accounts and cross-device history sync use Neon's free
Postgres tier.

## Two services

```
food-wheeler/              Flask API — AI ranking, OSM candidates, mediator logic
└─ web/                    Next.js 16 PWA — the actual app people use
```

The Flask API (this repo's root) is a pure JSON backend: given both
partners' text and a location, it returns a winner or a tie-breaker
question. It has no UI of its own anymore — `GET /` just returns a small
JSON banner. **`web/`** is the real frontend: a Next.js App Router PWA
with a landing page, the decide flow, an Explore map, account history,
and settings, deployed separately (Vercel) and talking to the Flask API
over CORS. See [`web/README` conventions below](#frontend-web) for its
own setup — there's no separate README in that folder; this one covers
both services.

> **Hosting note:** Hugging Face now requires a PRO subscription
> ($9/mo) to run a Docker Space on its free CPU hardware — only fully
> static (no-backend) Spaces are free there. Since this API needs a real
> Flask backend, the recommended free host is **Google Cloud Run**
> instead (see below); the same `Dockerfile` works on both. The frontend
> deploys to **Vercel**'s free Hobby tier.

## How it works

0. **Who's eating?** Optionally, each partner's name — asked once per
   browser, skippable, editable later in Settings. Skip it and the app
   just says "Partner One" / "Partner Two".
1. **Partner 1** types or taps 🎤 to say what they want, then taps
   **Pass to Partner Two**.
2. **A real handoff screen** — "Pass it to Partner Two. No peeking." —
   with an explicit "I'm Partner Two — ready" button. Nothing auto-advances.
3. **Partner 2** does the same (Partner 1's answer stays blurred, tap to
   peek), then taps **Find Our Table**. This needs a real location — there
   is no demo/mock fallback; if location is off, a drawer asks you to turn
   it on before anything runs.
4. The backend fetches nearby restaurants for the chosen search radius via
   OpenStreetMap, scores them against both answers with the selected AI
   engine, and:
   - **≥ 70% confidence** → a branch-and-converge "deciding" animation
     narrows to the finalists, then an interactive wheel spins and lands
     exactly on the winner with a gold glow and shimmer.
   - **< 70% confidence** → a mediator question appears (e.g. "Fast Food
     or Sit-down Dining?"). Whichever you both tap gets added to the
     decision and it tries again — for up to 2 rounds, after which it
     does a fair random spin between the finalists so you're never stuck.
5. The winner is revealed with a match badge and a live map pin. Signed
   in, it's saved to History automatically; as a guest, it's queued
   locally and synced the moment you log in.

### Search radius

A radius chip on the Decide screen controls how far candidates are
pulled from: **Local** (1.5 km), **City** (5 km) or **Road Trip**
(15 km, stratified across near/mid/far distance rings so genuinely far
options show up, not just the six closest places). The **Explore** tab
uses the same tiers to browse the full uncurated list on a map and can
seed a specific place straight into tonight's wheel.

## Decision engines

Which engine to use is picked in **Settings**, under "Under the hood"
(it used to sit at the top of the Decide screen; moved so a couple mid-round
isn't confronted with a technical choice they rarely touch):

| Engine | Notes |
|---|---|
| ⚡ **Laya** (default) | ConvAI's fast joint-attention classifier. Runs on CPU. |
| 🎯 **GLiNER2.5-Decide** | Fastino's CPU-first classifier; handles exclusion rules ("no burgers") more reliably. |
| 🧠 **CLM-8B** | Stanford/NVIDIA's dual-encoder model. Needs a GPU, so it's disabled unless you point it at one (below). |

Every engine returns a plain probability per restaurant, so the 70%
rule, ties and the mediator behave identically no matter which one you
pick. The engine locks once you submit, so a tie-breaker round can't mix
two different models' scores.

### Running CLM-8B (optional)

CLM-8B's reference implementation needs a GPU embeddings server — its
own 8B-parameter model alone needs ~16GB, more than this API's whole
free RAM budget. To enable it:

1. Start a free GPU notebook (e.g. Google Colab, T4 GPU) running
   `contrastive-lm`'s embeddings server (see
   [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM)).
2. Expose it publicly, e.g. with a Cloudflare/ngrok tunnel.
3. Set the `CLM_EMB_URL` env var on the API to that tunnel's URL.

Without `CLM_EMB_URL` set, CLM-8B stays greyed out in the toggle
("GPU required") and is never loaded — the app never tries to run an 8B
model on the free CPU tier.

### 🛠️ Developer mode

A plain switch in **Settings**, next to the engine picker (no more
triple-tap easter egg). While it's on, every request is also scored by
every other available engine purely for comparison — the wheel and the
mediator still follow only the engine you selected, but the reveal card
and the mediator both show a side-by-side score line. A secondary engine
that fails or times out just shows as unavailable; it never breaks the
actual game. Set the `DEV_MODE_ALLOWED=0` environment variable on the API
to disable this feature entirely (the Settings switch then has no effect).

## Local development

You need both services running: the Flask API on port 5000, the Next.js
app on port 3000. `localhost` is a secure context, so voice input and
geolocation both work there.

### Backend (repo root)

Requires Python 3.12 (torch's wheels aren't guaranteed on newer
versions yet).

```bash
python -m venv .venv
# Windows:
.venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app.py
# macOS/Linux:
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

**First run note:** Laya and GLiNER each download their model checkpoint
from the Hugging Face Hub the first time they're used (a few hundred MB
combined). This is baked into the Docker image at build time (see
`scripts/prefetch_models.py`), and `HF_HUB_OFFLINE=1` is set in
production so a deployed instance never calls the Hub again.

Backend environment variables (all optional — sane defaults for local dev):

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated list of exact origins allowed to call the API (CORS). Set to your Vercel production domain in production. |
| `VERCEL_PREVIEW_ORIGIN_REGEX` | matches `*-pravinraj01.vercel.app` | Regex for Vercel preview-deploy origins, which get a unique subdomain per branch/commit. |
| `MEMORY_BUDGET_MB` | `11000` | RAM ceiling `EngineManager` won't exceed when deciding whether to keep a second engine loaded. |
| `DEV_MODE_ALLOWED` | `1` | Set to `0` to disable the Dev Mode comparison feature entirely (its Settings switch then has no effect). |
| `CLM_EMB_URL` | unset | URL of a remote CLM-8B embeddings server (see above). Leaving it unset keeps CLM-8B greyed out. |

Run the backend tests:

```bash
.venv/Scripts/python -m pytest tests/ -v
```

Sanity-check the engines directly and see real latency/confidence
numbers on a few sample couples:

```bash
.venv/Scripts/python scripts/compare_engines.py
```

### Frontend (`web/`)

Requires Node 20+.

```bash
cd web
npm install
cp .env.example .env.local   # fill in DATABASE_URL, AUTH_SECRET, etc. - see below
npm run dev
```

Then open http://localhost:3000.

Frontend environment variables (`web/.env.local`, see `web/.env.example`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Flask API's origin — `http://localhost:5000` locally, the Cloud Run URL in production. |
| `DATABASE_URL` | Neon's **pooled** Postgres connection string (runtime queries). |
| `DATABASE_URL_UNPOOLED` | Neon's **direct** connection string (migrations only, via `drizzle-kit`). |
| `AUTH_SECRET` | Signs the session cookie. Generate one per environment: `openssl rand -base64 32`. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Optional Google OAuth credentials (Google Cloud Console → APIs & Services → Credentials). Email/password auth works without these. |

**Database setup:** create a free [Neon](https://neon.tech) Postgres
project, copy both connection strings into `.env.local`, then push the
schema (`web/lib/db/schema.ts`) to it:

```bash
cd web
npx drizzle-kit push
```

This creates the `users`, `accounts`, `decisions` and `preferences`
tables. There's no separate migration history — `push` diffs the schema
file against the live database directly, which is the right workflow for
a small solo project.

Run the frontend's unit tests (reducer, API client, the wheel's landing
math as a 1,000-trial property test, and the IndexedDB sync outbox):

```bash
cd web
npm test
```

Lint and a production build:

```bash
cd web
npm run lint
npm run build
```

## Deploying the backend to Google Cloud Run (free)

Cloud Run's free tier (2M requests, 360,000 GiB-seconds, 180,000
vCPU-seconds per month, scale-to-zero when idle) comfortably covers a
personal/demo project. You need a Google account with a Cloud project
and a billing account attached — Google requires a card on file even
for free-tier usage, but you won't be charged unless traffic goes well
beyond hobby-project levels. **Pick the Cloud Run region closest to
you** (e.g. `asia-southeast1` for Southeast Asia, `us-central1` for
central US, `europe-west1` for Europe) — it directly affects latency.

**Sizing:** use **8 GiB memory / 2 vCPU**. 4 GiB is *not* enough —
Laya plus GLiNER plus the Python/Flask/torch baseline needs more
headroom than that, and `EngineManager`'s memory guard will correctly
refuse to load the second engine rather than crash, but then only one
engine ever works. Set `MEMORY_BUDGET_MB=6500` (roughly 80% of 8 GiB) to
match, and set `ALLOWED_ORIGINS` to your Vercel production domain once
the frontend is deployed (see below) — without it, the browser blocks
every request with a CORS error even though the API itself is healthy.

### Option A: continuous deployment from GitHub (recommended)

This is what's actually running the live deployment: push to GitHub →
Cloud Build automatically rebuilds and redeploys. One-time setup, from
the [Cloud Run console](https://console.cloud.google.com/run):

1. **Create service** → **Continuously deploy from a repository** →
   **Set up with Developer Connect** → authorize GitHub → pick this repo.
2. Region: your closest one. Authentication: **Allow public access**.
   Scaling: min instances **0**, max instances **1–3**.
3. Under **Container, Networking, Security → Containers**: set
   **Memory: 8 GiB**, **CPU: 2**, leave **Container port** at its
   default (the app listens on whatever `$PORT` Cloud Run sets). Add
   the environment variables from the table above under **Variables &
   Secrets**. Under **Requests**: **Request timeout: 300s** (cold starts
   loading two models take longer than the 60s default). Leave
   **Startup CPU boost** checked — it measurably helps cold-start time.
4. Click **Create**. Every push to `main` rebuilds and redeploys
   automatically from then on.

**Two IAM permission errors are common on a brand-new project** the
first time you set this up, both are one-time and safe to fix yourself:
- *"Unable to create the connection... Secret Manager"* — enable the
  Secret Manager API (`secretmanager.googleapis.com`) if it isn't
  already, wait a minute for IAM propagation, and retry.
- *"error fetching DeveloperConnect credentials... fetchReadToken"*
  during the first build — the Cloud Build service account
  (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`) needs the
  `roles/developerconnect.readTokenAccessor` role too (a different
  default service account gets it automatically, but not this one):
  ```bash
  gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
    --role="roles/developerconnect.readTokenAccessor"
  ```
  Then retry the build from **Cloud Build → Triggers → Run**.

### Option B: deploy directly from your machine or Cloud Shell

No GitHub connection needed - good for a one-off deploy or quick
iteration. Either open [Cloud Shell](https://shell.cloud.google.com)
(comes with `gcloud` pre-installed and pre-authenticated) or install the
[Cloud SDK](https://cloud.google.com/sdk/docs/install) locally and run
`gcloud init` once to pick your project. Then, from the repo root:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
gcloud run deploy food-wheeler \
  --source . \
  --region asia-southeast1 \
  --memory 8Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars MEMORY_BUDGET_MB=6500,ALLOWED_ORIGINS=https://your-app.vercel.app
```

`--source .` has Cloud Build build the `Dockerfile` for you (no local
Docker needed; it also respects `.gcloudignore`, which excludes `web/`
so the frontend's `node_modules` never gets uploaded). The command
prints a `*.run.app` URL when it finishes — put that in the frontend's
`NEXT_PUBLIC_API_URL`. To redeploy after a change, just run the same
command again; each deploy creates a new revision and Cloud Run
traffic-shifts to it once it's healthy.

### Setting a spending limit

Cloud Run has no built-in hard spending cap, but a **budget alert**
(email notification, doesn't restrict anything) is easy to scope to
just this project without touching any other projects on the same
billing account:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="food-wheeler spend alert" \
  --budget-amount=5USD \
  --filter-projects="projects/YOUR_PROJECT_ID" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0
```
Use your billing account's actual currency (check with `gcloud billing
accounts describe YOUR_BILLING_ACCOUNT_ID`) — the amount must match it
or the API rejects the request. `--max-instances` above is the other
half of cost control: it caps how many container instances can ever run
concurrently, bounding your worst-case cost regardless of traffic.

The API also rate-limits itself: `/api/decide` allows a burst of 10
requests per IP before returning `429 RATE_LIMITED`, refilling at
roughly one request per 6 seconds sustained. It's a plain in-memory
token bucket (the Dockerfile runs a single gunicorn worker, so there's
exactly one process holding it — no Redis needed at this scale).

## Deploying the frontend to Vercel (free)

From the [Vercel dashboard](https://vercel.com/new), import this GitHub
repo and set:

- **Root Directory**: `web`
- **Environment Variables**: everything from the frontend table above
  (`NEXT_PUBLIC_API_URL` pointing at your Cloud Run URL, the Neon
  connection strings, `AUTH_SECRET`, and the Google OAuth pair if you
  set that up).

Vercel auto-detects Next.js and handles the build. Every push to `main`
deploys to production; every other branch/PR gets its own preview URL —
which is exactly what `VERCEL_PREVIEW_ORIGIN_REGEX` on the backend is
for, so preview deploys can call the API too without editing
`ALLOWED_ORIGINS` for every branch.

**Google OAuth setup is manual** (Google Cloud Console → APIs & Services
→ Credentials → **Create OAuth client ID**, type **Web application**,
with an authorized redirect URI of
`https://your-app.vercel.app/api/auth/callback/google`) — there's no
CLI/API path for a consumer "Sign in with Google" client, only for
enterprise Workforce Identity Federation, which is a different feature
entirely. Email/password login works without any of this and is the
default.

## Deploying the backend to Hugging Face Spaces (needs HF PRO, $9/mo)

If you'd rather use Hugging Face for the API and don't mind the PRO
subscription:

1. Create a new Space, SDK = **Docker**.
2. Push this repo to it (`git remote add space <space-url> && git push space main`).
3. The build prefetches both models' weights, so the Space's first
   request after a cold start is fast.
4. Set `ALLOWED_ORIGINS` to your Vercel domain in the Space's secrets,
   same as the Cloud Run setup above.
5. (Optional) Set the `CLM_EMB_URL` secret if you want to try CLM-8B —
   see above.

Spaces sleep after ~48 hours of no traffic; the first visit after that
takes 30-60 seconds to wake up, which the frontend's `/api/health`
polling and splash screen cover.

## Project layout

```
app.py                  Flask routes, ranking/tie/mediator logic, CORS, rate limiting (engine-agnostic)
candidates.py           OSM Overpass fetch (parallel mirrors) + radius control + Explore listing; requires a real location
engines/
  base.py               DecisionEngine interface every engine implements
  laya_engine.py         ConvAI Laya wrapper
  gliner_engine.py       Fastino GLiNER2.5-Decide wrapper
  clm_engine.py           Stanford/NVIDIA CLM-8B wrapper (remote-only)
  __init__.py             EngineManager: lazy loading, RAM budget, LRU eviction
scripts/
  probe_laya.py / probe_gliner.py   confirm each engine's raw output schema
  compare_engines.py                side-by-side sample-case comparison
  prefetch_models.py                used by the Dockerfile build
tests/                  pytest suite (engines are faked - no GPU/network needed)
Dockerfile              Works on Google Cloud Run or a HF Space (Docker SDK)
.gcloudignore           What `gcloud run deploy --source .` uploads to Cloud Build (excludes web/)

web/                    Next.js 16 PWA - the actual frontend (see setup above)
  app/                  Landing page, (app) route group (decide/explore/history/settings), login
  components/           App shell, decide-flow UI, the kinetic canvas wheel, Explore map
  lib/
    decide/             Reducer state machine + the API-mirroring TypeScript types
    db/                 Drizzle schema + queries (Neon Postgres)
    auth*.ts            Auth.js v5 config (email/password + Google)
    sync/outbox.ts       IndexedDB offline-first outbox for guest → account decision sync
  scripts/              PWA service worker build, icon generation from the logo SVG
```
