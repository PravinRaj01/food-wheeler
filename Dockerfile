# The Food-Wheeler — works on either Google Cloud Run or a Hugging Face
# Space (Docker SDK, needs HF PRO). Listens on $PORT so both platforms'
# injected port works; falls back to 7860 (HF's expected app_port) if
# $PORT isn't set, e.g. a plain `docker run` with no -e PORT=....
#
# CPU-only torch keeps the image around ~1-1.5GB instead of several GB.
# Laya and GLiNER's weights are pre-fetched at build time so the first
# real request isn't slowed by a Hugging Face Hub download.
FROM python:3.12-slim

# Spaces run containers as uid 1000; create that user up front.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1

WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user . .

# Bake the Laya and GLiNER checkpoints into the image.
RUN python scripts/prefetch_models.py

# Force every subsequent huggingface_hub call to use only the local cache
# populated above. This is what actually prevents the failure we hit once
# in production: prefetch_models.py originally didn't force a real download
# (Router() alone is lazy), so every cold start silently re-downloaded from
# HF Hub and eventually got rate-limited on Cloud Run's shared egress IP,
# crashing the container. With the cache correctly populated AND network
# access to HF cut off entirely at runtime, that failure mode is closed on
# both ends, not just the one that caused it.
ENV HF_HUB_OFFLINE=1

ENV PORT=7860
EXPOSE 7860

# One worker keeps exactly one copy of each loaded model in memory, which
# matters on a memory-constrained free tier. --threads only takes effect
# with --worker-class gthread (the default "sync" class ignores it and
# serializes every request behind the one worker) - gthread is what lets
# 4 requests share that one process concurrently.
# Shell form (via sh -c) so ${PORT} expands at container start, not build time.
CMD ["sh", "-c", "gunicorn -w 1 --worker-class gthread --threads 4 -t 300 -b 0.0.0.0:${PORT} app:app"]
