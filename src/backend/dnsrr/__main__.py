"""Entry point for `python -m dnsrr`."""

from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run(
        "dnsrr.api:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
