# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY app/package.json app/package-lock.json ./
RUN npm ci

COPY app/ ./
RUN npm run build

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TEAMBEACON_DB_PATH=/data/teambeacon.db \
    TEAMBEACON_LOG_DIR=/logs \
    TEAMBEACON_HOST=0.0.0.0 \
    TEAMBEACON_PORT=8000 \
    TEAMBEACON_WEB_DIR=/app/app/web \
    OLLAMA_BASE_URL=http://host.docker.internal:11434

WORKDIR /app

RUN adduser --disabled-password --gecos "" --uid 10001 teambeacon

COPY services/api/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/requirements-runtime.txt \
    && rm -f /tmp/requirements-runtime.txt

COPY packages /app/packages
COPY services /app/services
COPY config /app/config
COPY --from=frontend-builder /build/app/web /app/app/web
COPY docker/entrypoint.sh /usr/local/bin/teambeacon-entrypoint.sh

RUN chmod +x /usr/local/bin/teambeacon-entrypoint.sh \
    && mkdir -p /data /logs /home/teambeacon/.oci \
    && chown -R teambeacon:teambeacon /app /data /logs /home/teambeacon

USER teambeacon

EXPOSE 8000
VOLUME ["/data", "/logs"]

ENTRYPOINT ["/usr/local/bin/teambeacon-entrypoint.sh"]
