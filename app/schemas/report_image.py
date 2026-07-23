from pydantic import BaseModel, ConfigDict


class ReportImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
