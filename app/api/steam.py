"""Подтверждение Steam-аккаунта через OpenID — заменяет ручной ввод Steam ID
при регистрации (см. app/core/steam_client.py). /login-url требует активную
сессию (Discord-логин уже пройден), /callback — публичный редирект от Steam."""
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import steam_client
from app.core.security import create_steam_link_token, decode_steam_link_token
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import UnauthorizedError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/steam", tags=["steam"])


def _callback_url(request: Request) -> str:
    return f"{str(request.base_url).rstrip('/')}/api/steam/callback"


@router.get("/login-url")
async def get_steam_login_url(
    request: Request, access: AccessContext = Depends(get_access_context)
) -> dict:
    state = create_steam_link_token(access.user.id)
    return_to = f"{_callback_url(request)}?state={state}"
    realm = str(request.base_url).rstrip("/") + "/"
    return {"url": steam_client.build_login_url(return_to, realm)}


@router.get("/callback")
async def steam_callback(request: Request, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    frontend_root = str(request.base_url).rstrip("/")
    params = dict(request.query_params)
    state = params.pop("state", None)

    if not state:
        return RedirectResponse(f"{frontend_root}/#/main?steam=error")

    try:
        user_id = decode_steam_link_token(state)
    except UnauthorizedError:
        return RedirectResponse(f"{frontend_root}/#/main?steam=error")

    steam_id64 = await steam_client.verify_callback(params)
    if steam_id64 is None:
        return RedirectResponse(f"{frontend_root}/#/main?steam=error")

    existing = await user_crud.get_by_steam_id(db, steam_id64)
    if existing is not None and existing.id != user_id:
        logger.warning("Steam-аккаунт %s уже привязан к другому бойцу (id=%s)", steam_id64, existing.id)
        return RedirectResponse(f"{frontend_root}/#/main?steam=duplicate")

    user = await user_crud.set_verified_steam_id(db, user_id=user_id, steam_id=steam_id64)
    if user is None:
        return RedirectResponse(f"{frontend_root}/#/main?steam=error")

    logger.info("Пользователь id=%s подтвердил Steam-аккаунт %s", user_id, steam_id64)
    return RedirectResponse(f"{frontend_root}/#/main?steam=linked")
