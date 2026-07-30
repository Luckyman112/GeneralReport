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
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import UnauthorizedError
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
    # unaffected by view-as simulation, so frontend can offer exit
    is_real_admin: bool = False
    # computed once, before entering any view-as branch below
    can_use_view_as: bool = False
    is_high_command: bool = False
    # can grant/revoke specializations, unrelated to command roles
    is_instructor: bool = False
    role_ids: set[str] = field(default_factory=set)
    commander_regiment_ids: set[int] = field(default_factory=set)
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
    # None = password login open to anyone who knows the password
    password_login_owner_discord_id: str | None = None

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

    def is_commander_of(self, regiment_id: int) -> bool:
        return self.is_admin or self.is_high_command or regiment_id in self.commander_regiment_ids

    def can_appeal_report(self, regiment_id: int) -> bool:
        return (
            self.is_commander_of(regiment_id)
            or bool(self.role_ids & self.report_appeal_role_ids)
            or regiment_id in self.report_appeal_regiment_ids
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
        return self.is_admin or self.is_instructor

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

    is_admin = bool(
        user.discord_id == PASSWORD_LOGIN_DISCORD_ID
        or (app_config.admin_role_id in role_ids)
        or user.discord_id in (app_config.admin_user_discord_ids or [])
        or (app_config.founder_role_id and app_config.founder_role_id in role_ids)
    )
    is_high_command = bool(app_config.high_command_role_id) and app_config.high_command_role_id in role_ids
    is_instructor = bool(app_config.instructor_role_id) and app_config.instructor_role_id in role_ids

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

    for regiment in await regiment_crud.get_all(db):
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
        "is_high_command": is_high_command,
        "is_instructor": is_instructor,
        "role_ids": role_ids,
        "commander_regiment_ids": commander_regiment_ids,
        "category_manager_regiment_ids": category_manager_regiment_ids,
        "soldier_regiment_ids": soldier_regiment_ids,
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
        is_real_admin=is_real_admin,
        can_use_view_as=can_use_view_as,
        is_high_command=fields["is_high_command"],
        is_instructor=fields["is_instructor"],
        role_ids=fields["role_ids"],
        commander_regiment_ids=fields["commander_regiment_ids"],
        category_manager_regiment_ids=fields["category_manager_regiment_ids"],
        soldier_regiment_ids=fields["soldier_regiment_ids"],
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
        if target is not None:
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
