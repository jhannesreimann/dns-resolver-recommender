# Custom Authoritative DNS Server

Listens on port 53 (UDP/TCP) on the Hetzner VM.
Answers all queries for *.measure.dns.diic-hpi.org.

For each incoming UUID subdomain query (e.g. abc123.measure.dns.diic-hpi.org),
the server logs the timestamp and UUID to correlate with the client-side
measurement, enabling accurate uncached latency calculation (RQ3).
