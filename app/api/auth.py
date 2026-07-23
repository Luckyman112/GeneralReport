"""Авторизация: через Discord OAuth2 или по общему паролю (для тестирования без Discord)."""
import logging
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import discord_client
from app.core.constants import PASSWORD_LOGIN_DISCORD_ID
from app.core.security import create_access_token
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import UnauthorizedError
from app.schemas.auth import DiscordLoginRequest, PasswordLoginRequest, TokenResponse
from app.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


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

    jwt_token = create_access_token(user_id=user.id, discord_id=user.discord_id)
    return TokenResponse(access_token=jwt_token, user=UserRead.model_validate(user))


@router.post("/password", response_model=TokenResponse)
async def login_via_password(
    payload: PasswordLoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Вход по общему секретному паролю в обход Discord — даёт полный админский
    доступ (is_admin вычисляется по самому discord_id=PASSWORD_LOGIN_DISCORD_ID в
    app/api/deps.py, а не по ролям — так это не зависит от того, как настроен
    ADMIN_ROLE_ID). Нужен для тестирования функционала без реального Discord-аккаунта
    и для доступа к настройкам ролей."""
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
