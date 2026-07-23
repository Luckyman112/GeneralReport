from pydantic import BaseModel

from app.schemas.user import UserRead


class DiscordLoginRequest(BaseModel):
    code: str
    # Тот же redirect_uri, что фронт использовал при запросе кода у Discord
    redirect_uri: str


class PasswordLoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
