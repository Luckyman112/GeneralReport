from pydantic import BaseModel, ConfigDict, field_validator


class SquadMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    discord_id: str
    username: str
    tier: int


class SquadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    name: str
    tier_labels: list[str]
    members: list[SquadMemberRead] = []


class SquadCreate(BaseModel):
    name: str


class SquadTierLabelsUpdate(BaseModel):
    tier_labels: list[str]

    @field_validator("tier_labels")
    @classmethod
    def _check_length(cls, v: list[str]) -> list[str]:
        if len(v) != 4:
            raise ValueError("Нужно ровно 4 подписи (боец/старший/заместитель/командир)")
        return v


class SquadMemberCreate(BaseModel):
    discord_id: str
    username: str
    tier: int = 0


class SquadMemberTierUpdate(BaseModel):
    tier: int
