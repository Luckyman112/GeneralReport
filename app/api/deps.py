# shared fastapi deps: db session, current user, access context
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import PASSWORD_LOGIN_DISCORD_ID
from app.core.security import decode_access_token
from app.crud import app_settings as app_settings_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import specialization as specialization_crud
from app.crud import squad as squad_crud
from app.models.specialization import DISCIPLINE_CATEGORIES
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import NotFoundError, UnauthorizedError
from app.models.user import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(credentials.credentials)
    user = await user_crud.get_by_id(db, int(payload["sub"]))
    if user is None:
        raise UnauthorizedError("Пользователь не найден, войдите заново")

    app_config = await app_settings_crud.get(db)
    if app_config.sessions_revoked_at is not None:
        issued_at_raw = payload.get("iat")
        issued_at = datetime.fromtimestamp(issued_at_raw, tz=timezone.utc) if issued_at_raw is not None else None
        if issued_at is None or issued_at < app_config.sessions_revoked_at:
            raise UnauthorizedError("Сессия принудительно завершена — войдите заново")

    return user


@dataclass
class AccessContext:
    """Вычисленный уровень доступа пользователя на основе его Discord-ролей."""

    user: User
    is_admin: bool
    # password login, separate from real discord-based is_admin
    is_password_login: bool
    # true only for founder_role_id/founder_user_discord_ids/password-login — the
    # subset of is_admin that keeps promotion-approval rights (see
    # can_decide_promotion); a plain admin_role_id/admin_user_discord_ids admin is
    # is_admin=True but is_founder=False
    is_founder: bool = False
    # unaffected by view-as simulation, so frontend can offer exit
    is_real_admin: bool = False
    # computed once, before entering any view-as branch below
    can_use_view_as: bool = False
    is_high_command: bool = False
    # can grant/revoke specializations, unrelated to command roles
    is_instructor: bool = False
    # discipline instructor roles (MED/PIL/ENG | INS) — какие дисциплины
    # (Specialization.category из DISCIPLINE_CATEGORIES) разрешено выдавать этому
    # инструктору; is_universal_instructor (роль вроде "ARC | INS") — выдаёт всё,
    # включая обычные (не-дисциплинарные) категории специализаций
    instructor_disciplines: set[str] = field(default_factory=set)
    is_universal_instructor: bool = False
    # Иерархия внутри дисциплины (см. INSTRUCTOR_TIERS) — заместитель/куратор
    # ветки получают права сверх обычного инструктора (см. is_discipline_deputy/
    # _curator ниже). Множества дисциплин, не одно значение — человек теоретически
    # может быть DEP в одной ветке и просто INS в другой.
    deputy_disciplines: set[str] = field(default_factory=set)
    curator_disciplines: set[str] = field(default_factory=set)
    # Дисциплины, где у САМОГО пользователя есть хотя бы одна специализация
    # (обучен на ветку) — не то же самое, что instructor_disciplines (тот
    # преподаёт ветку, необязательно ей обучен сам, хотя обычно совпадает).
    # Для доступа к разделам Специализации (см. can_access_discipline)
    specialization_disciplines: set[str] = field(default_factory=set)
    # Отряды (в любых формированиях), где человек состоит — гейтит подачу
    # отрядных категорий рапорта (см. ReportCategory.required_squad_id)
    squad_ids: set[int] = field(default_factory=set)
    role_ids: set[str] = field(default_factory=set)
    commander_regiment_ids: set[int] = field(default_factory=set)
    # id формирования "17-й Передовой Полк" (единая точка входа для рекрутов, см.
    # app/crud/regiment.py::RECRUIT_REGIMENT_NAME) — None, если оно не настроено.
    # Используется, чтобы командиры/замы ЛЮБОГО формирования могли решать по
    # заявкам/повышениям бойцов этого полка, см. can_decide_promotion.
    recruit_regiment_id: int | None = None
    # subset of commander_regiment_ids where role is specifically "commander"
    # (deputy can't set report points)
    category_manager_regiment_ids: set[int] = field(default_factory=set)
    soldier_regiment_ids: set[int] = field(default_factory=set)
    # configured by admin, see app/api/module_access.py
    violation_writer_regiment_ids: set[int] = field(default_factory=set)
    violation_writer_role_ids: set[str] = field(default_factory=set)
    violation_viewer_regiment_ids: set[int] = field(default_factory=set)
    violation_viewer_role_ids: set[str] = field(default_factory=set)
    broadcast_role_ids: set[str] = field(default_factory=set)
    detention_report_role_ids: set[str] = field(default_factory=set)
    detention_report_user_discord_ids: set[str] = field(default_factory=set)
    training_viewer_role_ids: set[str] = field(default_factory=set)
    # extends can_appeal_report beyond commander/deputy/mentor
    report_appeal_regiment_ids: set[int] = field(default_factory=set)
    report_appeal_role_ids: set[str] = field(default_factory=set)
    # Отдельная привилегия "отклонить любой рапорт" — не завязана на командование
    # формированием, см. can_reject_any_report
    report_reject_role_ids: set[str] = field(default_factory=set)
    report_reject_user_discord_ids: set[str] = field(default_factory=set)
    # Ивентрум — независимая от INS/DEP/CU ролевая система, см.
    # app/models/app_settings.py::event_role_id/event_assistant_role_id/event_curator_role_id
    event_role_id: str | None = None
    event_assistant_role_id: str | None = None
    event_curator_role_id: str | None = None
    # None = password login open to anyone who knows the password
    password_login_owner_discord_id: str | None = None

    @property
    def is_event_assistant(self) -> bool:
        return bool(self.event_assistant_role_id and self.event_assistant_role_id in self.role_ids)

    @property
    def is_event_curator(self) -> bool:
        return bool(self.event_curator_role_id and self.event_curator_role_id in self.role_ids)

    @property
    def is_event_submitter(self) -> bool:
        """Роль Ивентолога, а также Ассистент/Куратор ивентологии и создатель
        (is_founder — включает и локального админа, см. его определение) — все
        они тоже могут подавать заявки, не только рядовой Ивентолог (см.
        решение пользователя)."""
        return bool(
            (self.event_role_id and self.event_role_id in self.role_ids)
            or self.is_event_assistant
            or self.is_event_curator
            or self.is_founder
        )

    @property
    def can_decide_event(self) -> bool:
        # админ — предохранительный клапан на случай проблем с ролями, как везде
        # в проекте; куратор и ассистент равноправны в решении по заявке
        return self.is_admin or self.is_event_assistant or self.is_event_curator

    @property
    def can_access_event_room(self) -> bool:
        return self.is_event_submitter or self.can_decide_event

    @property
    def can_escalate_password_login(self) -> bool:
        return not self.password_login_owner_discord_id or self.password_login_owner_discord_id == self.user.discord_id

    @property
    def has_access(self) -> bool:
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.commander_regiment_ids)
            or bool(self.soldier_regiment_ids)
        )

    @property
    def own_regiment_ids(self) -> set[int]:
        return self.commander_regiment_ids | self.soldier_regiment_ids

    @property
    def is_regiment_leadership(self) -> bool:
        """Командир/заместитель хотя бы одного формирования (любого) — фронт
        использует, чтобы показать Штаб-категории с open_to_regiment_leadership
        даже тем, кто не состоит в Штабе."""
        return self.is_admin or self.is_high_command or bool(self.commander_regiment_ids)

    def is_commander_of(self, regiment_id: int) -> bool:
        return self.is_admin or self.is_high_command or regiment_id in self.commander_regiment_ids

    def can_decide_promotion(self, regiment_id: int) -> bool:
        """Одобрить/отклонить заявку на повышение — у же не(!) обычному
        admin_role_id/admin_user_discord_ids администратору, а только создателю
        (is_founder), высшему командованию или командиру/заму формирования.
        Исключение — бойцы 17-го Передового Полка (см. решение пользователя):
        пока боец числится там, решать может командир/заместитель ЛЮБОГО
        формирования, не только 17-го — набор кураторов рекрутов не должен
        зависеть от того, кто именно командует самим 17-м полком."""
        return (
            self.is_founder
            or self.is_high_command
            or regiment_id in self.commander_regiment_ids
            or (
                self.recruit_regiment_id is not None
                and regiment_id == self.recruit_regiment_id
                and bool(self.commander_regiment_ids)
            )
        )

    def can_appeal_report(self, regiment_id: int) -> bool:
        return (
            self.is_commander_of(regiment_id)
            or bool(self.role_ids & self.report_appeal_role_ids)
            or regiment_id in self.report_appeal_regiment_ids
        )

    @property
    def can_reject_any_report(self) -> bool:
        """Отдельная привилегия поверх обычного командования формированием —
        настраивается ролью и/или конкретными людьми (см. app/api/module_access.py),
        не связана с тем, кто формально командует формированием рапорта."""
        return bool(self.role_ids & self.report_reject_role_ids) or self.user.discord_id in (
            self.report_reject_user_discord_ids
        )

    def is_full_commander_of(self, regiment_id: int) -> bool:
        return self.is_admin or self.is_high_command or regiment_id in self.category_manager_regiment_ids

    def can_manage_categories(self, regiment_id: int | None = None) -> bool:
        # regiment_id accepted only for call-site compat, unused
        return self.is_admin or self.is_high_command

    def can_reprimand(self, regiment_id: int, *, target_is_commander: bool = False) -> bool:
        if self.is_admin or self.is_high_command:
            return True
        if target_is_commander:
            return False
        return regiment_id in self.commander_regiment_ids

    @property
    def can_write_violations(self) -> bool:
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.own_regiment_ids & self.violation_writer_regiment_ids)
            or bool(self.role_ids & self.violation_writer_role_ids)
        )

    @property
    def can_view_violations(self) -> bool:
        return self.has_access

    @property
    def is_full_violation_viewer(self) -> bool:
        # True = sees all violations, False = own regiments only
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.own_regiment_ids & self.violation_viewer_regiment_ids)
            or bool(self.role_ids & self.violation_viewer_role_ids)
        )

    @property
    def can_send_broadcast(self) -> bool:
        return self.is_admin or self.is_high_command or bool(self.role_ids & self.broadcast_role_ids)

    @property
    def can_grant_specializations(self) -> bool:
        """Общий доступ в Инструкторскую/к выдаче — КАКИЕ именно специализации
        можно выдать конкретному инструктору, решает can_grant_specialization
        (ниже), у которого есть доступ к самой специализации."""
        return self.is_admin or self.is_instructor

    def can_grant_specialization(self, specialization) -> bool:
        """Дисциплинарные категории (медик/пилот/инженер) выдаёт только
        инструктор соответствующей дисциплины или универсальный (can_teach_all,
        напр. роль "ARC | INS"); обычные категории — любой инструктор, как раньше."""
        if self.is_admin or self.is_universal_instructor:
            return True
        if not self.is_instructor:
            return False
        if specialization.category in self.instructor_disciplines:
            return True
        # не дисциплинарная категория (class/gear/specialization/...) — доступна
        # любому инструктору, дисциплины на неё не распространяются
        from app.models.specialization import DISCIPLINE_CATEGORIES

        return specialization.category not in DISCIPLINE_CATEGORIES

    def is_discipline_deputy(self, discipline: str) -> bool:
        """DEP+ по конкретной ветке (медик/пилот/инженер) — расширенные права
        поверх обычного инструктора: каталог своей ветки, категории рапортов
        дисциплины, запрет на обучение (см. вызовы ниже по коду)."""
        return self.is_admin or discipline in self.deputy_disciplines or discipline in self.curator_disciplines

    def is_discipline_curator(self, discipline: str) -> bool:
        """CU по конкретной ветке — единственный на весь сервер (по договорённости
        внутри команды, не enforced в БД), сверх DEP получает кросс-формационный
        обзор своей ветки и правку самой лестницы специализаций."""
        return self.is_admin or discipline in self.curator_disciplines

    def can_access_discipline(self, discipline: str) -> bool:
        """Доступ к разделу Специализации (Медицина/Инженерия) — обучен на ветку
        сам, либо инструктор/DEP/CU этой ветки (см. решение пользователя: они
        считаются обученными изначально, даже если сами специализацию не
        получали)."""
        return (
            self.is_admin
            or discipline in self.specialization_disciplines
            or discipline in self.instructor_disciplines
            or discipline in self.deputy_disciplines
            or discipline in self.curator_disciplines
        )

    @property
    def can_view_trainings(self) -> bool:
        return (
            self.is_admin
            or self.is_high_command
            or self.can_grant_specializations
            or bool(self.role_ids & self.training_viewer_role_ids)
        )

    @property
    def can_file_detention_report(self) -> bool:
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.role_ids & self.detention_report_role_ids)
            or self.user.discord_id in self.detention_report_user_discord_ids
        )


VIEW_AS_ROLES = {"soldier", "deputy", "commander", "mentor", "high_command"}
# mixed into view-as role via X-View-As-Extra, see _apply_view_as_extras
VIEW_AS_EXTRAS = {
    "instructor",
    "violation_writer",
    "violation_viewer",
    "broadcast",
    "detention_report",
    "training_viewer",
    "report_appeal",
}
# synthetic marker role so set-intersection checks pass without faking real discord ids
_VIEW_AS_MARKER_ROLE = "__view_as__"


async def _compute_permission_fields(db: AsyncSession, user: User, app_config) -> dict:
    # shared by normal login and "view as real person" (see get_access_context)
    role_ids = set(user.roles)

    is_founder = bool(
        user.discord_id == PASSWORD_LOGIN_DISCORD_ID
        or (app_config.founder_role_id and app_config.founder_role_id in role_ids)
        or user.discord_id in (app_config.founder_user_discord_ids or [])
    )
    is_admin = bool(
        is_founder
        or (app_config.admin_role_id in role_ids)
        or user.discord_id in (app_config.admin_user_discord_ids or [])
    )
    is_high_command = bool(app_config.high_command_role_id) and app_config.high_command_role_id in role_ids

    matched_instructor_roles = [
        r for r in await specialization_crud.list_instructor_roles(db) if r.discord_role_id in role_ids
    ]
    is_instructor = bool(matched_instructor_roles)
    is_universal_instructor = any(r.can_teach_all for r in matched_instructor_roles)
    instructor_disciplines = {r.discipline for r in matched_instructor_roles if r.discipline}
    deputy_disciplines = {
        r.discipline for r in matched_instructor_roles if r.discipline and r.tier in ("deputy", "curator")
    }
    curator_disciplines = {r.discipline for r in matched_instructor_roles if r.discipline and r.tier == "curator"}

    own_specialization_grants = await specialization_crud.list_for_user(db, user_id=user.id)
    specialization_disciplines = {
        g.specialization.category
        for g in own_specialization_grants
        if g.specialization.category in DISCIPLINE_CATEGORIES
    }
    squad_ids = set(await squad_crud.list_squad_ids_for_discord_id(db, discord_id=user.discord_id))

    # explicit per-regiment assignment, so having a generic commander/deputy role
    # doesn't grant command in every regiment the user's roles touch
    assignments_by_regiment: dict[int, str] = {
        rc.regiment_id: rc.role_type
        for rc in await regiment_commander_crud.get_all(db)
        if rc.discord_id == user.discord_id
    }

    commander_regiment_ids: set[int] = set()
    category_manager_regiment_ids: set[int] = set()
    soldier_regiment_ids: set[int] = set()
    recruit_regiment_id: int | None = None

    for regiment in await regiment_crud.get_all(db):
        if regiment.name == regiment_crud.RECRUIT_REGIMENT_NAME:
            recruit_regiment_id = regiment.id
        if regiment.discord_role_id not in role_ids:
            continue
        soldier_regiment_ids.add(regiment.id)
        role_type = assignments_by_regiment.get(regiment.id)
        if role_type is not None:
            commander_regiment_ids.add(regiment.id)
            if role_type == "commander":
                category_manager_regiment_ids.add(regiment.id)

    # mentor: deputy-level access without needing the regiment's discord role
    for regiment_id, role_type in assignments_by_regiment.items():
        if role_type == "mentor" and regiment_id not in soldier_regiment_ids:
            soldier_regiment_ids.add(regiment_id)
            commander_regiment_ids.add(regiment_id)

    return {
        "is_admin": is_admin,
        "is_founder": is_founder,
        "is_high_command": is_high_command,
        "is_instructor": is_instructor,
        "instructor_disciplines": instructor_disciplines,
        "is_universal_instructor": is_universal_instructor,
        "deputy_disciplines": deputy_disciplines,
        "curator_disciplines": curator_disciplines,
        "specialization_disciplines": specialization_disciplines,
        "squad_ids": squad_ids,
        "role_ids": role_ids,
        "commander_regiment_ids": commander_regiment_ids,
        "category_manager_regiment_ids": category_manager_regiment_ids,
        "soldier_regiment_ids": soldier_regiment_ids,
        "recruit_regiment_id": recruit_regiment_id,
    }


def _build_access_context(
    user: User,
    fields: dict,
    app_config,
    *,
    is_real_admin: bool,
    can_use_view_as: bool,
    is_password_login: bool = False,
) -> AccessContext:
    return AccessContext(
        user=user,
        is_admin=fields["is_admin"],
        is_password_login=is_password_login,
        is_founder=fields["is_founder"],
        is_real_admin=is_real_admin,
        can_use_view_as=can_use_view_as,
        is_high_command=fields["is_high_command"],
        is_instructor=fields["is_instructor"],
        instructor_disciplines=fields["instructor_disciplines"],
        is_universal_instructor=fields["is_universal_instructor"],
        deputy_disciplines=fields["deputy_disciplines"],
        curator_disciplines=fields["curator_disciplines"],
        specialization_disciplines=fields["specialization_disciplines"],
        squad_ids=fields["squad_ids"],
        role_ids=fields["role_ids"],
        commander_regiment_ids=fields["commander_regiment_ids"],
        category_manager_regiment_ids=fields["category_manager_regiment_ids"],
        soldier_regiment_ids=fields["soldier_regiment_ids"],
        recruit_regiment_id=fields["recruit_regiment_id"],
        violation_writer_regiment_ids=set(app_config.violation_writer_regiment_ids),
        violation_writer_role_ids=set(app_config.violation_writer_role_ids),
        violation_viewer_regiment_ids=set(app_config.violation_viewer_regiment_ids),
        violation_viewer_role_ids=set(app_config.violation_viewer_role_ids),
        broadcast_role_ids=set(app_config.broadcast_role_ids),
        detention_report_role_ids=set(app_config.detention_report_role_ids),
        detention_report_user_discord_ids=set(app_config.detention_report_user_discord_ids),
        training_viewer_role_ids=set(app_config.training_viewer_role_ids),
        report_appeal_regiment_ids=set(app_config.report_appeal_regiment_ids),
        report_appeal_role_ids=set(app_config.report_appeal_role_ids),
        report_reject_role_ids=set(app_config.report_reject_role_ids),
        report_reject_user_discord_ids=set(app_config.report_reject_user_discord_ids),
        event_role_id=app_config.event_role_id,
        event_assistant_role_id=app_config.event_assistant_role_id,
        event_curator_role_id=app_config.event_curator_role_id,
        password_login_owner_discord_id=settings.password_login_owner_discord_id
        or app_config.password_login_authorized_discord_id,
    )


def build_view_as_context(user: User, *, role: str, regiment_id: int | None) -> AccessContext:
    # real restriction, not cosmetic - every endpoint sees this context.
    # role_ids/module perms intentionally not carried over from real account,
    # mix in via X-View-As-Extra (_apply_view_as_extras) instead
    context = AccessContext(
        user=user,
        is_admin=False,
        is_password_login=False,
        is_real_admin=True,
        can_use_view_as=True,
        is_high_command=(role == "high_command"),
    )
    if regiment_id is not None:
        if role in ("commander", "deputy", "mentor"):
            context.commander_regiment_ids = {regiment_id}
            if role == "commander":
                context.category_manager_regiment_ids = {regiment_id}
        if role in ("soldier", "mentor"):
            context.soldier_regiment_ids = {regiment_id}
    return context


def _apply_view_as_extras(context: AccessContext, extras: set[str], regiment_id: int | None) -> None:
    if "instructor" in extras:
        context.is_instructor = True
        # view-as для дебага UI — не сужаем по дисциплинам, иначе не увидишь форму
        # выдачи целиком
        context.is_universal_instructor = True
    if "broadcast" in extras:
        context.role_ids.add(_VIEW_AS_MARKER_ROLE)
        context.broadcast_role_ids.add(_VIEW_AS_MARKER_ROLE)
    if "detention_report" in extras:
        context.role_ids.add(_VIEW_AS_MARKER_ROLE)
        context.detention_report_role_ids.add(_VIEW_AS_MARKER_ROLE)
    if "training_viewer" in extras:
        context.role_ids.add(_VIEW_AS_MARKER_ROLE)
        context.training_viewer_role_ids.add(_VIEW_AS_MARKER_ROLE)
    if regiment_id is not None:
        if "violation_writer" in extras:
            context.violation_writer_regiment_ids.add(regiment_id)
        if "violation_viewer" in extras:
            context.violation_viewer_regiment_ids.add(regiment_id)
        if "report_appeal" in extras:
            context.report_appeal_regiment_ids.add(regiment_id)


async def get_access_context(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    view_as_role: str | None = Header(default=None, alias="X-View-As-Role"),
    view_as_regiment_id: int | None = Header(default=None, alias="X-View-As-Regiment-Id"),
    view_as_extra: str | None = Header(default=None, alias="X-View-As-Extra"),
    view_as_discord_id: str | None = Header(default=None, alias="X-View-As-Discord-Id"),
) -> AccessContext:
    is_password_login = user.discord_id == PASSWORD_LOGIN_DISCORD_ID
    app_config = await app_settings_crud.get(db)
    fields = await _compute_permission_fields(db, user, app_config)
    is_admin = fields["is_admin"]
    is_high_command = fields["is_high_command"]
    can_use_view_as = is_admin or is_high_command

    # view-as-person: real discord roles of target user, not an abstract role.
    # mutually exclusive with X-View-As-Role/Extra. audit still attributes to
    # the real admin, not the impersonated user
    if view_as_discord_id and can_use_view_as:
        target = await user_crud.get_by_discord_id(db, view_as_discord_id)
        if target is None:
            # раньше здесь молча проваливалось дальше и отдавало контекст РЕАЛЬНОГО
            # админа вместо ошибки — admin думал, что смотрит "глазами" другого
            # пользователя, а на деле видел свои же права
            raise NotFoundError("Пользователь с таким Discord ID не найден — он ни разу не логинился на сайте")
        target_fields = await _compute_permission_fields(db, target, app_config)
        return _build_access_context(
            user, target_fields, app_config, is_real_admin=True, can_use_view_as=True
        )

    # view-as-role: admin/high-command only, restricted access via build_view_as_context
    if view_as_role and view_as_role in VIEW_AS_ROLES and can_use_view_as:
        context = build_view_as_context(user, role=view_as_role, regiment_id=view_as_regiment_id)
        if view_as_extra:
            extras = {e.strip() for e in view_as_extra.split(",") if e.strip() in VIEW_AS_EXTRAS}
            _apply_view_as_extras(context, extras, view_as_regiment_id)
        return context

    return _build_access_context(
        user,
        fields,
        app_config,
        is_real_admin=is_admin,
        can_use_view_as=can_use_view_as,
        is_password_login=is_password_login,
    )
