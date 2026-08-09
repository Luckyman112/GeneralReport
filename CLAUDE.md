# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

COLLAPSAR Report System — backend + frontend for a Star Wars Garry's Mod community's
Discord-based command structure. Bot lives on **one** Discord guild; formations
("регименты/формирования" — 501st, Guard, etc.) are distinguished by Discord roles
within that single guild, not by separate servers. Auth is Discord OAuth2 + guild role
membership; sessions are JWT (no cookies).

Deployed self-hosted (Debian/Proxmox VPS) via `docker-compose.yml` + Cloudflare Tunnel,
same-origin (FastAPI serves the built frontend from `frontend/dist`, mounted last so it
doesn't shadow `/api`, `/auth`, `/health`, `/uploads`). A self-hosted GitHub Actions
runner on the VPS auto-deploys on every push to `master` — pushing to master ships to
production immediately, there is no staging environment. The container runs
`alembic upgrade head` on every start, so schema migrations apply automatically on
deploy; **data backfills for new features do not** (see below).

## Commands

Backend (run from repo root):
```
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```
Swagger UI at `/docs`. Sanity-check backend changes with `python -c "import app.main"`
(catches import/wiring errors fast) — there is no automated test suite in this repo.

New migration: create `alembic/versions/NNNN_description.py` by hand following the
existing numbering (check `ls alembic/versions | sort | tail`), don't use
`alembic revision --autogenerate`. Migrations should be schema-only; if a new feature
needs to backfill data into rows that already exist in production, write that as a
separate one-off script run manually after deploy (e.g. via
`docker exec -i collapsar-backend python -c "..."`), not baked into the migration.

Frontend (run from `frontend/`):
```
npm install
npm run dev      # Vite dev server
npm run build    # -> frontend/dist, served by the backend in prod
```
No lint script, no test suite on the frontend either. Verify UI changes by building and,
where feasible, exercising the flow against a running backend.

Local Postgres for dev is a plain `docker run` container (not part of the prod
docker-compose file, which doesn't expose a host port for it) — matches `DATABASE_URL`
in `.env` (default `localhost:5433`). If it doesn't exist yet, create it and restore
from `backups/*.sql` if you need realistic data, then `alembic upgrade head`.

## Architecture

### Layering
Each backend feature is four files following the same name: `app/models/x.py`
(SQLAlchemy), `app/crud/x.py` (async DB functions, no HTTP concerns), `app/schemas/x.py`
(Pydantic read/create/update), `app/api/x.py` (FastAPI router, permission checks, wires
crud+schemas). `app/main.py` registers every router under `/api` except `auth`. New
models must be imported in `app/models/__init__.py` — SQLAlchemy resolves relationship
string references via that shared registry at mapper-configuration time, so a model
left out of `__init__.py` breaks other models' relationships in confusing ways.

`app/api/events.py` (SSE live-update channel, `/api/events`) and `app/api/event_room.py`
("Ивентрум" event-request feature, `/api/event-room/*`) are unrelated despite the
similar name — don't confuse them.

### Permission model — `AccessContext` (`app/api/deps.py`)
Every endpoint depends on `get_access_context`, which computes one `AccessContext`
dataclass per request in `_compute_permission_fields()` from the user's live Discord
roles + DB state (`RegimentCommander` rows, `AppSettings` role-id config, etc.). This is
the single source of truth for "can this user do X" — check here before adding ad-hoc
permission logic in an endpoint. Key fields: `is_admin`/`is_high_command` (global),
`commander_regiment_ids` (explicit `RegimentCommander` assignment — commander/deputy/
mentor role_type, **not** just having the formation's Discord role),
`category_manager_regiment_ids` (subset where role_type is specifically `commander`,
gates things like setting report points), `soldier_regiment_ids`, helper methods like
`is_commander_of(regiment_id)` / `can_appeal_report(regiment_id)`.

`GET /api/me` serializes `AccessContext` into a plain JSON object (`app/schemas/me.py`)
consumed by the frontend `AuthContext`. Only fields explicitly listed in that schema
reach the frontend — `AccessContext` methods (`is_commander_of`, etc.) do not, so
frontend code re-derives equivalent boolean logic from the raw id sets/flags instead of
calling a method.

"View as" (`X-View-As-Role`/`X-View-As-Discord-Id` headers, admin/high-command only) lets
staff preview the app as another role or person — `build_view_as_context` builds a
stripped-down `AccessContext` for this path; when adding a new permission field, check
whether it needs handling there too.

### Report system (the largest subsystem — `app/{models,crud,schemas,api}/report*.py`)
- `ReportCategory` — per-regiment category (Пост/Патруль/Боевой вылет/etc.), holds a
  JSON `fields` list (`{name, type: "text"|"roster", allowed_regiment_ids,
  default_self, allow_manual}` — roster fields are multi-select pickers over a
  regiment's live Discord roster, optionally spanning other regiments too).
  `points`/`participant_points` auto-award on approval. Several boolean flags make a
  category "system" (`is_detention`/`is_promotion`/`is_demotion`/`is_training`) with
  bespoke, non-editable behavior — these are mutually exclusive with each other and
  with `is_joint` (see below); `open_to_regiment_leadership` lets commanders/deputies of
  *other* regiments file into a category that isn't theirs (e.g. Штаб-only categories).
- Two independent cross-regiment linking mechanisms on `ReportCategory`, easy to
  confuse:
  - `mirrors_to_category_id` (1:1, static) — every report filed in this category
    auto-creates a read-only copy in the linked category (used for "Обучение рекрута":
    each regiment's own category mirrors into Штаб's, for central oversight).
  - `is_joint` (1:many, dynamic) — participants in the roster field can span several
    regiments; each participating regiment's commander approves/rejects independently
    via `PATCH /reports/{id}/regiments/{regiment_id}` (not the normal
    `PATCH /reports/{id}`, which is blocked for joint categories). Approval lazily
    clones the category into that regiment and creates a reusable mirror `Report`
    there — reject-then-reapprove reuses the same mirror row, doesn't duplicate it.
    Backing table: `ReportRegimentDecision`.
  Both use `Report.mirror_of_report_id` (self-FK) to mark a row as a mirror;
  `report_crud.get_mirror_of` assumes exactly one mirror (the 1:1 case),
  `list_mirrors_of` handles the 1:many case.
- Regiment membership for a Discord id is **not** stored — it's resolved live via
  `discord_client.fetch_guild_members()` + matching `regiment.discord_role_id` against
  the member's role list (see `regiment_crud.resolve_regiments_for_discord_ids`,
  `app/api/regiments.py::get_members`). Local dev DB restores won't have this data;
  results depend on whoever is actually in the real Discord guild at query time.
- `GET /reports` visibility for non-admins is `commander_regiment_ids | soldier_regiment_ids`,
  OR'd with `visible_target_regiment_ids` (detention reports about your own regiment's
  member, filed by someone else) and `joint_decision_regiment_ids` (joint reports where
  your regiment has a decision row, even though the report itself belongs to another
  regiment, usually Штаб) — see `report_crud.list_reports`.

### SQLAlchemy async gotcha (recurring bug source)
`db.get(Model, id)` returns the object from the session's identity map if it's already
loaded there, **silently ignoring any `options=[selectinload(...)]`** you pass —
relationships that were empty/None on first load stay stale even after a later commit
changes them. Every `get_by_id`-style crud function in this codebase passes
`populate_existing=True` to force a real reload; do the same for any new one (comments
at each existing call site explain why).

### Discord integration (`app/core/discord_client.py`)
REST API only via `httpx` — no `discord.py`, no gateway connection, no persistent bot
process. Guild member/role lookups are live HTTP calls, not cached locally (see above).

### Frontend
React + Vite, `HashRouter` (routes are `#/...`; `?code=` from Discord OAuth is parsed at
the top of `AuthContext` before the router touches it — redirect URIs registered in
Discord's dev portal must not include a `#`). Built to `frontend/dist` and served
same-origin by the backend in prod, so `frontend/src/api/client.js` uses relative URLs
with no base path.

### Windows dev environment (this repo is developed on Windows/PowerShell)
`curl` with a Cyrillic JSON body inline (`-d '{"name":"Пост"}'`) mangles the encoding in
Git Bash — write the body to a file and use `--data-binary "@file"` instead. Background
`uvicorn`/`vite` dev processes started earlier in a session don't auto-restart on file
changes if launched without `--reload`/outside Vite's watcher — check
`Get-CimInstance Win32_Process` for stale processes before assuming a code change is
live.
