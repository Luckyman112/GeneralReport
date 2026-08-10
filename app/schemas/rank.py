from pydantic import BaseModel, ConfigDict


class RankRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tier_id: int
    code: str
    name: str
    order: int
    # Своё требование по дням выслуги для перехода на это конкретное звание — если
    # задано, перекрывает требование состава (RankTierRead.tenure_days_required)
    tenure_days_required: int | None = None
    # Джедайский ранг только: true исключает авто-переход СЮДА (сейчас только
    # Гранд-Мастер — только вручную, admin/high_command)
    jedi_manual_only: bool = False
    # Джедайский ранг только: id максимально допустимого звания при этом ранге
    max_jedi_title_rank_id: int | None = None


class RankTierRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    order: int
    tenure_days_required: int | None
    # None = no limit
    class_limit: int | None = None
    gear_limit: int | None = None
    specialization_limit: int | None = None
    additional_specialization_limit: int | None = None
    elite_specialization_limit: int | None = None
    medic_limit: int | None = None
    pilot_limit: int | None = None
    engineer_limit: int | None = None
    is_jedi: bool = False
    # true только на джедайском тире "ранга" (Падаван/Рыцарь/Мастер/Гранд-Мастер) —
    # отличает его от тиров "звания" (CO/SCO/.., is_jedi=true, этот флаг false)
    is_jedi_rank_track: bool = False
    ranks: list[RankRead]


class RankTierLimitsUpdate(BaseModel):
    class_limit: int | None = None
    gear_limit: int | None = None
    specialization_limit: int | None = None
    additional_specialization_limit: int | None = None
    elite_specialization_limit: int | None = None
    medic_limit: int | None = None
    pilot_limit: int | None = None
    engineer_limit: int | None = None
