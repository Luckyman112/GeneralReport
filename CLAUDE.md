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
- A Pydantic *Read* schema for a model whose column is a real SQLAlchemy `Enum`
  (a `str`-subclassing Python enum, e.g. `EventStatus(str, enum.Enum)`) must type
  that field as the actual enum class, not `Literal["a", "b", "c"]` — pydantic-core
  requires an exact type match when validating `from_attributes=True` against the
  live ORM attribute (a real enum instance), so a `Literal` alias crashes with a 500
  the first time such a row is read. Recurred five times before a full audit caught
  the rest (`ReportRead.status`, `EventBookingRead.status`, `EventRead.status`/
  `cancelled`, `EventActivityReportRead.status`, `AdminReportRead.status`) — always
  match the model's enum type, never re-declare it as a `Literal`.
- Every crud module's `_LOAD_OPTIONS` that feeds a `UserBrief`-typed field (any
  `submitted_by`/`decided_by`/`requested_by`/`passed_by`/`sent_by`/... relationship)
  **must** chain `.selectinload(User.rank)` — `UserBrief.rank` is read during response
  serialization, and an un-eager-loaded relationship accessed outside `await` in
  async SQLAlchemy raises `MissingGreenlet`, a 500. Silently masked in local testing
  whenever the test account happens to have `rank_id IS NULL` (a bare FK with no
  value resolves without a DB round-trip) — only reproduces with a real ranked user,
  which is why it shipped repeatedly. Found missing in five modules in one audit
  (`event_booking.py`, `event_activity_report.py`, `admin_report.py`,
  `event_message.py`, `jedi_trial.py`) — `event.py`/`report.py`/`audit_log.py`/
  `leave_request.py`/`reprimand.py`/`violation.py`/`wanted.py`/`transfer_request.py`/
  `specialization.py`'s grant/ban options already had it right; use those as the
  template for any new crud module with a `UserBrief` field.
- When a `create_*` crud function calls `get_or_create_in_all_regiments` (or any
  similar "ensure this exists everywhere" backfill) to handle regiments added after
  the feature launched, the matching `update_*` function needs the same call —
  otherwise a regiment created *after* the row existed silently never gets it, and an
  edit that should apply "everywhere" quietly misses it. See
  `promotion_crud.update_mandatory_category_requirement` (fixed to mirror
  `create_mandatory_category_requirement`'s call to
  `report_category_crud.get_or_create_in_all_regiments`) — check for this asymmetry
  whenever a create/update pair straddles a "for all current X" concept.

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
- `POST /me/registration` (`app/api/registration.py`) used to best-effort assign the
  17th's Discord role via `discord_client.add_member_role` on every submission,
  regardless of whether the registrant already held another formation's role —
  removed (see решение пользователя): Discord roles are already synced from the
  in-game state by a separate mechanism outside this app, and this auto-grant was
  stacking the 17th's role on top of a real formation role, producing the
  two-formation-roles state `hasRoleConflict` (`App.jsx`) exists to catch.
  `discord_client.py` is now fully read-only (no write calls at all) — membership
  in the 17th (and every other regiment) is entirely driven by whatever Discord role
  the external sync/staff assign, same as any other formation.
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

`RecruitsPage.jsx` route (`/recruits`) is open to every authenticated user (not
`reviewerOnly`) — the roster/search table itself stays gated inline
(`canViewRoster` = admin/high-command/any `commander_regiment_ids`), but
`GET /reports/recruit-training` (`app/api/reports.py`) is intentionally visible to
anyone with `access.has_access`, listing every `is_recruit_promotion` report
regardless of regiment (bypasses the normal `GET /reports` regiment-membership
filtering entirely, via `report_crud.list_for_category_public` — excludes drafts
so a stray unsent one never leaks). `report_category_crud.get_recruit_promotion_category`
resolves the one such category by `recruit_regiment_id` + the `is_recruit_promotion`
flag rather than by name.

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

**Падаван → Рыцарь: six gated trials, the 6th is the attestation itself**
(migration 0080, extended to 6 in a later session — `app/models/jedi_trial.py`,
`app/crud/jedi_trial.py`). `JediTrial(user_id, trial_number 1-6, passed_at,
passed_by_user_id)`, unique per `(user_id, trial_number)` — `TRIAL_COUNT = 6`,
trial 6 **is** the Рыцарь attestation, not a separate mechanism (see решение
пользователя — one JediTrial table, not a bespoke graduation flow). Each trial
has a mandatory gap in days before it becomes markable —
`TRIAL_GAP_DAYS = {1: 0, 2: 1, 3: 2, 4: 1, 5: 2, 6: GRADUATION_GAP_DAYS}`,
counted from `User.rank_assigned_at` (trial 1) or the previous trial's
`passed_at`. Because trial 6 is folded into the same ladder, there is no
separate `graduation_available_at` function/field any more — `_check_padawan_trials_complete`
(`app/api/regiments.py`, the safety-net gate `update_member_profile` calls
before allowing a manual `rank_id` change to `KNT`) is now a plain
"`next_trial_number(passed) is None`" count check; the day-gap was already
enforced when trial 6 got marked.

Trials 1-5 are marked via **report approval, not a direct button** (migration
0083, `ReportCategory.is_jedi_trial_report`, system flag like
`is_recruit_promotion`) — the mentor files a "Наставничество" report
targeting the padawan (`_resolve_jedi_trial_target` validates gate/eligibility
at submission so it fails fast, and now explicitly refuses once trial 6 is
next — that's a different category, see below), a commander/deputy of the
jedi regiment decides it normally (not auto-approved, unlike `is_training`/
`is_recruit_promotion`), and *approval* is what calls
`jedi_trial_crud.mark_passed` in `_apply_approval_side_effects` (capped at
`trial_number <= 5` in this branch) — re-checking the same gate there
gracefully (log + skip, matching every other branch in that function) rather
than raising, since the report's status has already committed by that point.
`passed_by_user_id` = the report's author (the mentor). An earlier
direct-button version (`POST .../jedi-trials/pass`) was replaced by this —
don't reintroduce it.

Trial 6 (**"Аттестация"**, migration 0090, `ReportCategory.is_jedi_attestation_report`)
is a separate system category/report flow, deliberately not folded into
"Наставничество" — `_resolve_jedi_attestation_target` requires
`next_trial_number(passed) == TRIAL_COUNT` (all 5 done) before allowing
submission. Its `_apply_approval_side_effects` branch marks trial 6 passed
**and then immediately sets `rank_id` to `KNT`** in the same branch — exact
copy of the `is_recruit_promotion` pattern (snapshot/reset
`early_promoted_by_username`/`early_promotion_reason`, call
`promotion_crud.cancel_pending_for_user` for any stale pending
`PromotionRequest`) — one approval both marks the attestation *and* promotes,
no separate manual step (see решение пользователя). `jedi_trial_crud.has_trained_a_padawan`
(the Мастер promotion gate) is intentionally hardcoded to `trial_number == 5`,
not `TRIAL_COUNT` — mentoring credit is about completing the 5 real trials,
independent of who (possibly someone else) later approves the attestation.
The category isn't creatable through the normal category API (same as
`is_jedi_trial_report` before it) — seed it by hand in the DB for the Jedi
regiment, same filing restrictions (`min_rank_id`/`commander_only`) as
"Наставничество" applied afterward via the normal `PATCH` category endpoint.
Frontend: `JediAttestationReportForm.jsx` (clone of `JediTrialReportForm.jsx`),
wired into `ReportsPage.jsx`'s overflow menu next to "Наставничество";
`MemberDetailModal.jsx`'s trial checklist now shows 6 items, the 6th labeled
"Аттестация" instead of "Испытание 6".

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
that's already taken. Assignable two ways: the per-member profile form
(`MemberDetailModal.jsx`) or, since this session, directly from
`RegimentConfigModal.jsx`'s "Главы направлений" section (jedi-order regiments
only) — a 4-row picker sourced from that regiment's own roster
(`api.getMembers`), reusing the exact same `PATCH .../profile` call. Reassigning
a seat that's already held does a two-step dance client-side (clear the old
holder, then set the new one) to dodge the unique-constraint `IntegrityError` —
the backend has no "swap" endpoint.

**"Следящий за джедаями" vs "Командир"** — the `RegimentCommander.role_type`
value is still the literal string `"commander"` everywhere (DB, permission
checks, `AccessContext.commander_regiment_ids`) — only the *displayed* label
changes for jedi-order regiments, via
`frontend/src/utils/regimentRoles.js::commanderRoleLabel(roleType,
isJediOrder)`. Deputy/mentor labels are unaffected. Applied everywhere the role
renders in a jedi-order context: `RegimentConfigModal.jsx` (formation config +
its `InfoHint`), `HqLeadershipPanel.jsx` (Штаб page — needed
`HqFormationLeadershipRead.is_jedi_order`, added to the backend schema/endpoint
since `HqFormationLeadershipRead` didn't carry it before), `Navbar.jsx`'s own
position badge, `RosterBrowserModal.jsx`'s per-row position column (and its
"командир sorts first" comparison, which now compares against the *label*, not
the literal string `"Командир"`), and `ViewAsBar.jsx`'s role picker/active-banner.
The one deliberate exception: `SettingsPage.jsx`'s "Командир" role-config card
is a *different* concept entirely — a single global Discord role
(`commander_role_id`) used for `category_manager_regiment_ids` across every
regiment, not scoped to one formation, so it isn't jedi-aware and wasn't touched.

### Registration is no longer bypassed for is_admin/is_high_command
`Layout`'s `needsRegistration` gate (`App.jsx`) used to exempt anyone with
`is_admin` or `is_high_command` — convenient for bootstrapping the very first
admin, but it meant such a person could use the whole site indefinitely without
ever completing the registration terminal, leaving `service_id`/`steam_id`
permanently empty — which then showed up as a confusing "не зарегистрирован"
badge on someone who clearly had full access (bug report). Now only
`access.is_founder` is exempt (a narrower, explicit-list flag — see
`app/api/deps.py`), preserving *a* bootstrap escape hatch without exempting the
much broader admin/HC population. Known tradeoff, accepted deliberately: if the
only non-founder admin on a fresh install hasn't registered yet, nobody else can
approve their registration (the registrations queue itself is unreachable while
`needsRegistration` is true) — acceptable here since production already has
multiple registered admins. The `isBlockedByMaintenance`/`hasRoleConflict` gates
in the same component still exempt admin/HC same as before — unrelated,
deliberately untouched.

### `event_crud.decide` (and its Администрация/Ивентрум siblings) now reject re-deciding
`event_crud.decide` had no guard against being called on an already-decided
`Event` — unlike `promotion_crud.decide`, which has always raised on a non-
`"pending"` row. A double-click (or any repeated `POST .../approve`) on an
already-approved event silently re-ran the whole approval side-effect chain
every time, including **re-sending the Discord notification with the ping role**
— bug report: one event approved 7 times, pinging the whole server 7 times, no
duplicate `Event` rows involved since it's the same row re-approved repeatedly.
Fixed by adding the same `status != PENDING → raise AppError` guard `promotion_crud.decide`
already had. The same missing-guard bug existed in the three sibling `decide()`
functions built from the same template this session —
`event_activity_report_crud.decide`, `event_booking_crud.decide`,
`admin_report_crud.decide` — fixed identically, even though only the Event one
has an externally-visible side effect (Discord ping); the others were still
silently allowing an approved/rejected row to flip status again.

A follow-up full-repo audit found the same missing-guard bug in three more
places, now fixed the same way: `leave_request_crud.decide`,
`reprimand_crud.revoke` (only the commander-facing `DELETE .../reprimands/{id}`
route was missing it — `self_revoke_reprimand` already checked `revoked_at`
before calling in), and `update_report_status`
(`app/api/reports.py`) — the last one needed a narrower fix than a blanket
status guard, since re-*rejecting* an already-approved report is the
legitimate appeal path (see `was_approved`); only re-*approving* an
already-approved report is blocked, because that's what re-ran
`_apply_approval_side_effects` a second time — double-counting a padawan's
Jedi trial via "Наставничество," or re-clearing a recruit's
`rank_assigned_at` via "Курс молодого бойца."

Same audit also found `specialization_crud.get_by_id` was the one `get_by_id`-
style function in the whole codebase missing `populate_existing=True` (every
other one already has it — this exact gotcha is why the pattern is documented
above), and `specialization_crud.update` only refreshed `min_rank` after
commit, not `required_regiment`/`parent` — with `expire_on_commit=False`,
changing either field via `PATCH /specializations/{id}` could return the
pre-update relationship in the same response. Both fixed.

A round-2 audit pass over the previously-unreviewed backend files found five
more, also fixed:
- `update_member_profile` (`app/api/regiments.py`) only ran the stale-
  `PromotionRequest` cleanup (`cancel_pending_for_user`) when `rank_id` was
  present in the *request payload* — but discharging someone
  (`is_inactive: true`) also nulls `rank_id`, just *inside*
  `user_crud.update_profile`, invisibly to that check. Now `became_inactive`
  triggers the same cleanup.
- `_finalize_transfer_if_ready` (`app/api/auth.py`) changes `rank_id` on
  transfer completion the same way `update_member_profile` does, but never
  called `cancel_pending_for_user` at all — same stale-request symptom,
  different trigger path. Fixed identically.
- `character_crud.create`/`update` never set `Character.rank_assigned_at`
  (unlike `user_crud.update_profile`, which always does when `rank_id`
  changes) — every `Character`-backed roster row (secondary/dual-formation
  characters) showed `days_in_rank = None` forever, even with a real rank set.
  Fixed to mirror the `User` behavior.
- `get_member_promotion_status` and `get_promotion_review`
  (`app/api/promotions.py`) checked `access.is_commander_of(regiment_id)`
  instead of `access.can_decide_promotion(regiment_id)` — the latter is the
  method that carries the 17th-Recruit-Regiment carve-out (any regiment's
  commander/deputy, not just the 17th's own, per the Recruit pipeline section
  above). Someone who could validly *decide* a recruit's promotion request via
  `can_decide_promotion` got a 403 trying to view that same recruit's
  promotion-status summary or a decided request's review. Both now call
  `can_decide_promotion`.
- `event_booking_crud.decide`/`admin_report_crud.decide`/
  `event_activity_report_crud.decide` never notified the submitter of the
  decision, unlike every sibling decide-flow in the app (`transfer_requests`,
  `reports`, `promotions`, `event_crud.decide`) which all call
  `notification_crud.create_personal_notification`. Added the same call to
  all three `app/api/*.py` endpoints (not the crud layer, to keep `decide()`
  free of notification concerns — matches where `event_room.py` puts its own
  Discord-side notification, outside `event_crud.decide`).

### HqLeadershipPanel is now clickable
`HqLeadershipPanel.jsx` (Штаб page) used to be explicitly non-clickable by
design (see prior docstring, now removed) — reversed by user request. Clicking
a name fetches that regiment's full roster (`api.getMembers`) and finds the
matching `discord_id`, because `HqPersonRead` (the schema this panel's data
arrives in) is missing most fields `MemberDetailModal` expects
(`discord_username`, `is_inactive`, `squads`, etc.) — reusing `HqPersonRead`
directly would render a broken-looking modal. For the "Высшее командование" top
block (not tied to any single regiment), a `regiment_id` is inferred by finding
that same `discord_id` in one of the formation blocks below; if they don't
appear in any, the name isn't clickable (no regiment context to fetch against).

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

### Ивентрум extensions (5-tier ladder, activity reports, booking calendar)
The original 2-role approval system (`event_assistant_role_id`/
`event_curator_role_id`) is unchanged — `can_decide_event` still means
Assistant+/Curator only. What's new is 3 more nullable `AppSettings` columns
(`event_junior_role_id`, `event_senior_role_id`, plus the pre-existing
`event_role_id` renamed in spirit to "regular") that only widen who counts as
`is_event_submitter` — junior/regular/senior confer zero additional
permissions, by explicit user decision.

`EventActivityReport` (`app/models/event_activity_report.py`) — completion
reports for a conducted event ("Мини-ивент"/"Боевой вылет"), distinct from
`Event` (a booking/request made *before* the event, with location/plot). Same
freeform-JSON-payload shape as `Event`/`AdminReport`; approval is
`can_decide_event` (unchanged 2-role gate), submission is
`is_event_submitter` (all 5 tiers). Activity summary
(`GET /event-activity-reports/activity-summary`) is a near-duplicate of
`admin_report_crud.activity_summary_for_user_ids` — if a third domain needs
this shape, consider extracting the aggregation into a shared helper instead
of copying a third time.

`EventBooking` (`app/models/event_booking.py`) — date/time slot reservation
ahead of running an event, so two Ивентологи can't double-book the same
window; `app/api/event_bookings.py::create_booking` rejects on overlap with
any non-rejected booking (`event_booking_crud.list_in_range` — half-open
interval overlap check, `starts_at < range_end AND ends_at > range_start`).
Same `can_decide_event`/`is_event_submitter` gates. Frontend
`EventBookingCalendar.jsx` is a hand-rolled month grid (no date library in
this project) — click a day to open a prefilled (18:00–20:00) booking form.

Both new features render as extra sections appended to the existing
`EventRoomPage.jsx` (`<EventBookingCalendar />`, `<EventActivityReports />`)
rather than new routes/sidebar entries — they're part of Ивентрум, not
sibling features (contrast with Администрация below, which got its own page
because it's a wholly new non-RP concept, not an extension of something
already on a page).

**Planet info lives on the Event, not the reusable map** (a later session) —
`EventMap` used to carry `planet_name`/`landscape`/`weather`/`star_system`;
those columns were dropped (migration 0088) and the same data now lives as
plain keys in `Event.payload` (`planet_name`, `star_system`, `landscape`,
`weather`, plus new `flora_fauna`), filled in on the submission form itself
since a planet is a property of one event, not of a reusable map. `EventMap`
is now just `name`/`url`. `_build_event_embed` (`app/api/event_room.py`)
renders these as structured embed `fields` (was free text in `content` via a
now-removed `_planet_info_text` helper) — `content` is only the role-ping
(`_message_content` → `_ping_content`).

**Booking↔event linkage** — `GET /event-bookings/mine` (own approved
bookings) feeds a "Забронированное время" `<select>` in the event submission
form (`EventRoomPage.jsx`); picking one auto-fills "Начало брифинга" from the
booking's `starts_at` (the field stays independently editable — this is an
autofill, not a hard link, there's no FK from `Event` to `EventBooking`).

**Cancelling an already-*approved* event or booking** — first precedent in
the codebase for reversing a decision that already had a visible Discord
side-effect. `EventStatus.CANCELLED` (migration 0089) is a distinct terminal
status from `REJECTED` ("never approved" vs. "approved, then walked back");
`Event` gained `cancelled_by_user_id`/`cancelled_at`/`cancellation_reason`
columns rather than reusing `decided_by`/`decided_at`, so the original
approver's decision stays on record. `POST /event-room/{id}/cancel`
(`event_crud.cancel`, gated `!= APPROVED → AppError`) edits the already-sent
Discord card via `discord_client.edit_channel_message` — same embed, title
prefixed `❌ ОТМЕНЕНО —`, red color — rather than deleting it or leaving it
looking live. `EventBooking` has no Discord card to relabel, so its
`POST /event-bookings/{id}/cancel` (`event_booking_crud.cancel`) just reuses
the existing `REJECTED` status instead of adding a parallel enum value.
Both gated `can_decide_event`, both frontend "Отменить" buttons go through
`ConfirmDialog`.

**Active/Archive split in "Все заявки"/"Мои заявки"** — frontend-only
(`EventRoomPage.jsx`): an event is archived once `payload.briefing_start` is
set and in the past; no date or a future date keeps it in the main list. The
row markup was factored into `EventRow` so active/archived share it; archived
renders inside a collapsed `<details><summary>Архив (N)</summary>` (the
project's one collapsible-section pattern, see `InstructorRoomPage.jsx`).

**Notify-on-approval + submitter message button** — `approve_event` now also
fires `notification_crud.create_personal_notification` to the submitter. A
separate `POST /event-room/{id}/message` lets the *submitter of their own
approved* event (not the approver) post a free-text follow-up — gated on
`row.submitted_by_user_id == access.user.id` and `status == "approved"`, and
requires `event_notify_channel_id` configured — sent as a plain extra message
in the same channel as the card (`💬 {username}: {content}`), never edits the
card/embed itself.

### Ивентрум roster — merged состав+activity table, split mini/combat
`GET /event-room/roster` (`app/api/event_room.py::get_roster`) is one merged
table (roster + activity summary used to be two separate tables/endpoints —
see git history, `EventActivityReports.jsx`'s old "Сводка активности" section
was removed once this merge landed) with a single period selector
(`week`/`month`/`all`) driving **both** the table's Мини-ивент/Боевой вылет
columns and the two `HorizontalBarChart`s below it (`EventRoomPage.jsx`'s
`RosterPanel`) — there's no separate "chart period" vs "table period" state.
Mini-event and combat counts are tracked as fully separate fields
(`EventRosterEntry.mini_count_*`/`combat_count_*`, populated from
`event_activity_report_crud.activity_summary_for_user_ids`'s per-`event_type`
breakdown) rather than one combined number, by explicit user decision.
Clicking a roster row opens `EventMemberDetailModal.jsx`, backed by
`GET /event-room/roster/{discord_id}` — this endpoint independently re-derives
the member's role from live Discord roles (same `role_labels` dict pattern as
`get_roster`) rather than trusting a role param from the client, and 404s if
the discord_id isn't currently a live member or doesn't hold one of the 5
Ивентрум roles. Returns the member's rank plus their full `Event`/
`EventActivityReport` lists (not just aggregate counts) via
`event_crud.list_all`/`activity_report_crud.list_all` filtered by
`submitted_by_user_id`.

### Stale PromotionRequest cleanup — `promotion_crud.cancel_pending_for_user`
`User.rank_id` can change through two paths that bypass `promotion_crud.decide()`
entirely: `update_member_profile`'s manual rank override
(`app/api/regiments.py`) and `is_recruit_promotion`'s auto-approval side effect
(`_apply_approval_side_effects` in `app/api/reports.py`, sets `rank_id`
directly to PVT). Either one left a pre-existing pending `PromotionRequest`
behind with a now-stale `from_rank`, visibly stuck on the Promotions page with
a transition that no longer makes sense (e.g. a Jedi Padawan still showing a
leftover "RCT → PVT" recruit-era request). Both call sites now call
`cancel_pending_for_user(db, user_id=..., reason=...)` right after the
rank-changing commit, which flips that pending row to a new `"cancelled"`
status (not `"rejected"` — a genuine decision vs. an administrative
housekeeping cleanup) and rejects its mirror `Report` row (category
"Повышение") the same way `decide()` would. `PromotionRequest` has no
`rejection_reason` column, so the reason string is logged, not persisted.
**`"cancelled"` is deliberately excluded from
`list_decided_for_user`** (personal "История повышений" on `HomePage.jsx`) —
that endpoint's frontend only renders `approved`/`rejected` labels, and a
cancelled row would otherwise misleadingly show as "отклонено" (rejected).
Existing stale rows from before this fix aren't backfilled — an admin/commander
resolves them manually via the normal Отклонить button.

### Registration reset vs. discharge — two different "make them re-register" levers
"Разжаловать" (`update_profile` with `is_inactive=True`) is the heavy option: wipes
`service_id`/`callsign`/`rank_id`/`jedi_title_id`, hides the member from the roster,
and forces a full from-scratch registration (starting rank re-assigned) on
reinstatement. For the common case of just needing someone to redo the *registration
terminal* itself (e.g. re-link a different Steam account, fix a typo'd ИДН) without
losing rank/position/roster visibility, there's a separate lighter action:
`POST /regiments/{regiment_id}/members/{discord_id}/reset-registration`
(`app/api/regiments.py::reset_member_registration`, strictly `is_admin` — "Высшая
администрация+", stricter than the regular profile-edit gate) →
`user_crud.reset_registration` clears only `registration_status` (→ `"pending"`),
`service_id`, `steam_id`/`steam_verified` — rank/callsign/roster membership
untouched. Two things had to line up in `RegistrationGate.jsx` for this to actually
reopen the terminal rather than showing "заявка на рассмотрении": `alreadySubmitted`
is keyed off `service_id` (must be cleared) and the Steam step
(`askSteamStep`) skips itself whenever `user.steam_id` is already truthy (also
must be cleared to let them re-link). `POST /me/registration`
(`app/api/registration.py::submit_registration`) — the same endpoint every fresh
recruit hits — unconditionally forced `rank_id` to the starting rank (RCT or the
regiment's `starting_rank_id` override) on every submission; that's now gated on
`access.user.rank_id is None`, so a reset-triggered resubmission keeps whatever
rank the member already had instead of getting bounced back to recruit.

### Administration (non-RP staff role, separate from is_admin)
"Администрация" (game moderation staff — bans/mutes/item grants) is
deliberately **not** a `Regiment` — membership doesn't correlate with RP
formation membership at all (someone can be a Guard sergeant AND Curator of
Administration simultaneously). Modeled after the Ивентрум precedent
(`app/models/event.py`/`app/api/event_room.py`): a 5-role ladder as flat
nullable `AppSettings` columns (`admin_staff_junior_role_id` →
`admin_staff_curator_role_id`, migration 0084) rather than a table, since it's
a small fixed catalog (unlike `InstructorRole`, the one precedent for a
*table-driven* N-roles-to-tier mapping, which exists because
medic/pilot/engineer disciplines are genuinely more open-ended). Resolved live
per-request in `AccessContext.admin_staff_rank_code`/`_tier`
(`app/api/deps.py`) — same as every other role check in this codebase, no
membership stored in the DB. `admin_staff_tier`: junior/middle/senior (senior
= Варден+). `can_decide_admin_report` = admin, senior, or an individually
whitelisted "responsible" middle (`admin_staff_responsible_middle_discord_ids`,
same one-off-override pattern as `admin_user_discord_ids`).

Reports ("Отчёт деятельности"/"Отчёт наказаний") are `AdminReport`
(`app/models/admin_report.py`) — copies the `Event` shape exactly (freeform
`payload: JSON`, frontend-only field validation, no `regiment_id`) rather than
`Report`/`ReportCategory`, which carries RP-specific baggage (rank snapshots,
points/promotion-pipeline wiring, `regiment_id` FK) that doesn't apply here.
Activity summary (`GET /admin-reports/activity-summary`) resolves the live
Discord roster against the 5 role ids (same pattern as
`event_room.py::get_roster`) and aggregates `AdminReport` counts (7d/30d/all-
time + last) via `admin_report_crud.activity_summary_for_user_ids`.

`app/core/uploads.py::read_file_upload` — new sibling to `read_image_upload`,
same chunked-read-with-cap discipline but **no** Pillow byte validation
(added for video evidence attachments, which aren't images); only use it
where a spoofed Content-Type has low stakes (an attachment, not something
security-sensitive).

`GuildMemberRead.last_report_at` (any regiment, not Administration-specific)
— last `Report.created_at` for the user, bulk-computed via
`report_crud.last_report_at_by_user_ids` (one `GROUP BY` for the whole
roster, not N+1) and mixed into `_build_guild_member` only from
`get_members`'s roster-list call site — the single-member endpoints
(photo upload/delete, tenure override, profile update) don't bother, since
their `GuildMemberRead` response isn't rendered anywhere that shows it.

"Администратор" → "Высшая администрация": **label-only** rename (`Navbar.jsx`
position badge, `SettingsPage.jsx` role-config card header) to avoid clashing
with the new "Администрация" name — `is_admin`/`admin_role_id`/error-message
strings deliberately untouched (explicit user decision, minimal-diff option).

### Ивентрум/Администрация batch (2026-08): booking auto-approve, activity trends, archives, RP-profile switch, reprimands

Nine-stage batch, each stage independently committed/pushed. Together they
established several new reusable patterns:

- **`EventBooking` no longer needs approval** — `event_booking_crud.create`
  sets `status=APPROVED` directly (was `PENDING`); the overlap check alone
  prevents double-booking. `EventBookingDecide`/`decide()`/`PATCH
  /event-bookings/{id}` were removed as dead code — a booking can now only be
  cancelled (`POST .../cancel`), never explicitly approved/rejected.
- **Archive-as-collapsible-strip, two variants of the same idea** — Ивентрум
  (`EventRoomPage.jsx`) wraps each archived `EventRow` in its own `<details
  className="event-archive-strip">` (one strip per item, title+time summary);
  Администрация (`AdminStaffPage.jsx`) instead wraps the WHOLE archived list
  in a single `<details>` labeled "Архив (N)" (one strip total). Both reuse
  the same `.event-archive-strip`/`.event-archive-list` CSS (visually generic
  despite the `event-` prefix in the class name — not renamed to keep the
  diff minimal). Администрация's archive cutoff is 14 days since
  `decided_at` on a resolved (`approved`/`rejected`) report — `pending` never
  archives; it's pure frontend filtering, no backend change.
- **`TrendChart` (existing component) now also drives an activity graph with
  its own independent period state** — `ActivityTrendPanel.jsx` (Неделя/
  Месяц/Свои даты) is used identically in `EventRoomPage.jsx`'s `RosterPanel`
  and `AdminStaffPage.jsx`. Deliberately NOT wired to the existing
  week/month/all `PERIOD_OPTIONS` selector that already drives the roster
  table/bars — that selector's fields (`mini_count_week` etc.) are
  pre-computed fixed windows on the backend and can't retroactively serve an
  arbitrary custom date range, so a genuinely separate period control was the
  only option. Backend: `daily_type_counts(db, *, since, until)` in both
  `event_activity_report_crud` and `admin_report_crud` (`GROUP BY
  to_char(created_at, 'YYYY-MM-DD'), <type column>`, APPROVED only) feeds
  `GET /event-room/roster/trend` / `GET /admin-reports/activity-trend` —
  both always emit the FULL day range (including zero-activity days), same
  precedent as `stats.py::get_formation_stats`.
- **`AdminMemberDetailModal.jsx`** (new) — click a username in Администрация's
  "Сводка активности" to open a досье with an Администрация/РП tab switch.
  "Администрация" tab shows rapports (split `activity_reports`/
  `punishment_reports`) + reprimand history, backed by `GET
  /admin-reports/roster/{discord_id}` (mirrors `event_room.py`'s
  `get_roster_member_detail`). "РП" tab, if `regiment_id` resolved (see
  below), hands off ENTIRELY to the existing `MemberDetailModal` — that
  component's own `onClose` is wired to flip the tab back to "Администрация"
  rather than closing the whole thing, since `MemberDetailModal` renders as
  its own independent portal/overlay, not something nested visually inside
  the parent modal. `EventMemberDetailModal.jsx` got the identical
  Ивентрум/РП switch retrofitted (same tab-swap-via-onClose trick). Both
  `AdminMemberDetail`/`EventMemberDetail` schemas gained `regiment_id`/
  `regiment_name`, resolved via the pre-existing
  `regiment_crud.resolve_regiments_for_discord_ids` (previously only used for
  joint-report participant resolution) — first non-null regiment wins, since
  Администрация/Ивентрум membership has no inherent tie to exactly one RP
  formation.
- **`AdminReprimand`** (`app/models/admin_reprimand.py`, migration 0092) — a
  deliberately separate table from `app/models/reprimand.py::Reprimand`, not
  a reuse: `Reprimand.regiment_id` is a non-nullable FK and its permission
  gate (`_is_commander_anywhere`/`can_reprimand`) is RegimentCommander-based,
  neither of which fits Администрация (not tied to one formation). No
  `points_required`/`auto_escalated` either — that machinery depended on a
  formation's report-points system, which doesn't exist here. Just
  `target_user_id, reason, severity (verbal|strict), issued_by_user_id,
  issued_at, revoked_at, revoked_by_user_id`; issue/revoke gated on
  `access.can_decide_admin_report`; revoke has the same
  already-revoked-raises guard as `reprimand_crud.revoke`. Surfaced as an
  `active_reprimand_count` badge in `AdminActivitySummaryEntry` and full
  history in `AdminMemberDetail.reprimands`.
- **Punishment report target field** (`AdminStaffPage.jsx`'s
  `PUNISHMENT_FIELDS`) is an optional `MemberSearchPicker` sourced from a new
  `GET /admin-reports/member-candidates` (copy of
  `event_room.py::get_member_candidates` — whole live guild roster, not
  scoped to one formation) rather than the existing
  `getViolationTargetCandidates` (which IS formation-scoped and wouldn't fit
  — a punishment target can be anyone). Stores `punishment_target_discord_id`
  + `punishment_target` (display username) in the freeform `payload`;
  `punishment_target_discord_id` is excluded from the generic
  payload-key-dump rendering in the report list (same exclusion list as
  `attachment_url`) so it doesn't show as a second raw-ID line under the
  human-readable name.
- **`admin_report_crud.decide` asymmetric guard** — changed from blocking
  ANY re-decision of a non-pending report to the same `was_approved` pattern
  `update_report_status` (`app/api/reports.py`) already used: only
  re-*approving* an already-approved report is blocked; rejecting an
  already-approved one (Senior+ changed their mind) is always allowed, and so
  is re-deciding an already-rejected one in either direction — the reference
  pattern doesn't block those either. `AdminStaffPage.jsx` grew a second
  action row ("Отклонить (передумали)") that appears on `approved` rows.
- **`RegimentPanel.jsx`'s "Командование" group** now pulls in commander
  **and** deputy **and** mentor (previously only `role_type === "commander"`
  — deputy/mentor were silently left buried, unlabeled, in their normal
  rank-tier group). Each row gets a `roleLabel` (via the existing
  `commanderRoleLabel(roleType, isJediOrder)`) rendered as a `.squad-badge`
  next to the name; group order is always Командир → Заместитель →
  Наставник. A leadership member who hasn't completed site registration
  still renders (with the pre-existing "не зарегистрирован" badge) — this
  was the original bug report, an anonymous unlabeled row with no indication
  of which leadership seat it was.

**Gotcha hit while testing this batch**: `app_settings_crud.get()` caches the
singleton `AppSettings` row in a 30s in-process memory cache
(`_cached_row`/`_cached_at` module globals, see the docstring above `get()`).
Mutating the row directly via `db.get(AppSettings, id)` + `setattr` +
`commit()` (bypassing `app_settings_crud.update()`, which correctly calls the
private `_remember()` refresher) leaves the cache stale for up to 30s —
reads through `get()` (which is what every permission/role check in the app
uses) silently keep returning the old values. Relevant any time role-id
config is changed outside the normal `update()` path (test scripts,
one-off DB fixes) — either go through `update()` or reset
`app_settings_crud._cached_row = None` afterward.

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
