"""Configuration for the standalone legacy Gmail campaign worker."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(alias="SUPABASE_SERVICE_ROLE_KEY")
    gmail_credentials_file: Path = Field(
        default=Path("./credentials.json"), alias="GMAIL_CREDENTIALS_FILE"
    )
    gmail_token_file: Path = Field(default=Path("./token.json"), alias="GMAIL_TOKEN_FILE")
    min_delay_seconds: float = Field(default=45, alias="MIN_DELAY_SECONDS", ge=0)
    max_delay_seconds: float = Field(default=120, alias="MAX_DELAY_SECONDS", ge=0)
    daily_send_limit: int = Field(default=100, alias="DAILY_SEND_LIMIT", gt=0)
    enable_legacy_csv_worker: bool = Field(default=True, alias="ENABLE_LEGACY_CSV_WORKER")

    @model_validator(mode="after")
    def validate_delay_range(self) -> "Settings":
        if self.min_delay_seconds > self.max_delay_seconds:
            raise ValueError("MIN_DELAY_SECONDS cannot exceed MAX_DELAY_SECONDS")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
