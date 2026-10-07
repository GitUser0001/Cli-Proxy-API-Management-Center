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

Device usage provides user/device multiselect, requests/tokens/failed-attempt metrics, line and stacked-bar charts, hover details, click-to-pin and keyboard/touch scrubbing. Filters apply to summary cards and both tables. Chart timestamps default to the viewer’s browser timezone. A Local / UTC switch updates axis labels, interval details and accessible slider text, remembers the choice per browser, and shows the selected IANA timezone. Interval details include UTC offsets to distinguish repeated hours during daylight-saving changes. CSV and collector bucket boundaries remain UTC; collector status timestamps use the browser locale. Optional Live mode refreshes every 30 seconds in a visible tab, off by default. CSV exports only selected clients and neutralizes formula-like client labels.

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

## Dashboard calendar-day summary (ledger.13)

The home page adds token API value per person below Requests handled, grouping the
same four VM/laptop identities as Device usage. Apps/unknown clients remain a separate
footer total. Values are standard API estimates, not subscription charges; unknown or
partial prices retain dash/asterisk semantics. Zero activity is shown as zero only after
a successful report. Errors/unsupported older collectors display unavailable with retry.

The existing endpoint additionally accepts `days=1&period=today&timezone=<IANA name>`.
The server computes the exact current local midnight with Python zoneinfo and returns
`period=today`, `timezone`, `range_start` and `range_end`. This is a calendar day,
including DST 23/25-hour days; regular Device usage requests retain rolling periods.
Invalid periods, timezones or today with days other than 1 receive400 after normal
management authentication. On Ubuntu26.04 install `tzdata-legacy` matching `tzdata`
to support aliases returned by browsers, including Europe/Kiev. No DB migration,
extra queue consumer or provider-price changes are needed.

The dashboard refreshes the summary every60s while visible, on return to the tab and
with header Refresh. Abort/generation/connection guards clear cross-session data;
older collectors that ignore the new query cannot silently supply rolling24h figures.
Deploy the updated existing collector with the UI and restart only cliproxyapi-usage.
Keep the single-file HTML and optional Apple icon; preserve live DB and all credentials.

Verification for ledger.13: pinned Bun1.3.14 full verify (1512 tests), 16 Python
collector tests covering midnight/retries/DST/half-hour offsets/legacy aliases.
Browser QA used the actual DashboardPage with a read-only production aggregate
fixture and mocked management APIs: desktop light, 390px dark, all four idle
people, unavailable state, and successful Retry. New panel fits within mobile
width; existing hero decoration extends the document width slightly. No auth
material is included in the QA fixture. Temporary harness is removed.

### Dashboard calendar history (ledger.14)

The same endpoint supports `days=90&period=calendar&timezone=Europe/Kiev&granularity=day&count=7`.
The legacy `days` value remains valid but calendar/count defines the actual range.
Granularity is day/week/month, maximum count 30/12/12 respectively. Weeks begin
Monday; months begin on the first. Dashboard defaults are 7 days, 8 weeks, 6 months.
`series` contains one local-calendar bucket per period, with `period_start`,
`available`, `partial`, `is_current` and the existing metrics/price coverage.
The first observed collector/event timestamp is `history_start`; earlier buckets
are unavailable, rather than reported as zero. Current and partly recorded first
periods are marked partial. Requests deduplicate traces within each calendar
bucket, so a trace spanning periods may count in both; execution/tokens/cost sums
reconcile across all buckets. Existing UTC daily/timeline and rolling/today modes
remain unchanged. No new table, pricing changes or queue consumer.

Calendar UI uses connection-safe refresh60s/visibility/header and aborts old range
responses. Local axes and a details panel/table expose requests, tokens, failed
attempts and estimated USD. The bar metric is selectable. Unknown prices/history
are shown as a dash, not zero; cost coverage flags are retained. Keyboard arrows,
Home/End and touch/click select a column. All four locales updated.

Ledger.14 verification: Bun1.3.14 full verify1514 tests, lint, TypeScript/Vite build;
Python20 collector tests covering day/week/month boundaries, Monday/year changes,
DST, half-hour offsets, history availability, retry deduplication and cost sums.
Browser actual DashboardPage with safe production report fixtures/mock APIs:
days/weeks/months, dollar/request/token selectors, data table, keyboard arrow
selection, 390px dark, unavailable+Retry and true-zero periods. Temporary QA files
removed. Preview shows the actual CalendarUsage component with recorded aggregate
values at QA time; no credentials or provider identities in fixtures/screenshots.


## Image API-equivalent estimates (2026-10-07)

The report now includes `cost_usd_max` and `image_estimated_executions` in all
metrics groups, including calendar bucket clients. `cost_usd` is the lower end
of the priced portion; `cost_usd_max` is its upper end. Text model estimates are
identical at both ends. Unknown or incomplete attempts remain excluded and
counted separately. `pricing.image_as_of` dates image rates independently.

Official Standard USD per 1M tokens for GPT Image 2 and both GPT Image 2.5
variants: text input 5 / cached 1.25; image input 8 / cached 2; image output 30.
Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing#image-generation-models)
and [image generation guide](https://developers.openai.com/api/docs/guides/image-generation#cached-input-pricing).
The official pricing Markdown exposes the complete Standard table, including
GPT Image 2; do not use the Batch table's half-price rates. Exact supported Codex
model identifiers: `gpt-image-2`, `gpt-image-2-2026-04-21`,
`gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`. The recorded `gpt-image-2.5` label
is undocumented and stays unpriced, without fuzzy aliases.

Backend v8.0.13 parses image tool usage but drops input text/image detail before
exporting canonical v2 accounting. Existing SQLite history cannot restore it;
new requests have the same limitation. For input I, recorded cache reads C and
image output O, the modality interval is [(I-C)*5+C*1.25+O*30,
(I-C)*8+C*2+O*30]/1M. Image cache writes are unsupported and therefore unpriced.
Image attempts do not inherit text-model long-context premiums. The interval
covers modality uncertainty at Standard rates, not every possible charge: the
upstream does not report all image cache hits, and partial-image fees/service
tiers are excluded. Do not label this an exact bill or a guaranteed billing bound.

The shared formatter uses the upper estimate for totals, people, today/team and
calendar summaries. Only model tables retain ranges with outward cent rounding;
upper-only image amounts keep the same outward upper-cent rounding. Both ends
propagate through grouping and filtering without changing the API contract.
Monetary bars, shares and today sorting use the unrounded upper estimate.
Partial-price asterisks are preserved.
Old reports without the new fields still render their original single estimate.
DB schema, stored tokens and backend are unchanged; only the existing collector
is restarted during deployment. No second usage consumer, raw payload logging,
paid inference or OAuth operation is needed. Future finer accounting requires
a separately validated backend change and upstream modality evidence.
