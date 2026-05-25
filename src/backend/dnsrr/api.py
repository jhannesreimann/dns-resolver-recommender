"""HTTP API for the DNS Resolver Recommender backend."""

from __future__ import annotations

import logging
import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .cloudflare import CloudflareClient, CloudflareError
from .config import Settings, get_settings
from .resolvers import get_resolvers

logger = logging.getLogger(__name__)


class RotateResponse(BaseModel):
    """Response payload for POST /api/dns/rotate."""

    domain: str = Field(..., description="Newly created subdomain (FQDN).")
    record_id: str = Field(..., description="Cloudflare record ID, used for cleanup.")
    ttl: int = Field(..., description="DNS TTL the record was created with.")


class HealthResponse(BaseModel):
    status: str
    zone: str


class ResolverResponse(BaseModel):
    id: str
    name: str
    description: str
    url: str
    ip_address: str | None = None
    dnssec: bool
    no_logs: bool
    no_filter: bool
    country: str | None = None


async def _cleanup_loop(client: CloudflareClient, comment_filter: str) -> None:
    """Periodically cleans up expired DNS records."""
    while True:
        try:
            records = await client.list_records(comment_contains=comment_filter)
            now = datetime.now(timezone.utc)
            for record in records:
                if not record.created_on:
                    continue
                # Cloudflare created_on is format "2014-01-01T05:20:00.12345Z"
                try:
                    created_dt = datetime.fromisoformat(record.created_on.replace("Z", "+00:00"))
                    age_seconds = (now - created_dt).total_seconds()
                    if age_seconds > 300:  # 5 minutes
                        logger.info("Cleaning up expired record %s (%s)", record.name, record.record_id)
                        await client.delete_record(record.record_id)
                except ValueError:
                    logger.warning("Failed to parse created_on for record %s: %s", record.record_id, record.created_on)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Cleanup task failed, retrying in next cycle")
        
        await asyncio.sleep(60)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    client = CloudflareClient(
        api_key=settings.cloudflare_api_key,
        zone_id=settings.zone_id,
    )
    app.state.cloudflare = client
    
    cleanup_task = asyncio.create_task(_cleanup_loop(client, settings.record_comment))
    
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
        await client.aclose()


def create_app() -> FastAPI:
    """FastAPI application factory."""
    settings = get_settings()
    app = FastAPI(
        title="DNS Resolver Recommender API",
        version="0.1.0",
        lifespan=_lifespan,
    )

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )

    def _client() -> CloudflareClient:
        return app.state.cloudflare

    @app.get("/api/health", response_model=HealthResponse)
    async def health(s: Settings = Depends(get_settings)) -> HealthResponse:
        return HealthResponse(status="ok", zone=s.zone_domain)

    @app.get("/api/resolvers", response_model=list[ResolverResponse])
    async def list_resolvers(refresh: bool = False) -> list[dict]:
        try:
            return await get_resolvers(force_refresh=refresh)
        except Exception as exc:
            logger.exception("Failed to load resolvers")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to fetch resolvers: {exc}",
            ) from exc

    @app.post(
        "/api/dns/rotate",
        response_model=RotateResponse,
        status_code=status.HTTP_201_CREATED,
    )
    async def rotate(
        cf: CloudflareClient = Depends(_client),
        s: Settings = Depends(get_settings),
    ) -> RotateResponse:
        name = CloudflareClient.random_subdomain(s.zone_domain)
        try:
            record = await cf.create_a_record(
                name=name,
                target_ip=s.rotation_target_ip,
                ttl=s.rotation_ttl_seconds,
                comment=s.record_comment,
            )
        except CloudflareError as exc:
            logger.exception("Cloudflare rotate failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

        return RotateResponse(
            domain=record.name,
            record_id=record.record_id,
            ttl=record.ttl,
        )

    @app.delete("/api/dns/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_record(
        record_id: str,
        cf: CloudflareClient = Depends(_client),
    ) -> None:
        try:
            await cf.delete_record(record_id)
        except CloudflareError as exc:
            logger.exception("Cloudflare delete failed for %s", record_id)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    class VerifyResponse(BaseModel):
        status: str
        verified: bool | None = None
        query_count: int | None = None
        error_code: str | None = None
        message: str | None = None
        queries: list[dict] | None = None

    @app.get("/api/dns/verify", response_model=VerifyResponse)
    async def verify(
        domain: str,
        since: str | None = None,
        cf: CloudflareClient = Depends(_client),
    ) -> VerifyResponse:
        """Query the Cloudflare GraphQL API to see if the domain was queried.
        
        Requires Cloudflare 'Analytics: Read' permission.
        """
        # If 'since' is not provided, default to last 10 minutes in ISO UTC format
        if not since:
            since = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            # subtract 10 minutes (we can do a timedelta)
            from datetime import timedelta
            now_dt = datetime.now(timezone.utc)
            since_dt = now_dt - timedelta(minutes=10)
            since = since_dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

        try:
            result = await cf.verify_dns_query(domain, since)
            if result.get("status") == "error":
                return VerifyResponse(
                    status="error",
                    error_code=result.get("error_code"),
                    message=result.get("message"),
                )
            
            queries = result.get("queries", [])
            return VerifyResponse(
                status="ok",
                verified=len(queries) > 0,
                query_count=len(queries),
                queries=queries,
            )
        except CloudflareError as exc:
            logger.exception("Cloudflare verify failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

    return app


app = create_app()
