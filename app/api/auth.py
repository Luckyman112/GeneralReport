"""Авторизация: через Discord OAuth2 или по общему паролю (для тестирования без Discord)."""
import logging
import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import discord_client
from app.core.constants import PASSWORD_LOGIN_DISCORD_ID
from app.core.security import create_access_token, decode_access_token
from app.crud import app_settings as app_settings_crud
from app.crud import notification as notification_crud
from app.crud import promotion as promotion_crud
from app.crud import regiment as regiment_crud
from app.crud import transfer_request as transfer_request_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import TooManyRequestsError, UnauthorizedError
from app.schemas.auth import DiscordLoginRequest, PasswordLoginRequest, TokenResponse
from app.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Простой in-memory rate-limit на подбор пароля: не переживает перезапуск процесса
# и не шарится между несколькими воркерами — этого достаточно для масштаба этого
# самохостящегося приложения, без новой зависимости (redis/slowapi).
_PASSWORD_ATTEMPTS_WINDOW_SECONDS = 300
_PASSWORD_ATTEMPTS_MAX = 5
_password_attempts: dict[str, list[float]] = defaultdict(list)


def _check_password_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    attempts = _password_attempts[client_ip]
    attempts[:] = [t for t in attempts if now - t < _PASSWORD_ATTEMPTS_WINDOW_SECONDS]
    if len(attempts) >= _PASSWORD_ATTEMPTS_MAX:
        raise TooManyRequestsError("Слишком много попыток входа. Попробуйте снова через несколько минут.")
    attempts.append(now)


@router.post("/discord", response_model=TokenResponse)
async def login_via_discord(
    payload: DiscordLoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Принимает code от Discord OAuth2, авторизует пользователя и выдаёт JWT-токен сессии."""
    access_token = await discord_client.exchange_code_for_token(payload.code, payload.redirect_uri)
    discord_user = await discord_client.fetch_discord_user(access_token)
    roles = await discord_client.fetch_member_roles(discord_user["id"])

    user = await user_crud.upsert_user(
        db,
        discord_id=discord_user["id"],
        username=discord_user.get("username", "unknown"),
        avatar_url=discord_client.build_avatar_url(discord_user),
        roles=roles,
    )

    logger.info("Пользователь %s (%s) авторизовался, роли: %s", user.username, user.discord_id, roles)

    user = await _finalize_transfer_if_ready(db, user)

    jwt_token = create_access_token(user_id=user.id, discord_id=user.discord_id)
    return TokenResponse(access_token=jwt_token, user=UserRead.model_validate(user))


async def _finalize_transfer_if_ready(db: AsyncSession, user):
    # unfreeze once discord role flips from source to target regiment
    request = await transfer_request_crud.get_active_for_user(db, user_id=user.id)
    if request is None or request.status != "approved":
        return user

    from_regiment = await regiment_crud.get_by_id(db, request.from_regiment_id)
    to_regiment = await regiment_crud.get_by_id(db, request.to_regiment_id)
    role_ids = set(user.roles)
    has_from = from_regiment is not None and from_regiment.discord_role_id in role_ids
    has_to = to_regiment is not None and to_regiment.discord_role_id in role_ids

    if has_to and not has_from:
        user = await user_crud.update_profile(
            db,
            discord_id=user.discord_id,
            fallback_username=user.username,
            changes={"rank_id": request.target_rank_id},
        )
        await transfer_request_crud.complete(db, request)
        # rank_id сменился в обход обычной заявки на повышение — та же зависшая
        # pending-заявка от старого формирования/звания, что и в
        # app/api/regiments.py::update_member_profile (баг-репорт)
        await promotion_crud.cancel_pending_for_user(
            db, user_id=user.id, reason="Перевод завершён"
        )
        await notification_crud.create_personal_notification(
            db,
            target_user_id=user.id,
            title="Перевод завершён",
            body=f"Вы переведены в формирование «{to_regiment.name}».",
            created_by=user.id,
        )
        logger.info("Перевод %s завершён для пользователя %s", request.id, user.discord_id)

    return user


@router.post("/password", response_model=TokenResponse)
async def login_via_password(
    payload: PasswordLoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    # password login = full admin bypass, rate-limited
    client_ip = request.client.host if request.client else "unknown"
    _check_password_rate_limit(client_ip)

    app_config = await app_settings_crud.get(db)
    # env value wins over db setting, so owner can't be locked out via panel
    authorized_discord_id = settings.password_login_owner_discord_id or app_config.password_login_authorized_discord_id
    if authorized_discord_id:
        auth_header = request.headers.get("authorization", "")
        scheme, _, token = auth_header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise UnauthorizedError("Сначала войдите через Discord под авторизованным аккаунтом")
        try:
            token_payload = decode_access_token(token)
            current_user = await user_crud.get_by_id(db, int(token_payload["sub"]))
        except Exception:
            current_user = None
        if current_user is None or current_user.discord_id != authorized_discord_id:
            raise UnauthorizedError("Вход по паролю разрешён только под авторизованным Discord-аккаунтом")

    if not secrets.compare_digest(payload.password, settings.admin_password):
        raise UnauthorizedError("Неверный пароль")

    user = await user_crud.upsert_user(
        db,
        discord_id=PASSWORD_LOGIN_DISCORD_ID,
        username="Локальный администратор",
        avatar_url=None,
        roles=[],
    )

    logger.info("Вход по паролю (пользователь id=%s)", user.id)

    jwt_token = create_access_token(user_id=user.id, discord_id=user.discord_id)
    return TokenResponse(access_token=jwt_token, user=UserRead.model_validate(user))
