---
title: The Food-Wheeler
emoji: 🎡
colorFrom: pink
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# The Food-Wheeler

Two partners, one phone, one decision. Type or dictate what you each
want, and a pluggable AI "System 1" decision engine picks a restaurant —
confidently, or by asking one quick tie-breaker question together.

100% free stack: Flask, [Laya](https://huggingface.co/convaiinnovations/laya)
and [GLiNER2.5-Decide](https://huggingface.co/fastino/GLiNER2.5-Decide) as
decision engines, OpenStreetMap (Overpass + Leaflet) for real nearby
restaurants and the map, and the browser's native Web Speech and
Geolocation APIs for voice and location — no paid API keys anywhere.

> **Hosting note:** Hugging Face now requires a PRO subscription
> ($9/mo) to run a Docker Space on its free CPU hardware — only fully
> static (no-backend) Spaces are free there. Since this app needs a real
> Flask backend, the recommended free host is **Google Cloud Run**
> instead (see below); the same `Dockerfile` works on both.

## How it works

1. **Partner 1** types or taps 🎤 to say what they want, then taps
   **Pass to Partner 2 →**. Partner 1's answer blurs (tap to peek) so
   Partner 2 answers honestly.
2. **Partner 2** does the same, then taps **Wheel the Food!**
3. The backend fetches up to 6 nearby restaurants (real ones via OSM, or
   a demo set if location is unavailable), scores them against both
   answers with the selected AI engine, and:
   - **≥ 70% confidence** → an interactive wheel spins and lands exactly
     on the winner, with confetti.
   - **< 70% confidence** → a **One Joint Tap** mediator question appears
     (e.g. "Fast Food or Sit-down Dining?"). Whichever you both tap gets
     added to the decision and it tries again — for up to 2 rounds, after
     which it does a fair random spin between the finalists so you're
     never stuck.
4. The winner is revealed with a match badge and a live map pin.

## Decision engines

An engine toggle sits at the top of the app:

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
own 8B-parameter model alone needs ~16GB, more than this Space's whole
free RAM budget. To enable it:

1. Start a free GPU notebook (e.g. Google Colab, T4 GPU) running
   `contrastive-lm`'s embeddings server (see
   [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM)).
2. Expose it publicly, e.g. with a Cloudflare/ngrok tunnel.
3. Set the `CLM_EMB_URL` secret on your Space to that tunnel's URL.

Without `CLM_EMB_URL` set, CLM-8B stays greyed out in the toggle
("GPU required") and is never loaded — the app never tries to run an 8B
model on the free CPU tier.

### 🛠️ Dev Mode (hidden)

Triple-click (or triple-tap) the "The Food-Wheeler" title to toggle a
hidden developer mode. While it's on, every request is also scored by
every other available engine purely for comparison — the wheel and the
mediator still follow only the engine you selected, but the reveal card
and the mediator both show a side-by-side score line (e.g. "⚡ Laya: 62%
| 🎯 GLiNER: 81%"). A secondary engine that fails or times out just shows
as unavailable; it never breaks the actual game. Set the `DEV_MODE_ALLOWED=0`
environment variable to disable this feature entirely.

## Local development

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

Then open http://localhost:5000. `localhost` is a secure context, so
voice input and geolocation both work there.

**First run note:** Laya and GLiNER each download their model checkpoint
from the Hugging Face Hub the first time they're used (a few hundred MB
combined). This is baked into the Docker image at build time (see
`scripts/prefetch_models.py`) so it doesn't happen on a live Space.

Run the tests:

```bash
.venv/Scripts/python -m pytest tests/ -v
```

Sanity-check the engines directly and see real latency/confidence
numbers on a few sample couples:

```bash
.venv/Scripts/python scripts/compare_engines.py
```

## Deploying to Google Cloud Run (free)

Cloud Run's free tier (2M requests, 360,000 GiB-seconds, 180,000
vCPU-seconds per month, scale-to-zero when idle) comfortably covers a
personal/demo project. You need a Google account with a Cloud project
and a billing account attached — Google requires a card on file even
for free-tier usage, but you won't be charged unless traffic goes well
beyond hobby-project levels.

The easiest path needs **no local installs**: open
[Cloud Shell](https://shell.cloud.google.com) in your browser (it comes
with `gcloud` pre-installed and pre-authenticated to your account),
upload or `git clone` this repo there, then from the repo's root run:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
gcloud run deploy food-wheeler \
  --source . \
  --region us-central1 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars MEMORY_BUDGET_MB=3200
```

- `--source .` has Cloud Build build the `Dockerfile` for you — no local
  Docker needed.
- `--memory 4Gi` gives enough headroom for Laya (~1.6GB) and GLiNER
  (~1.4GB) to both be loaded at once, with `MEMORY_BUDGET_MB=3200`
  matching that so `EngineManager` evicts before the container itself
  gets OOM-killed.
- `--allow-unauthenticated` makes the URL public (no Google sign-in
  required to open the app).
- `--max-instances 3` caps how far it can scale under load, as a safety
  rail on cost.

The command prints a `*.run.app` URL when it finishes — that's a real
top-level HTTPS origin, so voice input and geolocation both work
directly (no iframe caveat, unlike embedding a Space's gallery page).

To redeploy after a change, run the same `gcloud run deploy` command
again from the updated code — each deploy creates a new revision and
Cloud Run traffic-shifts to it once it's healthy.

If you'd rather use `gcloud` from your own machine instead of Cloud
Shell, install the [Cloud SDK](https://cloud.google.com/sdk/docs/install),
run `gcloud init` to pick your project, then run the same `gcloud run
deploy` command from the repo root.

## Deploying to Hugging Face Spaces (needs HF PRO, $9/mo)

If you'd rather use Hugging Face and don't mind the PRO subscription:

1. Create a new Space, SDK = **Docker**.
2. Push this repo to it (`git remote add space <space-url> && git push space main`).
3. The build prefetches both models' weights, so the Space's first
   request after a cold start is fast.
4. **Open the app at its direct URL**, `https://<user>-<space>.hf.space`,
   not the `huggingface.co/spaces/...` page. The Spaces page embeds the
   app in an iframe, which can block microphone and geolocation
   permissions on some mobile browsers; the direct URL is full HTTPS at
   the top level, so both work. The app shows a banner if it detects
   it's running inside an iframe.
5. (Optional) Set the `CLM_EMB_URL` secret if you want to try CLM-8B —
   see above.

Spaces sleep after ~48 hours of no traffic; the first visit after that
takes 30-60 seconds to wake up, which `/api/health` polling and the
loading state on the page cover.

## Project layout

```
app.py                  Flask routes, ranking/tie/mediator logic (engine-agnostic)
candidates.py           OSM Overpass fetch + mock fallback + restaurant data
engines/
  base.py               DecisionEngine interface every engine implements
  laya_engine.py         ConvAI Laya wrapper
  gliner_engine.py       Fastino GLiNER2.5-Decide wrapper
  clm_engine.py           Stanford/NVIDIA CLM-8B wrapper (remote-only)
  __init__.py             EngineManager: lazy loading, RAM budget, LRU eviction
templates/index.html    Single-page frontend (Tailwind, Web Speech, canvas wheel, Leaflet)
scripts/
  probe_laya.py / probe_gliner.py   confirm each engine's raw output schema
  compare_engines.py                side-by-side sample-case comparison
  prefetch_models.py                used by the Dockerfile build
tests/                  pytest suite (engines are faked — no GPU/network needed)
Dockerfile              Works on Google Cloud Run or a HF Space (Docker SDK)
.gcloudignore           What `gcloud run deploy --source .` uploads to Cloud Build
```
