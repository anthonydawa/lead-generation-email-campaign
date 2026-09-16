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
    daily_new_recipient_limit: int = Field(
        default=100, alias="DAILY_NEW_RECIPIENT_LIMIT", gt=0
    )
    first_day_new_recipient_limit: int = Field(
        default=100, alias="FIRST_DAY_NEW_RECIPIENT_LIMIT", gt=0
    )
    send_window_start_hour_utc: int = Field(
        default=0, alias="SEND_WINDOW_START_HOUR_UTC", ge=0, le=23
    )
    send_window_end_hour_utc: int = Field(
        default=24, alias="SEND_WINDOW_END_HOUR_UTC", ge=1, le=24
    )
    send_weekdays_only: bool = Field(default=False, alias="SEND_WEEKDAYS_ONLY")
    enable_legacy_csv_worker: bool = Field(default=True, alias="ENABLE_LEGACY_CSV_WORKER")

    @model_validator(mode="after")
    def validate_delay_range(self) -> "Settings":
        if self.min_delay_seconds > self.max_delay_seconds:
            raise ValueError("MIN_DELAY_SECONDS cannot exceed MAX_DELAY_SECONDS")
        if self.send_window_start_hour_utc >= self.send_window_end_hour_utc:
            raise ValueError("SEND_WINDOW_START_HOUR_UTC must be before the end hour")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
