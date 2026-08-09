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

### Reusable helpers worth knowing about before reinventing
- `app/core/uploads.py::read_image_upload(file, allowed_types, max_size)` — the only
  correct way to accept an uploaded image in this codebase: reads in capped chunks
  (never buffers past `max_size` before rejecting) and verifies the bytes actually
  decode as an image (Pillow), not just trusting the client's `Content-Type` header.
  Used by report images, member photos, event-room map images — use it for any new
  image upload endpoint instead of `await file.read()` + a manual length check.
- A `PATCH`/`DELETE` crud function whose row can legitimately be referenced by other
  rows (FK with no `ondelete`) should catch `IntegrityError`, `rollback()`, and raise a
  friendly `AppError` — see `report_category_crud.delete`, `squad_crud.delete`,
  `report_category_crud.get_or_create_regiment_clone`. **Snapshot any field you want to
  put in the error message into a local variable before the commit that might fail** —
  after `rollback()` the ORM object's attributes are expired, and touching one inside an
  `except` block raises `MissingGreenlet` (attribute access can't lazily await there).
- A "no two pending X for the same Y" invariant should be a partial unique index
  (Postgres `CREATE UNIQUE INDEX ... WHERE status = 'pending'`), not just an
  application-level check-then-insert — see `PromotionRequest.__table_args__` /
  migration `0075`. Pair it with an `IntegrityError` catch at the insert site so the
  loser of the race gets a clean no-op instead of a 500.

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
  category "system" (`is_detention`/`is_promotion`/`is_demotion`/`is_training`/
  `is_recruit_promotion`) with bespoke, non-editable behavior — these are mutually
  exclusive with each other and with `is_joint` (see below); `open_to_regiment_leadership`
  lets commanders/deputies of *other* regiments file into a category that isn't theirs
  (e.g. Штаб-only categories) — `is_recruit_promotion` goes further still, bypassing
  regiment membership entirely (see "Recruit pipeline" below).
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

### Recruit pipeline ("17-ый Передовой Полк", `Regiment` id=2)
Every new registrant lands in one holding regiment rather than picking their real
formation up front — `RECRUIT_REGIMENT_NAME` constant (`app/crud/regiment.py`,
resolved to an id and cached per-request as `AccessContext.recruit_regiment_id`,
computed in `_compute_permission_fields`/`app/api/deps.py`). Three places key off it,
each a narrow carve-out rather than a broad permission change:
- `POST /me/registration` (`app/api/registration.py`) best-effort assigns the regiment's
  Discord role via `discord_client.add_member_role` — the only *write* call in
  `discord_client.py` (everything else there is GET); never blocks registration if it
  fails (missing bot permission/role hierarchy is a Discord-server config issue, not
  something to surface as a 500).
- `ReportCategory.is_recruit_promotion` ("Курс молодого бойца") — any CPL+ (via
  `min_rank_id`), regardless of their own regiment, can file it against a recruit;
  auto-approves on submit like `is_training`, but instead of granting a specialization
  it directly sets the target's `rank_id` to PVT in `_apply_approval_side_effects`
  (`app/api/reports.py`) — same field-write pattern as `promotion_crud.decide`.
- `AccessContext.can_decide_promotion`/`app/api/promotions.py::list_promotion_requests`
  — while a `PromotionRequest.regiment_id` equals `recruit_regiment_id`, any
  commander/deputy of *any* regiment can decide it (not just 17th's own), so the recruit
  curator pool isn't limited to whoever happens to command that one regiment. Same
  exception is applied to `get_members` for that one regiment id (`app/api/regiments.py`)
  so a non-member commander can actually find the recruit — see `RecruitsPage.jsx`
  ("Рекрутская"), a read-only search, not a general roster browser.

### Specialization prerequisites ("нужны ВСЕ из")
`Specialization.parent_id` only expresses "needs exactly one specific specialization
first". A tier that needs *every* sibling branch at once (e.g. "Старший медик" =
Вирусология + Дефектология + Хирургия all held together) needed a real many-to-many:
`SpecializationPrerequisite` (`specialization_id`, `required_specialization_id`) is a
separate table, checked in `_check_can_grant` (`app/api/specializations.py`) right after
the `parent_id` check. Deliberately not folded into `parent_id`'s "same-parent siblings"
— that would silently change an existing tier's requirements if someone later adds a 4th
sibling under the same parent. Catalog UI: `AdminPanelPage.jsx`'s specialization
add/edit rows get one more `MultiSelectDropdown` alongside the existing single `parentId`
`<select>`. Works identically for medic/pilot/engineer — just catalog data, no
per-discipline code.

### Known incomplete feature
`POST /api/violations` (`create_violation` in `app/api/violations.py`) has full
backend support but no frontend form anywhere — violations currently only get
created as a side effect of approving a detention report. Flagged during the 2026-08
audit, not removed and not built out; if you land here needing to add a manual
"create violation" UI, that's expected new work, not a bug to fix.

### Discord integration (`app/core/discord_client.py`)
REST API only via `httpx` — no `discord.py`, no gateway connection, no persistent bot
process. Guild member/role lookups are live HTTP calls, not cached locally (see above).
Almost everything here is read-only (GET); `add_member_role` (recruit pipeline, see
above) is the one exception — a bot-token `PUT` that can 403 if the bot lacks
`MANAGE_ROLES` or sits below the target role in the server's hierarchy, so callers must
treat it as best-effort (log + continue), never as something that can fail the request.

### Frontend conventions
- Every async button/form handler must wrap its `api.*` call in try/catch and surface
  the failure — `showToast(e.message, "error")` (`ToastContext`) for one-off actions,
  or a local `error` state rendered inline for forms. An `await api.x(...)` with no
  surrounding try/catch in an `onClick`/`onSubmit` is an unhandled promise rejection —
  the button silently does nothing on failure. A 2026-08 audit found and fixed this
  across most of the app (`ReportsPage`, `ReportForm`, `PromotionsPage`,
  `EventRoomPage`, `ViewAsBar`, `BackupsPage`, `RosterBrowserModal`, ...) — don't
  reintroduce it in new handlers. `AuthContext.applyViewAs` also rolls the `viewAs`
  state back to its previous value if the follow-up `loadMe` fails, so the "View as"
  banner never claims a simulation is active when it isn't.
- Any `useEffect` that fetches data keyed on a value the user can change quickly
  (a regiment/member/category dropdown, a search box) needs a request-generation
  guard, or a fast second change can let the first (now-stale) response land after the
  second and overwrite newer state with older data:
  ```js
  const requestIdRef = useRef(0);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    api.getX(token, id).then((data) => {
      if (requestIdRef.current === requestId) setX(data);
    });
  }, [token, id]);
  ```
  See `RegimentPanel.loadMembers`, `CategoryManagerModal.load`,
  `PromotionsPage.RequirementsTable` for the established shape. An effect with no
  dependency on a fast-changing value (e.g. driven only by a stable `token`) doesn't
  need this. The same 2026-08 audit added this guard to every effect in the app that
  was missing it — if you add a new dropdown-keyed effect, give it its own
  `requestIdRef` rather than reusing a sibling effect's.
- Any user-configured URL rendered as `<a href>` (currently just
  `Regiment.discord_channel_url`, set via `RegimentConfigModal` and displayed in
  `RosterBrowserModal`/`RegimentPanel`) must go through `utils/safeUrl.js` first —
  it returns `null` for anything not `http:`/`https:`, so a `javascript:` URL typed
  into the config field can't execute when someone else opens the roster.
- `hooks/useTheme.js` exports two hooks: `useTheme()` (state + `toggleTheme`, used
  once by `Navbar`) and `useThemeValue()` (read-only, reactive to toggles from
  elsewhere via a tiny pub/sub). Components that just need to know the current theme
  to pick a color palette (`DonutChart`, `TrendChart`) should use `useThemeValue()`,
  not read `document.documentElement.getAttribute("data-theme")` directly — the
  latter doesn't trigger a re-render when the theme changes elsewhere.

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
