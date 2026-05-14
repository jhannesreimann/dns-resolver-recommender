# Frontend

Vanilla HTML/JS web application providing the user interface for the DNS resolver benchmark.

We opted for a minimalistic, M-Lab style design (plain HTML/JS) to keep the bundle small and ensure measurement accuracy without heavy framework overhead.

The frontend calls the Wasm module to perform DoH measurements and will send results
to the telemetry API at `/api/submit` (if opted in).
