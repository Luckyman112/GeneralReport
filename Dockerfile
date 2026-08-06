# ---- фронтенд: сборка статики ----
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Vite инлайнит import.meta.env.VITE_* в бандл на этапе сборки (не рантайма!) —
# без этого ARG/ENV фронтенд в проде получает client_id=undefined в OAuth-ссылке,
# т.к. frontend/.env локальный и в образ не копируется (.dockerignore/.gitignore)
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
RUN npm run build

# ---- backend: рантайм ----
FROM python:3.11-slim
WORKDIR /app

# postgresql-client — только ради pg_dump для резервных копий (app/api/backups.py):
# без Docker CLI внутри контейнера код сам откатывается на прямой pg_dump по TCP
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY scripts/ ./scripts/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
