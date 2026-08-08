"""Взаимодействие с Discord API: обмен OAuth2-кода, профиль пользователя, роли в гильдии.

Используются обычные REST-запросы через httpx (без discord.py) — это не требует
постоянного gateway-подключения бота и хорошо ложится на модель запрос/ответ FastAPI.
"""
import json
import logging
import time

import httpx

from app.config import settings
from app.exceptions import DiscordAPIError

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"


async def exchange_code_for_token(code: str, redirect_uri: str) -> str:
    """Обменивает код авторизации Discord OAuth2 на access_token пользователя.

    redirect_uri должен точно совпадать с тем, что использовался при запросе кода
    (его присылает фронт, а не берём из настроек — так адрес фронта/бэкенда может
    меняться без пересборки, лишь бы совпадал с зарегистрированным в Discord Developer
    Portal)."""
    data = {
        "client_id": settings.discord_client_id,
        "client_secret": settings.discord_client_secret,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
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


def _member_avatar_url(member: dict) -> str | None:
    user = member.get("user", {})
    avatar_hash = user.get("avatar")
    if not avatar_hash:
        return None
    return f"https://cdn.discordapp.com/avatars/{user['id']}/{avatar_hash}.png"


_MEMBERS_CACHE_TTL_SECONDS = 30
_members_cache: list[dict] | None = None
_members_cache_at: float = 0.0


async def fetch_guild_members() -> list[dict]:
    """Получает всех участников единственного сервера постранично (нужна включённая
    Server Members Intent). Возвращает {discord_id, username, roles, avatar_url}.

    Результат кэшируется на короткое время — состав сервера не меняется
    ежесекундно, а эта функция дёргается почти на каждое действие с составом
    (список кандидатов, профиль участника и т.д.), каждый раз постранично обходя
    Discord API заново."""
    global _members_cache, _members_cache_at
    now = time.monotonic()
    if _members_cache is not None and (now - _members_cache_at) < _MEMBERS_CACHE_TTL_SECONDS:
        return _members_cache

    members = await _fetch_guild_members_uncached()
    _members_cache = members
    _members_cache_at = now
    return members


async def _fetch_guild_members_uncached() -> list[dict]:
    members: list[dict] = []
    after = "0"

    async with httpx.AsyncClient() as client:
        while True:
            url = f"{DISCORD_API_BASE}/guilds/{settings.discord_guild_id}/members"
            response = await client.get(
                url, headers=_bot_headers(), params={"limit": 1000, "after": after}
            )
            if response.status_code != 200:
                logger.error("Discord guild members lookup failed: %s %s", response.status_code, response.text)
                raise DiscordAPIError("Не удалось получить список участников сервера.")

            page = response.json()
            if not page:
                break

            for member in page:
                user = member.get("user", {})
                members.append(
                    {
                        "discord_id": user["id"],
                        "username": member.get("nick") or user.get("username", "unknown"),
                        "roles": member.get("roles", []),
                        "avatar_url": _member_avatar_url(member),
                    }
                )

            if len(page) < 1000:
                break
            after = page[-1]["user"]["id"]

    return members


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


# Обычные текстовые (0) и каналы объявлений/News (5) — второй тип изначально
# не учитывался, из-за чего канал "объявления" (обычно именно Announcement,
# не обычный текстовый) не попадал в список выбора в Настройках, хотя бот
# умеет слать в него сообщения так же, как в обычный текстовый (см. решение
# пользователя — бот "не видел" такой канал)
_TEXT_CHANNEL_TYPE = 0
_ANNOUNCEMENT_CHANNEL_TYPE = 5


async def fetch_guild_text_channels() -> list[dict]:
    """Текстовые каналы единственного сервера (id, name) — для выбора канала
    уведомлений об ивентах в Настройках."""
    url = f"{DISCORD_API_BASE}/guilds/{settings.discord_guild_id}/channels"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=_bot_headers())

    if response.status_code != 200:
        logger.error("Discord guild channels lookup failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось получить список каналов сервера.")

    return [
        {"id": ch["id"], "name": ch["name"]}
        for ch in response.json()
        if ch.get("type") in (_TEXT_CHANNEL_TYPE, _ANNOUNCEMENT_CHANNEL_TYPE)
    ]


async def send_channel_message(channel_id: str, content: str | None = None, *, embed: dict | None = None) -> None:
    """Отправляет сообщение от имени бота в канал (Bot API, не webhook — см.
    решение пользователя: уведомление должно выглядеть как сообщение бота).
    embed — карточка операции (см. app/api/event_room.py); интерактивные кнопки
    "Записаться"/"Не смогу" сознательно не реализованы в этой итерации (см.
    решение пользователя — сначала простое сообщение)."""
    url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
    body: dict = {}
    if content:
        body["content"] = content
    if embed:
        body["embeds"] = [embed]

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=_bot_headers(), json=body)

    if response.status_code not in (200, 201):
        logger.error("Discord send channel message failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось отправить сообщение в Discord-канал.")


async def send_channel_message_with_file(
    channel_id: str, *, embed: dict | None, file_bytes: bytes, filename: str, content: str | None = None
) -> str:
    """Как send_channel_message, но с приложенным файлом (карточка-досье
    операции, см. app/core/event_card.py) — Discord Bot API требует
    multipart/form-data, а не JSON, когда есть вложение. Возвращает id
    отправленного сообщения — при дозаполнении заявки после одобрения им
    редактируют это же сообщение (см. edit_channel_message). content — текст
    сообщения (используется для пинга роли — упоминания ролей работают только
    в content, не в embed)."""
    url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages"
    payload: dict = {"attachments": [{"id": 0, "filename": filename}]}
    if content:
        payload["content"] = content
    if embed:
        embed = {**embed, "image": {"url": f"attachment://{filename}"}}
        payload["embeds"] = [embed]

    files = {"files[0]": (filename, file_bytes, "image/png")}
    data = {"payload_json": json.dumps(payload)}

    async with httpx.AsyncClient() as client:
        response = await client.post(url, headers=_bot_headers(), data=data, files=files)

    if response.status_code not in (200, 201):
        logger.error("Discord send channel message (with file) failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось отправить сообщение в Discord-канал.")

    return response.json()["id"]


async def edit_channel_message(
    channel_id: str,
    message_id: str,
    *,
    embed: dict | None,
    file_bytes: bytes,
    filename: str,
    content: str | None = None,
) -> None:
    """Редактирует уже отправленное ботом сообщение вместе с вложением — для
    дозаполнения одобренной заявки в Ивентруме (см. решение пользователя:
    правится то же сообщение, а не отправляется новое)."""
    url = f"{DISCORD_API_BASE}/channels/{channel_id}/messages/{message_id}"
    payload: dict = {"attachments": [{"id": 0, "filename": filename}]}
    if content:
        payload["content"] = content
    if embed:
        embed = {**embed, "image": {"url": f"attachment://{filename}"}}
        payload["embeds"] = [embed]

    files = {"files[0]": (filename, file_bytes, "image/png")}
    data = {"payload_json": json.dumps(payload)}

    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=_bot_headers(), data=data, files=files)

    if response.status_code not in (200, 201):
        logger.error("Discord edit channel message failed: %s %s", response.status_code, response.text)
        raise DiscordAPIError("Не удалось отредактировать сообщение в Discord-канале.")
