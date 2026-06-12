"""Runtime configuration loaded from environment variables."""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings.

    Values are read from environment variables (or a local .env file when running
    outside production). Secrets must never be checked into version control.
    """

    cloudflare_api_key: str = Field(..., alias="CLOUDFLARE_API_KEY")
    zone_id: str = Field(..., alias="ZONE_ID")
    zone_domain: str = Field("diic-hpi.org", alias="ZONE_DOMAIN")
    rotation_target_ip: str = Field("127.0.0.1", alias="ROTATION_TARGET_IP")
    rotation_ttl_seconds: int = Field(60, alias="ROTATION_TTL_SECONDS")
    record_comment: str = Field(
        "dnsrr auto-generated, safe to delete",
        alias="ROTATION_RECORD_COMMENT",
    )
    cors_origins: str = Field("https://dns.diic-hpi.org", alias="CORS_ORIGINS")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database configuration
    db_user: str = Field("postgres", alias="DATABASE_USER")
    db_password: str = Field("postgres", alias="DATABASE_PASSWORD")
    db_host: str = Field("127.0.0.1", alias="DATABASE_HOST")
    db_name: str = Field("postgres", alias="DATABASE_NAME")
    db_port: int = Field(15432, alias="DATABASE_PORT")


_cached_settings: Settings | None = None


def get_settings() -> Settings:
    """Return a cached Settings instance."""
    global _cached_settings
    if _cached_settings is None:
        _cached_settings = Settings()
    return _cached_settings
