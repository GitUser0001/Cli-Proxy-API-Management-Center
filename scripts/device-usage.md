# Private device usage extension

Optional Python 3 standard-library sidecar for CLIProxyAPI v8.0.13. The frontend route is `#/device-usage`; its same-origin endpoint `/v8/management/device-usage` must be routed to loopback port 8318, ahead of the ordinary proxy route. This is a deployment-specific extension, not a stock backend endpoint.

The service reads its management key using systemd LoadCredential. Only this key can read metrics. Client inference keys and unauthenticated requests receive 401. Rotate the key and restart this service together when rotating the proxy management key. The UI login page is public, but protected data is not. Never distribute the management key to inference clients.

`/work/cliproxyapi-usage/clients.json` maps SHA-256(client key) to stable device labels. It is private to the collector. Raw client keys belong in separate owner-only files; they never enter the usage database or frontend. The collector allowlists canonical v2 counters and identifiers, discarding raw keys, prompts, error bodies, upstream headers and account addresses.

The collector drains the authenticated usage queue every five seconds, persists SQLite transactions in WAL mode and deduplicates by execution ID. Configure queue retention to 3600 seconds. Run exactly one queue consumer. An external RESP usage subscriber diverts records from the queue and is incompatible with this collector. This is operational telemetry, not lossless billing: the in-memory queue is lost on proxy restart; outages over retention, or a crash between dequeue and SQLite commit, may lose events. Last successful poll and rejected records are visible. No historical direct-provider traffic can be recovered.

Input includes cache reads/writes; output includes reasoning. Total must not add those subsets again. Requests count distinct inbound trace identities; upstream attempts include retries/failovers. Daily buckets use UTC; period filters are rolling 1/7/30/90 days. Records with incomplete canonical accounting are marked, not silently called complete. API pricing is not subscription quota accounting.

SQLite stores records indefinitely. Back it up with SQLite's backup API (or stop the collector before copying the DB and WAL). Stop the collector for a release switch, retain the database, switch the immutable release and restart. The sidecar needs no provider auth-directory access. Restore the prior UI separately from data; never roll back live provider credentials for a UI change.

Validation: `python3 -m unittest discover -s scripts -p 'test_device_usage.py'`, `bun run verify`, and browser checks of the authenticated route. The unit file is a deployment template; provision the system user and private directory before enabling it.

## Interactive timeline (ledger.4)

The report accepts `interval=auto|5m|1h|1d` alongside `days=1|7|30|90`. Auto uses 5-minute buckets for 24 hours, hourly buckets for 7 days, and daily buckets for 30/90 days. Combinations exceeding 744 full intervals return 400. Response additions: `timeline` (sparse UTC epoch-second buckets per client), `range_start`, `range_end`, `bucket_seconds`, `interval`, and `client_models`. No event identities, credentials or prompts are returned. Existing report fields remain available; no database migration is required.

Requests count distinct `(client, trace)` pairs in the rolling window. Each request belongs to its first observed bucket **within that window**. Upstream attempts, failures and tokens stay at their actual timestamps, including cross-bucket retries. Summing the timeline therefore matches period totals. A request retried across different models may appear in both model rows; model request counts are not necessarily additive. All report queries share one SQLite read snapshot. Partial first/last buckets are clipped in the detail panel and CSV. Empty buckets mean no recorded events, not verified uptime.

Device usage provides user/device multiselect, requests/tokens/failed-attempt metrics, line and stacked-bar charts, hover details, click-to-pin and keyboard/touch scrubbing. Filters apply to summary cards and both tables. Chart timestamps and CSV are UTC; collector status timestamps use the browser locale. Optional Live mode refreshes every 30 seconds in a visible tab, off by default. CSV exports only selected clients and neutralizes formula-like client labels.

Verification for ledger.4: 1499 Bun tests, lint and TypeScript/Vite build; seven Python tests including cross-bucket retry accounting, zero-traffic users, future/out-of-window records, interval bounds and management-only access. Local browser checks covered filters, empty selection, hourly/5-minute charts, bars, pinning, keyboard scrubbing, phone width (390 px), dark theme and an actual CSV download (150 rows / 1600 synthetic requests). The temporary QA fixture is not part of the production artifact.

## People grouping (ledger.5)

The UI combines `dan-macbook` and `devbox-dshcherbak` as **Dan**, and combines each VM/laptop pair: `devbox-dlukianenko` + `laptop-dlukianenko` as **Denis**, `devbox-hhodovaniuk` + `laptop-hhodovaniuk` as **Hlib**, and `devbox-dplokhuta` + `laptop-dplokhuta` as **Dima**. `dan-test-app`, `portal-demo-app` and unknown/new clients remain separate. This presentation mapping lives in `src/features/deviceUsage/timeline.ts`; the API response and SQLite per-key history are unchanged. Grouping combines additive counters by person, bucket and model; latency is weighted by attempts. Filters, summary cards, model tables and CSV use the same grouped values. CSV labels its identity column `person_or_app`. No collector/backend restart or data migration is required.


## API estimate (ledger.6)

The existing report now adds `cost_usd` and `unpriced_executions` to every metrics group, plus `pricing` metadata. SQLite schema and stored events are unchanged. Each attempt is priced before aggregation, including retries with recorded usage; reasoning is already in output, and uncached input is input minus cache read/write. Unknown provider/model pairs and incomplete accounting are excluded and counted. No fuzzy price matching. Changing the rate table reprices all recorded history; this is a current-rate comparison, not historical billing or subscription spend.

Standard USD/1M token rates verified 2026-10-04 (input / read / write / output):

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): 2 / 0.10 / 2.50 / 10.
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): 0.10 / 0.01 / 0.125 / 0.50.
- [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing): Opus 5.5: 4 / 0.20 / 5 / 20; Sonnet 5.5: 2 / 0.20 / 2.50 / 10; Haiku 4.5 (20251001): 1 / 0.10 / 1.25 / 5.

OpenAI attempts over 272,000 canonical input tokens apply 2x input/cache and 1.5x output rates to the full attempt. Claude 5.5 has no long-context premium. Claude writes assume 5-minute TTL; the DB does not store cache duration (1-hour writes cost more) or service speed tier. Fast mode, regional premiums, server tool fees, subscription fees, and discounts are excluded. These limitations appear in the UI explanation alongside source links and verification date. Unknown/incomplete amounts display a dash or partial asterisk with the excluded count; tiny positive estimates display <$0.01 instead of rounding to zero. People and period filters apply to the cost card and both tables. Older collectors simply omit cost UI.

T3 reference: installed macOS Nightly 0.0.46-nightly.20261004.2648 usage screen labels the result “API estimate”, splits input/cache-read/cache-write/output, and explicitly excludes unpriced records. Its public application bundle was inspected, not private conversation/auth files. This feature uses the same simple presentation concept with the proxy's canonical counters and independently verified rates. No T3 import or additional queue consumer.

## People × providers × models (ledger.7)

The “Who uses what” section presents one card per selected person/app using existing `client_models` records. It follows the page's rolling period and people selection. Dan's two devices remain combined. Each card shows the person's exact request total and estimated API cost, a provider mix bar with explicit labels/percentages/attempt counts, and rows for each provider/model with requests, tokens and estimated cost. Provider shares use executions (including retries), not summed distinct requests: a cross-model failover may appear in both model rows. Identical model names under different providers remain separate. Provider colors stay consistent across people and selection changes. Unknown provider/model labels are preserved; idle clients show an empty state. Older collectors without `client_models` show an unavailable message instead of attributing global model totals to a person.

UI-only change; API, collector, database schema and pricing rates unchanged. Cards use a two-column desktop grid and single-column narrow layout, with local table scrolling when necessary. All four locales updated. Regression tests cover provider share denominators, overlapping model request counts, person selection, same model name across providers, Dan grouping, idle clients and legacy reports.
