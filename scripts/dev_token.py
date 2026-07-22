"""Dev-утилита: создаёт/обновляет тестового пользователя в БД и печатает его JWT.

Не вызывает Discord вообще — нужен, чтобы тестировать API через /docs без реального
OAuth-логина. Роли передаются как обычные строки-ID, их не обязательно делать похожими
на настоящие Discord snowflake, если вы сравниваете их с ADMIN_ROLE_ID/COMMANDER_ROLE_ID/
regiments.discord_role_id, которые сами придумали для теста.

Запускать из корня проекта как модуль (иначе не найдётся пакет app):
    python -m scripts.dev_token <discord_id> <username> [role_id ...]

Пример (пользователь с ролью формирования "role_501" и общей ролью командира):
    python -m scripts.dev_token 111 soldier role_501
    python -m scripts.dev_token 222 commander role_501 test_commander_role
    python -m scripts.dev_token 999 admin 1399456648044609657   # ваш реальный ADMIN_ROLE_ID
"""
import asyncio
import sys

from app.core.security import create_access_token
from app.crud import user as user_crud
from app.database import async_session_maker


async def main(discord_id: str, username: str, roles: list[str]) -> None:
    async with async_session_maker() as db:
        user = await user_crud.upsert_user(
            db, discord_id=discord_id, username=username, avatar_url=None, roles=roles
        )
    token = create_access_token(user_id=user.id, discord_id=user.discord_id)
    print(f"user_id={user.id} roles={roles}")
    print(token)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)

    asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3:]))
