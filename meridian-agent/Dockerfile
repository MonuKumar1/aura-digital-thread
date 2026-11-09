# Build context is the repo root so the shared ./data directory can be copied in.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MERIDIAN_DATA_DIR=/app/data \
    MERIDIAN_DATABASE_URL=sqlite:////app/state/meridian.db

WORKDIR /app
COPY meridian-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY meridian-agent/app ./app
COPY data ./data

RUN useradd --system --uid 10001 meridian && mkdir -p /app/state && chown meridian /app/state
USER meridian

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
