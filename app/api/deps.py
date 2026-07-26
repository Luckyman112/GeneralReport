"""Общие зависимости FastAPI: подключение к БД, текущий пользователь, уровень доступа."""
from dataclasses import dataclass, field

from fastapi import Depends, Header
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

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
    return user


@dataclass
class AccessContext:
    """Вычисленный уровень доступа пользователя на основе его Discord-ролей."""

    user: User
    is_admin: bool
    # Вход по общему паролю (не через Discord) — используется только для доступа
    # к странице настроек ролей, не смешивается с обычным is_admin
    is_password_login: bool
    # Настоящий статус администратора — не меняется в режиме "просмотр от лица"
    # (см. X-View-As-* заголовки и build_view_as_context ниже), нужен фронту, чтобы
    # показать переключатель просмотра и суметь выйти из симуляции
    is_real_admin: bool = False
    # Высшее командование — как командир/заместитель, но сразу для ВСЕХ формирований
    # (отдельная Discord-роль, не завязана на конкретное формирование)
    is_high_command: bool = False
    # ID всех Discord-ролей пользователя — для ролевых прав (нарушения, рассылка,
    # рапорт о задержании), которые не завязаны на формирование
    role_ids: set[str] = field(default_factory=set)
    # Формирования, где пользователь — командир или заместитель (видит все рапорты,
    # может одобрять/отклонять/удалять)
    commander_regiment_ids: set[int] = field(default_factory=set)
    # Из commander_regiment_ids — только те, где назначение именно "командир"
    # (влияет на баллы за рапорт — их не может ставить заместитель)
    category_manager_regiment_ids: set[int] = field(default_factory=set)
    # Формирования, где пользователь — боец (видит только свои рапорты)
    soldier_regiment_ids: set[int] = field(default_factory=set)
    # Формирования/роли, чьи участники могут заводить/просматривать записи о
    # нарушениях, рассылать объявления, видеть кнопку рапорта о задержании —
    # настраивается администратором, см. app/api/module_access.py
    violation_writer_regiment_ids: set[int] = field(default_factory=set)
    violation_writer_role_ids: set[str] = field(default_factory=set)
    violation_viewer_regiment_ids: set[int] = field(default_factory=set)
    violation_viewer_role_ids: set[str] = field(default_factory=set)
    broadcast_role_ids: set[str] = field(default_factory=set)
    detention_report_role_ids: set[str] = field(default_factory=set)
    detention_report_user_discord_ids: set[str] = field(default_factory=set)

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

    def is_full_commander_of(self, regiment_id: int) -> bool:
        """Полноправный командир (не заместитель) — либо высшее командование/админ —
        может выставлять баллы за рапорт."""
        return self.is_admin or self.is_high_command or regiment_id in self.category_manager_regiment_ids

    def can_manage_categories(self, regiment_id: int | None = None) -> bool:
        """Конструктор категорий/полей рапортов — только высшее командование и
        администратор. Обычным командирам и заместителям недоступен независимо от
        формирования (regiment_id принимается только для совместимости вызовов)."""
        return self.is_admin or self.is_high_command

    def can_reprimand(self, regiment_id: int, *, target_is_commander: bool = False) -> bool:
        """Выговор своим бойцам может выдать командир/заместитель этого формирования;
        выговор командиру/заместителю — только высшее командование или админ."""
        if self.is_admin or self.is_high_command:
            return True
        if target_is_commander:
            return False
        return regiment_id in self.commander_regiment_ids

    @property
    def can_write_violations(self) -> bool:
        """Может заводить записи о нарушениях — участник (боец или командир) одного
        из формирований-"писателей", либо обладатель одной из ролей-"писателей"."""
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.own_regiment_ids & self.violation_writer_regiment_ids)
            or bool(self.role_ids & self.violation_writer_role_ids)
        )

    @property
    def can_view_violations(self) -> bool:
        """Страницу "Нарушители" может открыть кто угодно с доступом хотя бы к
        одному формированию — что именно он там увидит (все, по своему формированию
        или только свои нарушения), определяет is_full_violation_viewer/
        commander_regiment_ids в app/api/violations.py::list_violations."""
        return self.has_access

    @property
    def is_full_violation_viewer(self) -> bool:
        """True — видно вообще все нарушения; False — только по своим формированиям
        (см. can_view_violations и app/api/violations.py::list_violations)."""
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
    def can_file_detention_report(self) -> bool:
        return (
            self.is_admin
            or self.is_high_command
            or bool(self.role_ids & self.detention_report_role_ids)
            or self.user.discord_id in self.detention_report_user_discord_ids
        )


VIEW_AS_ROLES = {"soldier", "deputy", "commander", "high_command"}


def build_view_as_context(user: User, *, role: str, regiment_id: int | None) -> AccessContext:
    """Симуляция доступа для реального админа/высшего командования: доступ
    урезается ДО указанной роли/формирования по-настоящему (это не косметика —
    все остальные эндпоинты видят именно этот AccessContext), чтобы честно
    показать, что видит и может человек с такими правами. role_ids/модульные
    ролевые доступы намеренно не переносятся из реального аккаунта."""
    context = AccessContext(
        user=user,
        is_admin=False,
        is_password_login=False,
        is_real_admin=True,
        is_high_command=(role == "high_command"),
    )
    if regiment_id is not None:
        if role in ("commander", "deputy"):
            context.commander_regiment_ids = {regiment_id}
            if role == "commander":
                context.category_manager_regiment_ids = {regiment_id}
        elif role == "soldier":
            context.soldier_regiment_ids = {regiment_id}
    return context


async def get_access_context(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    view_as_role: str | None = Header(default=None, alias="X-View-As-Role"),
    view_as_regiment_id: int | None = Header(default=None, alias="X-View-As-Regiment-Id"),
) -> AccessContext:
    is_password_login = user.discord_id == PASSWORD_LOGIN_DISCORD_ID
    role_ids = set(user.roles)

    app_config = await app_settings_crud.get(db)
    is_admin = (
        is_password_login
        or (app_config.admin_role_id in role_ids)
        or user.discord_id in (app_config.admin_user_discord_ids or [])
    )
    is_high_command = bool(app_config.high_command_role_id) and app_config.high_command_role_id in role_ids
    has_commander_role = app_config.commander_role_id in role_ids or app_config.deputy_role_id in role_ids

    # Явные назначения "этот discord_id командует этим конкретным формированием" —
    # нужны, чтобы у человека с ролями сразу нескольких формирований (плюс общая роль
    # "Командир"/"Заместитель") не появлялись командирские права сразу во всех них.
    assignments_by_regiment: dict[int, str] = {}
    if has_commander_role:
        assignments_by_regiment = {
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

    # "Просмотр от лица" — только реальный админ/высшее командование может себя
    # так урезать, и только видит ЧЕСТНО урезанный доступ (см. build_view_as_context)
    if view_as_role and view_as_role in VIEW_AS_ROLES and (is_admin or is_high_command):
        return build_view_as_context(user, role=view_as_role, regiment_id=view_as_regiment_id)

    return AccessContext(
        user=user,
        is_admin=is_admin,
        is_password_login=is_password_login,
        is_real_admin=is_admin,
        is_high_command=is_high_command,
        role_ids=role_ids,
        commander_regiment_ids=commander_regiment_ids,
        category_manager_regiment_ids=category_manager_regiment_ids,
        soldier_regiment_ids=soldier_regiment_ids,
        violation_writer_regiment_ids=set(app_config.violation_writer_regiment_ids),
        violation_writer_role_ids=set(app_config.violation_writer_role_ids),
        violation_viewer_regiment_ids=set(app_config.violation_viewer_regiment_ids),
        violation_viewer_role_ids=set(app_config.violation_viewer_role_ids),
        broadcast_role_ids=set(app_config.broadcast_role_ids),
        detention_report_role_ids=set(app_config.detention_report_role_ids),
        detention_report_user_discord_ids=set(app_config.detention_report_user_discord_ids),
    )
