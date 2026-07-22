"""Авторизация через Discord OAuth2."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import discord_client
from app.core.security import create_access_token
from app.crud import user as user_crud
from app.database import get_db
from app.schemas.auth import DiscordLoginRequest, TokenResponse
from app.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/discord", response_model=TokenResponse)
async def login_via_discord(
    payload: DiscordLoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Принимает code от Discord OAuth2, авторизует пользователя и выдаёт JWT-токен сессии."""
    access_token = await discord_client.exchange_code_for_token(payload.code)
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
