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

### Jedi rank track ("ранг" vs "звание", migration 0078)
Jedi have two independent axes, both ultimately just `Rank` rows under
`RankTier.is_jedi=true` tiers, distinguished by `RankTier.is_jedi_rank_track`:
- **Ранг** (personal growth: Падаван → Рыцарь Джедай → Мастер Джедай →
  Гранд-Мастер) — lives in the normal `User.rank_id`/`rank_assigned_at` fields and
  goes through the regular auto-promotion pipeline (tenure/points via
  `PromotionRequirement`, same as any non-jedi regiment) — tier
  `is_jedi_rank_track=true`. Падаван is meant to be a jedi regiment's
  `Regiment.starting_rank_id` so new registrants get it automatically (see
  `override_regiment` in `app/api/registration.py`, unchanged — this is config,
  not code). Гранд-Мастер (`Rank.jedi_manual_only=true`) is excluded from
  `rank_crud.get_next_rank` like звание always was — reachable only through the
  manual-override path below — and is capped at exactly one holder system-wide by
  a partial unique index (`uq_users_single_grand_master`, `WHERE rank_id =
  <that row's id>` — same pattern as `PromotionRequest`'s pending-per-user index,
  migration 0075); `update_member_profile` catches the resulting `IntegrityError`
  and turns it into a friendly `AppError`.
- **Звание** (command title: CO/SCO/GEN/SGEN/HGEN, pre-existing) — lives in the
  separate `User.jedi_title_id` field, independent of ранг, changed only through
  the same manual-override endpoint but gated to `is_admin or is_high_command`
  (stricter than the regiment-commander gate that covers ранг). Звание does
  **not** correlate with ранг — only a ceiling applies: each ранг `Rank` row's
  `max_jedi_title_rank_id` names the highest звание allowed at that ранг (Падаван
  → up to SCO, Рыцарь → GEN, Мастер → SGEN, Гранд-Мастер → HGEN), checked by
  `app/api/regiments.py::_check_jedi_title_ceiling` by comparing positions in
  `rank_crud.get_all_ranks_ordered`'s flat list — a Гранд-Мастер can hold no
  звание at all, and a Падаван can already be a Коммандер.
`rank_crud.get_next_rank` tells ранг from звание via
`is_jedi_rank_track`: звание tiers stay fully excluded from auto-promotion
exactly as before; ранг tiers participate normally except for the
`jedi_manual_only` Гранд-Мастер jump. `_check_rank_matches_regiment` (jedi
regiment ⇔ jedi-tier rank) still applies to `rank_id` only — `jedi_title_id` gets
its own tier check inline in `update_member_profile`.

**Падаван → Рыцарь: five gated trials** (migration 0080, `app/models/jedi_trial.py`,
`app/crud/jedi_trial.py`). `JediTrial(user_id, trial_number 1-5, passed_at,
passed_by_user_id)`, unique per `(user_id, trial_number)`. Each trial has a
mandatory gap in days before it becomes markable — `TRIAL_GAP_DAYS = {1: 0, 2: 1,
3: 2, 4: 1, 5: 2}`, counted from `User.rank_assigned_at` (trial 1) or the
previous trial's `passed_at`; a further `GRADUATION_GAP_DAYS = 1` gates the
Рыцарь promotion itself after trial 5. `update_member_profile`
(`app/api/regiments.py`) blocks setting `rank_id` to the `KNT` (Рыцарь) rank
until `_check_padawan_trials_complete` passes — same friendly-`AppError`
pattern as everywhere else in this file.

Trials are marked via **report approval, not a direct button** (migration
0083, `ReportCategory.is_jedi_trial_report`, system flag like
`is_recruit_promotion`) — the mentor files a "Наставничество" report
targeting the padawan (`_resolve_jedi_trial_target` validates gate/eligibility
at submission so it fails fast), a commander/deputy of the jedi regiment
decides it normally (not auto-approved, unlike `is_training`/
`is_recruit_promotion`), and *approval* is what calls
`jedi_trial_crud.mark_passed` in `_apply_approval_side_effects` — re-checking
the same gate there gracefully (log + skip, matching every other branch in
that function) rather than raising, since the report's status has already
committed by that point. `passed_by_user_id` = the report's author (the
mentor), which is what `jedi_trial_crud.has_trained_a_padawan` (the Мастер
promotion gate, see below) keys off. An earlier direct-button version
(`POST .../jedi-trials/pass`) was replaced by this — don't reintroduce it.

**Jedi specialization branches** (Защитники/Консулы/Стражи —
`CATEGORY_JEDI_GUARDIAN`/`_CONSULAR`/`_SENTINEL`, `app/models/specialization.py`)
reuse the existing `Specialization` catalog (min_rank/required_regiment/
instructor-granted) exactly like medic/pilot/engineer, but are deliberately
**not** added to `DISCIPLINE_CATEGORIES` — that constant is wired to fixed
`RankTier.<category>_limit` columns and the `InstructorDiscipline` Literal
(medic/pilot/engineer only), so any instructor can grant a jedi branch
specialization today (gating this to a "Совет Ордена" role is planned as a
separate feature, not built yet). Hard rule enforced in
`_check_can_grant` (`app/api/specializations.py`): a specialization from one
branch can't be granted to someone who already holds a specialization from a
*different* branch — branches don't mix, checked via `JEDI_BRANCH_CATEGORIES`.
The specializations themselves (Фехтовальщик/Целитель/Хранитель/etc., plus the
branch-agnostic Ас/Конструктор/Библиотекарь) are catalog data added through the
existing Admin Panel UI, not a migration.

**Report category daily cap** (`ReportCategory.max_per_day`, migration 0079) —
generic, not jedi-specific: caps how many times one author can file a given
category per calendar day (checked in
`_check_category_filing_restrictions`/`app/api/reports.py` via
`report_crud.count_reports(since=<start of today UTC>)`). `None` = unlimited,
as before. Configured per-category in `CategoryManagerModal.jsx`'s
"restrictions" panel (same place as `min_rank`/`commander_only`), not
available at category-creation time — same convention as those two fields.

**Jedi Council** (`User.jedi_council_seat`, migration 0081) — 4 branch-head
titles (Консулы/Защитники/Стражи/Ученичество), plain `unique=True` string
column (not partial — NULL is exempt from uniqueness in standard SQL, so this
alone guarantees at most one holder per seat value without needing a Grand-
Master-style partial index). Deliberately carries **zero** permissions —
`AccessContext`/`_compute_permission_fields` never reads it; unlike
`RegimentCommander`, which grants full deputy-level access on ANY `role_type`
assignment (see `commander_regiment_ids` in `app/api/deps.py`), so Council
titles intentionally do NOT go through that table. Changed only by
`is_admin`/`is_high_command` via the same `update_member_profile` endpoint as
`jedi_title_id`, same `IntegrityError`→friendly-`AppError` pattern for a seat
that's already taken.

**Jedi "trained a padawan" promotion gate** — Рыцарь→Мастер additionally
requires having mentored at least one padawan through to Рыцарь, checked via
`jedi_trial_crud.has_trained_a_padawan` (any `JediTrial` row with
`trial_number=5` where this user is `passed_by_user_id`) — wired into both
`promotion_crud.check_and_create_promotion_request` (blocks the auto-fire) and
`PromotionStatusRead.jedi_needs_trained_padawan` (UI hint), gated on
`regiment.is_jedi_order and next_rank.code == "MST"` so it's invisible to
every non-jedi promotion path.

**Singleton specializations** (`Specialization.is_singleton`, migration
0082) — for one-of-a-kind grants (e.g. the "Ваапад" saber form): at most one
user may hold it at a time, checked in `_check_can_grant`
(`get_singleton_holder_id`). Deliberately **application-level only**, no DB
constraint — unlike the Grand-Master/Council patterns above, the specific
specialization row doesn't exist yet at migration time (specializations are
catalog data added through the Admin Panel UI, not migrations), so a partial
unique index naming its id can't be written upfront; the race window is
accepted as low-risk (instructor-driven, infrequent, manual grants).
Force-ability/saber-form catalog data (`jedi_force_ability`/`jedi_saber_form`
categories) is added the same way — through the Admin Panel, not migrations —
same as jedi branch specializations above.

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
