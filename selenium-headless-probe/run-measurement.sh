#!/usr/bin/env sh

ENGINE="podman"

set -eu

for arg in "$@"; do
  case "$arg" in
    --engine=*)
      ENGINE="${arg#--engine=}"
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

IMAGE_NAME="${IMAGE_NAME:-dns-recommender-measurement}"
MEASUREMENT_URL="${MEASUREMENT_URL:-https://dns.diic-hpi.org}"
MEASUREMENT_TIMEOUT="${MEASUREMENT_TIMEOUT:-900}"
OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)/output}"
case "${OUTPUT_DIR}" in
  /*) ;;
  *) OUTPUT_DIR="$(pwd)/${OUTPUT_DIR}" ;;
esac

mkdir -p "${OUTPUT_DIR}"

$ENGINE build -t "${IMAGE_NAME}" .

$ENGINE run --rm \
  --shm-size=2g \
  --network=bridge \
  -e "MEASUREMENT_URL=${MEASUREMENT_URL}" \
  -e "MEASUREMENT_TIMEOUT=${MEASUREMENT_TIMEOUT}" \
  -e "OUTPUT_DIR=/app/output" \
  -v "${OUTPUT_DIR}:/app/output:Z" \
  "${IMAGE_NAME}"