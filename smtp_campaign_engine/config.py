"""Configuration for the direct SMTP-only campaign worker."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(alias="SUPABASE_SERVICE_ROLE_KEY")

    smtp_host: str = Field(alias="SMTP_HOST")
    smtp_port: int = Field(default=465, alias="SMTP_PORT", ge=1, le=65535)
    smtp_security: str = Field(default="ssl", alias="SMTP_SECURITY")
    smtp_username: str = Field(alias="SMTP_USERNAME")
    smtp_password: str = Field(alias="SMTP_PASSWORD")
    sender_email: str = Field(alias="SENDER_EMAIL")
    sender_name: str = Field(default="Outreach", alias="SENDER_NAME")

    check_replies_before_send: bool = Field(
        default=False, alias="CHECK_REPLIES_BEFORE_SEND"
    )
    imap_host: str | None = Field(default=None, alias="IMAP_HOST")
    imap_port: int = Field(default=993, alias="IMAP_PORT", ge=1, le=65535)
    imap_username: str | None = Field(default=None, alias="IMAP_USERNAME")
    imap_password: str | None = Field(default=None, alias="IMAP_PASSWORD")
    imap_inbox_folder: str = Field(default="INBOX", alias="IMAP_INBOX_FOLDER")

    min_delay_seconds: float = Field(default=45, alias="MIN_DELAY_SECONDS", ge=0)
    max_delay_seconds: float = Field(default=120, alias="MAX_DELAY_SECONDS", ge=0)
    daily_send_limit: int = Field(default=100, alias="DAILY_SEND_LIMIT", gt=0)
    worker_poll_seconds: int = Field(default=30, alias="WORKER_POLL_SECONDS", ge=1)
    failed_send_retry_seconds: int = Field(
        default=300, alias="FAILED_SEND_RETRY_SECONDS", ge=10
    )

    @model_validator(mode="after")
    def validate_values(self) -> "Settings":
        self.smtp_security = self.smtp_security.strip().lower()
        if self.smtp_security not in {"ssl", "starttls"}:
            raise ValueError("SMTP_SECURITY must be 'ssl' or 'starttls'")
        if self.min_delay_seconds > self.max_delay_seconds:
            raise ValueError("MIN_DELAY_SECONDS cannot exceed MAX_DELAY_SECONDS")
        if self.check_replies_before_send and not self.imap_host:
            raise ValueError(
                "IMAP_HOST is required when CHECK_REPLIES_BEFORE_SEND=true"
            )
        return self

    @property
    def effective_imap_username(self) -> str:
        return self.imap_username or self.smtp_username

    @property
    def effective_imap_password(self) -> str:
        return self.imap_password or self.smtp_password

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
