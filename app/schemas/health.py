from pydantic import BaseModel


class SystemHealthRead(BaseModel):
    """Дашборд здоровья системы для администратора/основателя — числа "по факту",
    без похода по разделам: сколько действующих бойцов и сколько заявок висит
    дольше stale_days без решения."""

    active_users_count: int
    stale_days: int
    stuck_registrations: int
    stuck_transfers: int
    stuck_promotions: int
