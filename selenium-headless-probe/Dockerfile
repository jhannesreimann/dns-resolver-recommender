FROM python:3.12-slim-bookworm

ARG TARGETARCH
ARG GECKODRIVER_VERSION=0.36.0

ENV PYTHONUNBUFFERED=1 \
    MOZ_HEADLESS=1 \
    MEASUREMENT_URL=https://dns.diic-hpi.org \
    MEASUREMENT_TIMEOUT=900 \
    OUTPUT_DIR=/app/output

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        firefox-esr \
        ca-certificates \
        curl \
    && case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
        amd64) GECKODRIVER_ARCH="linux64" ;; \
        arm64|aarch64) GECKODRIVER_ARCH="linux-aarch64" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH:-$(dpkg --print-architecture)}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL \
        "https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-${GECKODRIVER_ARCH}.tar.gz" \
        -o /tmp/geckodriver.tar.gz \
    && tar -xzf /tmp/geckodriver.tar.gz -C /usr/local/bin \
    && chmod +x /usr/local/bin/geckodriver \
    && geckodriver --version \
    && rm -f /tmp/geckodriver.tar.gz \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY measurement.py .

RUN mkdir -p /app/output

CMD ["python", "measurement.py"]
