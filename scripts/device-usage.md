# Private device usage extension

Optional Python 3 standard-library sidecar for CLIProxyAPI v8.0.13. The frontend route is `#/device-usage`; its same-origin endpoint `/v8/management/device-usage` must be routed to loopback port 8318, ahead of the ordinary proxy route. This is a deployment-specific extension, not a stock backend endpoint.

The service reads its management key using systemd LoadCredential. Only this key can read metrics. Client inference keys and unauthenticated requests receive 401. Rotate the key and restart this service together when rotating the proxy management key. The UI login page is public, but protected data is not. Never distribute the management key to inference clients.

`/work/cliproxyapi-usage/clients.json` maps SHA-256(client key) to stable device labels. It is private to the collector. Raw client keys belong in separate owner-only files; they never enter the usage database or frontend. The collector allowlists canonical v2 counters and identifiers, discarding raw keys, prompts, error bodies, upstream headers and account addresses.

The collector drains the authenticated usage queue every five seconds, persists SQLite transactions in WAL mode and deduplicates by execution ID. Configure queue retention to 3600 seconds. Run exactly one queue consumer. An external RESP usage subscriber diverts records from the queue and is incompatible with this collector. This is operational telemetry, not lossless billing: the in-memory queue is lost on proxy restart; outages over retention, or a crash between dequeue and SQLite commit, may lose events. Last successful poll and rejected records are visible. No historical direct-provider traffic can be recovered.

Input includes cache reads/writes; output includes reasoning. Total must not add those subsets again. Requests count distinct inbound trace identities; upstream attempts include retries/failovers. Daily buckets use UTC; period filters are rolling 1/7/30/90 days. Records with incomplete canonical accounting are marked, not silently called complete. API pricing is not subscription quota accounting.

SQLite stores records indefinitely. Back it up with SQLite's backup API (or stop the collector before copying the DB and WAL). Stop the collector for a release switch, retain the database, switch the immutable release and restart. The sidecar needs no provider auth-directory access. Restore the prior UI separately from data; never roll back live provider credentials for a UI change.

Validation: `python3 -m unittest discover -s scripts -p 'test_device_usage.py'`, `bun run verify`, and browser checks of the authenticated route. The unit file is a deployment template; provision the system user and private directory before enabling it.
