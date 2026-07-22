"""Взаимодействие с Discord API: обмен OAuth2-кода, профиль пользователя, роли в гильдии.

Используются обычные REST-запросы через httpx (без discord.py) — это не требует
постоянного gateway-подключения бота и хорошо ложится на модель запрос/ответ FastAPI.
"""
import logging

import httpx

from app.config import settings
from app.exceptions import DiscordAPIError

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"


async def exchange_code_for_token(code: str) -> str:
    """Обменивает код авторизации Discord OAuth2 на access_token пользователя."""
    data = {
        "client_id": settings.discord_client_id,
        "client_secret": settings.discord_client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.discord_redirect_uri,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    async with httpx.AsyncClient() as client:
        response = await client.post(f"{DISCORD_API_BASE}/oauth2/token", data=data, headers=headers)

    if response.status_code != 200:
        logger.error("Discord OAuth token exchange failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось авторизоваться через Discord. Попробуйте войти заново.")

    return response.json()["access_token"]


async def fetch_discord_user(access_token: str) -> dict:
    """Получает профиль пользователя Discord (id, username, avatar) по его access_token."""
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{DISCORD_API_BASE}/users/@me", headers=headers)

    if response.status_code != 200:
        logger.error("Discord /users/@me failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось получить профиль пользователя Discord.")

    return response.json()


def build_avatar_url(discord_user: dict) -> str | None:
    avatar_hash = discord_user.get("avatar")
    if not avatar_hash:
        return None
    return f"https://cdn.discordapp.com/avatars/{discord_user['id']}/{avatar_hash}.png"


def _bot_headers() -> dict:
    return {"Authorization": f"Bot {settings.discord_bot_token}"}


async def fetch_member_roles(discord_user_id: str) -> list[str]:
    """Получает список ID ролей участника на единственном Discord-сервере через bot-токен."""
    url = f"{DISCORD_API_BASE}/guilds/{settings.discord_guild_id}/members/{discord_user_id}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=_bot_headers())

    if response.status_code == 404:
        # Пользователь авторизовался, но не состоит на сервере
        return []

    if response.status_code != 200:
        logger.error("Discord guild member lookup failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось получить роли участника на сервере Discord.")

    return response.json().get("roles", [])


async def fetch_guild_roles() -> list[dict]:
    """Получает список ролей единственного сервера (id, name) — для выбора роли
    формирования в веб-панели."""
    url = f"{DISCORD_API_BASE}/guilds/{settings.discord_guild_id}/roles"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=_bot_headers())

    if response.status_code != 200:
        logger.error("Discord guild roles lookup failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось получить список ролей сервера.")

    return [{"id": role["id"], "name": role["name"]} for role in response.json()]
