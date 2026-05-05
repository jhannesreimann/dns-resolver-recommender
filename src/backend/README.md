# Backend

Python telemetry API running on dns.diic-hpi.org (port 443 via Nginx).

Responsibilities:
  - Receive measurement results from the browser (POST /api/submit)
  - Map client IP to ASN and region via local GeoIP database
  - Drop raw IP immediately after lookup (GDPR ephemeral processing)
  - Persist anonymised measurement records to database
