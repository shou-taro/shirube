"""Application configuration and filesystem paths."""

from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_dir
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "shirube"


class Settings(BaseSettings):
    """Runtime settings, overridable via ``SHIRUBE_*`` environment variables."""

    model_config = SettingsConfigDict(env_prefix="SHIRUBE_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8765
    open_browser: bool = True
    data_dir: Path = Field(default_factory=lambda: Path(user_data_dir(APP_NAME)))

    @property
    def database_path(self) -> Path:
        return self.data_dir / "shirube.db"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
