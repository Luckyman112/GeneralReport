from pydantic import BaseModel, ConfigDict


class RegimentRead(BaseModel):
    """Информация о формировании — видна всем авторизованным пользователям.
    Discord-роль формирования не секретна (видна всем в самом Discord), поэтому
    отдельной "админской" схемы не нужно."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    discord_role_id: str


class RegimentCreate(BaseModel):
    name: str
    discord_role_id: str


class RegimentUpdate(BaseModel):
    """Частичное обновление формирования: переименование и/или смена роли."""

    name: str | None = None
    discord_role_id: str | None = None


class DiscordRoleOption(BaseModel):
    id: str
    name: str
