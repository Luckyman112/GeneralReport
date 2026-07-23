"""Настройки приложения, читаются из переменных окружения (.env)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # PostgreSQL
    database_url: str

    # Discord OAuth2
    discord_client_id: str
    discord_client_secret: str

    # Discord Bot (для чтения ролей участников и управления формированиями)
    discord_bot_token: str
    # Единственный Discord-сервер, на котором стоит бот и живут все роли формирований
    discord_guild_id: str

    # Роль администратора (видит рапорты всех формирований)
    admin_role_id: str
    # Общая роль «Командир»: командир формирования = эта роль + явное назначение
    # командиром конкретного формирования (регулируется в веб-панели)
    commander_role_id: str

    # Секрет для входа по паролю (в обход Discord) — даёт полный админский доступ
    admin_password: str

    # JWT
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    # CORS: список origin'ов через запятую. При self-host фронта на том же адресе,
    # что и бэкенд, обычно не нужен (same-origin), но оставлен для гибкости.
    allowed_origins: str = ""

    log_level: str = "INFO"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
