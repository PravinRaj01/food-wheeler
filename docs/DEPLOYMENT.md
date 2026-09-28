# Deploying Food Wheeler

Two services, deployed separately:

- **API** (repo root, Flask + the AI engines) → **Google Cloud Run**, via the root `Dockerfile`.
- **Web app** (`web/`, Next.js PWA) → **Vercel**.

Deploy the API first: the web app needs its URL (`NEXT_PUBLIC_API_URL`), and the API needs the web
app's domain (`ALLOWED_ORIGINS`), so expect one round of back-and-forth on the first setup.

## 1. API on Google Cloud Run

Cloud Run's free tier (2M requests, 360,000 GiB-seconds, 180,000 vCPU-seconds per month,
scale-to-zero when idle) comfortably covers a personal project. You need a Google Cloud project
with a billing account attached — Google requires a card on file even for free-tier usage.

**Pick the region closest to your users** (e.g. `asia-southeast1` for Southeast Asia,
`us-central1`, `europe-west1`) — it directly affects latency.

**Sizing: 8 GiB memory / 2 vCPU.** 4 GiB is not enough: Laya plus GLiNER plus the
Python/torch baseline needs more headroom, and `EngineManager`'s memory guard will refuse to load
the second engine rather than crash, so only one engine would ever work. The Dockerfile already
pins torch to 2 threads (`OMP_NUM_THREADS` / `TORCH_NUM_THREADS`) to match the 2 vCPUs.

Environment variables for the API (see the table in the [README](../README.md#environment-variables)):
set `MEMORY_BUDGET_MB=6500` (about 80% of 8 GiB) and, once the web app is deployed,
`ALLOWED_ORIGINS=https://your-app.vercel.app`. Without the latter, the browser blocks every request
with a CORS error even though the API itself is healthy.

### Option A: continuous deployment from GitHub (what the live app uses)

Push to `main` → Cloud Build rebuilds and redeploys. One-time setup from the
[Cloud Run console](https://console.cloud.google.com/run):

1. **Create service** → **Continuously deploy from a repository** → **Set up with Developer
   Connect** → authorize GitHub → pick this repo.
2. Region: your closest one. Authentication: **Allow public access**. Scaling: min instances
   **0**, max instances **1–3**.
3. Under **Container, Networking, Security → Containers**: **Memory 8 GiB**, **CPU 2**, leave
   **Container port** at its default (the app listens on `$PORT`). Add the environment variables
   under **Variables & Secrets**. Under **Requests**: **Request timeout 300s** (a cold start that
   loads two models takes longer than the 60s default). Leave **Startup CPU boost** on.
4. **Create**. Every push to `main` redeploys from then on.

Two IAM errors are common on a brand-new project; both are one-time fixes:

- *"Unable to create the connection... Secret Manager"* — enable the Secret Manager API
  (`secretmanager.googleapis.com`), wait a minute for IAM propagation, and retry.
- *"error fetching DeveloperConnect credentials... fetchReadToken"* on the first build — the Cloud
  Build service account needs one more role:
  ```bash
  gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
    --role="roles/developerconnect.readTokenAccessor"
  ```
  Then retry from **Cloud Build → Triggers → Run**.

### Option B: one-off deploy from your machine or Cloud Shell

Open [Cloud Shell](https://shell.cloud.google.com) (or install the
[Cloud SDK](https://cloud.google.com/sdk/docs/install) and run `gcloud init`), then from the repo
root:

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

`--source .` has Cloud Build build the `Dockerfile` (no local Docker needed) and respects
`.gcloudignore`, which excludes `web/`. It prints a `*.run.app` URL when done — that's the web
app's `NEXT_PUBLIC_API_URL`. Re-run the same command to redeploy; Cloud Run shifts traffic to the
new revision once it's healthy.

### Keeping cost bounded

Cloud Run has no hard spending cap, but a budget alert (email only, restricts nothing) can be
scoped to just this project:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="food-wheeler spend alert" \
  --budget-amount=5USD \
  --filter-projects="projects/YOUR_PROJECT_ID" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=1.0
```

The amount must be in your billing account's currency (check with
`gcloud billing accounts describe YOUR_BILLING_ACCOUNT_ID`). `--max-instances` is the other half of
cost control: it caps concurrent containers regardless of traffic.

## 2. Web app on Vercel

From the [Vercel dashboard](https://vercel.com/new), import this GitHub repo and set:

- **Root Directory**: `web`
- **Environment Variables**: everything in the web app table in the
  [README](../README.md#environment-variables) — `NEXT_PUBLIC_API_URL` pointing at the Cloud Run
  URL, both Neon connection strings, `AUTH_SECRET`, and the Google OAuth pair if you use it.

Vercel detects Next.js and handles the build. Pushes to `main` deploy to production; other
branches get preview URLs, which the API already accepts via `VERCEL_PREVIEW_ORIGIN_REGEX`
(no need to edit `ALLOWED_ORIGINS` per branch).

**Google sign-in (optional).** Google Cloud Console → APIs & Services → Credentials → **Create
OAuth client ID**, type **Web application**, authorized redirect URI
`https://your-app.vercel.app/api/auth/callback/google`. This step is manual — there's no CLI path
for a consumer "Sign in with Google" client. Email/password sign-in works without it.

**Database.** Create the schema once against your Neon project (see
[README → Local development](../README.md#local-development)): `cd web && npx drizzle-kit push`.

## 3. Production smoke test

After both are deployed, on a phone:

1. `GET https://<your-api>.run.app/api/health` returns `model_ready: true` (the first request after
   idle may take ~30–60s while the container starts and loads Laya).
2. Open the web app, turn on location when asked, answer both cards, **Find Our Table** — a
   deciding animation, then a wheel or a mediator question. No CORS errors in the console.
3. Explore shows real nearby places on the map, and the cuisine filters narrow the list.
4. Sign in, complete a round, and the decision appears in **History**.
5. Toggle Settings → Appearance between Light and Dark; reload — no flash of the wrong theme.
6. Install to the home screen; with the network off, the app shell and `/offline` page still load.

## Alternative: API on Hugging Face Spaces (needs HF PRO)

Hugging Face now requires a PRO subscription to run a Docker Space; the same `Dockerfile` works
there. Create a Space with SDK **Docker**, then add this front matter to the **top of the README in
the Space's copy of the repo** (Spaces read their config from it):

```yaml
---
title: Food Wheeler
sdk: docker
app_port: 7860
pinned: false
---
```

Push the repo to the Space (`git remote add space <space-url> && git push space main`) and set
`ALLOWED_ORIGINS` (and optionally `CLM_EMB_URL`) as Space secrets. The build prefetches both models'
weights. Spaces sleep after ~48 hours idle; the first request after that can take 30–60 seconds, and
if it runs past the web app's 45-second timeout the app says the third wheel is waking up and asks
you to try again.
