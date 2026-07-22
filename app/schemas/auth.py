from pydantic import BaseModel

from app.schemas.user import UserRead


class DiscordLoginRequest(BaseModel):
    code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
