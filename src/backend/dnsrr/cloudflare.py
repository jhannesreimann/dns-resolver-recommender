"""Thin async wrapper around the Cloudflare DNS Records API.

We only use the few endpoints needed to create, list and delete A records in
a single zone. The intent is functionally equivalent to Robert Richter's
cf-rotation-tool (https://github.com/judgeNotFound/cf-rotation-tool) but
runs in-process so we avoid the subprocess overhead on every measurement.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CF_API_BASE = "https://api.cloudflare.com/client/v4"


class CloudflareError(RuntimeError):
    """Raised when the Cloudflare API responds with an error or a non 2xx status."""


@dataclass(frozen=True)
class DnsRecord:
    """A single Cloudflare DNS record (only the fields we care about)."""

    record_id: str
    name: str
    type: str
    content: str
    ttl: int
    comment: str | None
    created_on: str | None


class CloudflareClient:
    """Async client for the Cloudflare DNS Records API.

    The client is intentionally small. It owns one shared httpx.AsyncClient that
    is closed via aclose() during application shutdown.
    """

    def __init__(
        self,
        api_key: str,
        zone_id: str,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._zone_id = zone_id
        self._client = httpx.AsyncClient(
            base_url=f"{CF_API_BASE}/zones/{zone_id}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout_seconds,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def create_a_record(
        self,
        name: str,
        target_ip: str,
        ttl: int = 60,
        comment: str | None = None,
    ) -> DnsRecord:
        """Create an A record. Returns the created record."""
        payload: dict[str, Any] = {
            "type": "A",
            "name": name,
            "content": target_ip,
            "ttl": ttl,
            "proxied": False,
        }
        if comment is not None:
            payload["comment"] = comment

        response = await self._client.post("/dns_records", json=payload)
        data = self._unwrap(response, action=f"create A record {name}")
        return self._parse_record(data)

    async def delete_record(self, record_id: str) -> None:
        """Delete a record by its ID. Idempotent: a 404 is treated as success."""
        response = await self._client.delete(f"/dns_records/{record_id}")
        if response.status_code == 404:
            logger.info("Record %s already gone, treating as deleted.", record_id)
            return
        self._unwrap(response, action=f"delete record {record_id}")

    async def list_records(
        self,
        comment_contains: str | None = None,
        per_page: int = 100,
    ) -> list[DnsRecord]:
        """List all records in the zone. Optional comment filter."""
        records: list[DnsRecord] = []
        page = 1
        while True:
            params = {"per_page": per_page, "page": page}
            if comment_contains is not None:
                params["comment.contains"] = comment_contains
            response = await self._client.get("/dns_records", params=params)
            payload = self._unwrap_list(response, action="list dns records")
            for raw in payload["result"]:
                records.append(self._parse_record(raw))
            info = payload.get("result_info") or {}
            total_pages = int(info.get("total_pages", 1) or 1)
            if page >= total_pages:
                break
            page += 1
        return records

    @staticmethod
    def random_subdomain(zone_domain: str) -> str:
        """Build a fresh fully-qualified subdomain under the configured zone."""
        return f"{uuid.uuid4()}.{zone_domain}"

    @staticmethod
    def _parse_record(data: dict[str, Any]) -> DnsRecord:
        return DnsRecord(
            record_id=str(data["id"]),
            name=str(data["name"]),
            type=str(data["type"]),
            content=str(data["content"]),
            ttl=int(data.get("ttl", 0)),
            created_on=data.get("created_on"),
            comment=data.get("comment"),
        )

    @staticmethod
    def _unwrap(response: httpx.Response, *, action: str) -> dict[str, Any]:
        body = CloudflareClient._unwrap_list(response, action=action)
        result = body.get("result")
        if not isinstance(result, dict):
            raise CloudflareError(
                f"Unexpected Cloudflare response while trying to {action}: {body!r}"
            )
        return result

    @staticmethod
    def _unwrap_list(response: httpx.Response, *, action: str) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise CloudflareError(
                f"Cloudflare returned non-JSON for {action} (status {response.status_code})"
            ) from exc

        if response.is_success and body.get("success", False):
            return body

        errors = body.get("errors") or []
        message = "; ".join(
            f"{e.get('code', '?')}: {e.get('message', '')}" for e in errors
        ) or response.text or response.reason_phrase
        raise CloudflareError(
            f"Cloudflare API failed to {action} (status {response.status_code}): {message}"
        )
