"""Application configuration and filesystem paths.

Settings are read once at start-up and cached. Every value can be overridden with a
``SHIRUBE_*`` environment variable, which is how tests redirect the data directory and
how a user can change the port or bind address without editing code.
"""

from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_dir
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "shirube"


class Settings(BaseSettings):
    """Runtime settings for the local shirube server.

    Values are sourced, in order of precedence, from ``SHIRUBE_*`` environment
    variables, a local ``.env`` file, then the defaults below.

    Attributes:
        host: Interface the server binds to. Defaults to loopback so the server is
            never exposed on the network — shirube is a single-user local tool, which
            is what lets the MVP skip authentication entirely.
        port: TCP port to listen on (see the note on the default value below).
        open_browser: Whether to open the browser automatically on start-up. Disabled
            in tests and when running headless.
        data_dir: Directory for shirube's own state (the SQLite database). Defaults to
            the platform's per-user data directory via ``platformdirs``.
    """

    model_config = SettingsConfigDict(env_prefix="SHIRUBE_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    # 7472 = "shrb" (the consonants of shirube) on a phone keypad — s7 h4 r7 b2 — and
    # steers clear of the common dev ports (3000, 5173, 8000, 8080, 5432, ...).
    port: int = 7472
    open_browser: bool = True
    data_dir: Path = Field(default_factory=lambda: Path(user_data_dir(APP_NAME)))

    @property
    def database_path(self) -> Path:
        """Absolute path to the app-state SQLite file inside ``data_dir``."""
        return self.data_dir / "shirube.db"

    @property
    def database_url(self) -> str:
        """SQLAlchemy connection URL for the app-state database."""
        return f"sqlite:///{self.database_path}"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide :class:`Settings`, constructed once and cached.

    Caching keeps configuration cheap and consistent across the app. Tests clear this
    cache (``get_settings.cache_clear()``) after pointing ``SHIRUBE_DATA_DIR`` at a
    temporary directory, so each test runs against a throwaway database.

    Returns:
        The cached settings instance.
    """
    return Settings()
