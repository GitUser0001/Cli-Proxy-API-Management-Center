#!/usr/bin/env python3
"""Private usage collector for CLIProxyAPI v8. Never persists raw usage payloads."""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

STATE = Path(os.environ.get('USAGE_STATE', '/work/cliproxyapi-usage'))
KEY_FILE = Path(os.environ.get('CREDENTIALS_DIRECTORY', str(STATE))) / 'management-key'
REGISTRY = STATE / 'clients.json'
DB = STATE / 'usage.sqlite'
PROXY = 'http://127.0.0.1:8317'
COLUMNS = 'id,ts,client,provider,model,account,trace,input,output,cache_read,cache_write,reasoning,total,failed,latency_ms,quality'
METRICS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning', 'total']


# USD per million tokens: uncached input, cache read, 5-minute write, output.
# Verified 2026-10-04 against official model pages; see device-usage.md.
PRICING_DATE = '2026-10-04'
RATES = {
    ('claude', 'claude-opus-5-5'): (4, .2, 5, 20),
    ('claude', 'claude-sonnet-5-5'): (2, .2, 2.5, 10),
    ('claude', 'claude-haiku-4-5-20251001'): (1, .1, 1.25, 5),
    ('codex', 'gpt-6.1-sol'): (2, .1, 2.5, 10),
    ('codex', 'gpt-6-luna'): (.1, .01, .125, .5),
}
IMAGE_PRICING_DATE = '2026-10-07'
# Exact identifiers only. The unsuffixed 2.5 tool label is not a documented API
# model: keep it unpriced rather than guessing which model produced the image.
IMAGE_MODELS = {'gpt-image-2', 'gpt-image-2-2026-04-21',
                'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'}


def image_cost(provider, model, inp, out, read, write, quality, upper=False):
    if (provider != 'codex' or model not in IMAGE_MODELS or quality != 'complete'
            or write != 0 or min(inp, out, read) < 0 or read > inp):
        return None
    # v8 drops text/image input detail. Bound the modality mix using the text
    # and image rates, with recorded cache reads separately. Unreported cache
    # discounts and partial-image fees are outside this API-equivalent estimate.
    rate, cached = (8, 2) if upper else (5, 1.25)
    return ((inp - read) * rate + read * cached + out * 30) / 1000000


def estimate_cost(provider, model, inp, out, read, write, quality):
    if provider == 'codex' and model in IMAGE_MODELS:
        return image_cost(provider, model, inp, out, read, write, quality)
    rates = RATES.get((provider, model))
    if rates is None or quality != 'complete':
        return None
    # Input already contains both cache categories; output includes reasoning.
    uncached = inp - read - write
    if uncached < 0:
        return None
    long_context = provider == 'codex' and inp > 272000
    input_cost = (uncached * rates[0] + read * rates[1] + write * rates[2])
    return (input_cost * (2 if long_context else 1)
            + out * rates[3] * (1.5 if long_context else 1)) / 1000000


def estimate_cost_max(provider, model, inp, out, read, write, quality):
    if provider == 'codex' and model in IMAGE_MODELS:
        return image_cost(provider, model, inp, out, read, write, quality, upper=True)
    return estimate_cost(provider, model, inp, out, read, write, quality)


def connect(path=DB):
    c = sqlite3.connect(path, timeout=20)
    c.row_factory = sqlite3.Row
    c.create_function('estimate_cost', 7, estimate_cost, deterministic=True)
    c.create_function('estimate_cost_max', 7, estimate_cost_max, deterministic=True)
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('''CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, ts TEXT NOT NULL, client TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, account TEXT NOT NULL,
        trace TEXT NOT NULL, input INTEGER, output INTEGER, cache_read INTEGER,
        cache_write INTEGER, reasoning INTEGER, total INTEGER, failed INTEGER,
        latency_ms INTEGER, quality TEXT NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS events_ts ON events(ts)')
    c.execute('CREATE TABLE IF NOT EXISTS collector (key TEXT PRIMARY KEY,value TEXT)')
    return c


def count(value):
    return max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def normalize(raw, registry):
    """Allowlist counters only; drop keys, addresses, bodies, headers and session IDs."""
    ident = raw.get('execution_id')
    if not isinstance(ident, str) or not ident or len(ident) > 128:
        raise ValueError('missing execution identity')
    stamp = dt.datetime.fromisoformat(raw['timestamp'].replace('Z', '+00:00'))
    stamp = stamp.astimezone(dt.timezone.utc).isoformat(timespec='microseconds')
    digest = hashlib.sha256(str(raw.get('api_key', '')).encode()).hexdigest()
    client = registry.get(digest, 'unassigned')
    b = raw.get('token_breakdown') or {}
    i, o = b.get('input') or {}, b.get('output') or {}
    # Canonical input includes cache; output includes reasoning. Never sum twice.
    quality = b.get('quality', 'unclassified')
    if b.get('schema_version') != 2:
        raise ValueError('unsupported accounting version')
    inp, out, total = count(i.get('total_tokens')), count(o.get('total_tokens')), count(b.get('total_tokens'))
    cache_read, cache_write, reasoning = count(i.get('cache_read_tokens')), count(i.get('cache_write_tokens')), count(o.get('reasoning_tokens'))
    if inp < cache_read + cache_write or out < reasoning or total < inp + out:
        raise ValueError('inconsistent token accounting')
    if quality not in ('complete', 'inconsistent', 'unclassified'):
        quality = 'unclassified'
    def label(key):
        value = str(raw.get(key, 'unknown'))
        # Model/provider are identifiers, never free-form provider error strings.
        return value[:120] if all(c.isalnum() or c in '-_.:/ ' for c in value) else 'unknown'
    account = hashlib.sha256(str(raw.get('auth_index', 'unknown')).encode()).hexdigest()[:12]
    trace = hashlib.sha256(str(raw.get('trace_id') or ident).encode()).hexdigest()[:24]
    return (ident, stamp, client, label('provider'), label('model'), account, trace,
            inp, out, cache_read, cache_write, reasoning, total,
            int(bool(raw.get('failed'))), count(raw.get('latency_ms')), quality)


def record_batch(c, records, registry):
    rejected = 0
    with c:
        for raw in records:
            try:
                row = normalize(raw, registry)
                c.execute(f'INSERT OR IGNORE INTO events ({COLUMNS}) VALUES ({",".join("?" for _ in row)})', row)
            except (ValueError, TypeError, KeyError, AttributeError):
                rejected += 1
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        c.execute("INSERT OR REPLACE INTO collector VALUES ('last_poll',?)", (now,))
        c.execute("INSERT OR IGNORE INTO collector VALUES ('started_at',?)", (now,))
        c.execute("INSERT OR IGNORE INTO collector VALUES ('rejected','0')")
        c.execute("UPDATE collector SET value=CAST(value AS INTEGER)+? WHERE key='rejected'", (rejected,))


def collect():
    c = connect()
    while True:
        try:
            key = KEY_FILE.read_text().strip()
            registry = json.loads(REGISTRY.read_text())
            req = urllib.request.Request(PROXY + '/v8/management/observability/usage/queue?count=500', headers={'Authorization': 'Bearer ' + key})
            with urllib.request.urlopen(req, timeout=15) as r:
                records = json.load(r)
            if not isinstance(records, list):
                raise ValueError('unexpected usage response')
            record_batch(c, records, registry)
            if len(records) == 500:
                continue
        except Exception:
            # Never log provider response bodies, URLs with credentials or exceptions.
            print('Usage collection unavailable; retrying.', flush=True)
        time.sleep(5)


INTERVALS = {'5m': 300, '1h': 3600, '1d': 86400}


def resolve_interval(days, interval='auto'):
    if interval == 'auto':
        interval = '5m' if days == 1 else '1h' if days == 7 else '1d'
    if interval not in INTERVALS or days * 86400 // INTERVALS[interval] > 744:
        raise ValueError('interval too small or unsupported')
    return interval


def period_date(date, granularity):
    if granularity == 'day':
        return date
    if granularity == 'week':
        return date - dt.timedelta(days=date.weekday())
    if granularity == 'month':
        return date.replace(day=1)
    raise ValueError('unsupported calendar granularity')


def shift_period(date, granularity, amount):
    if granularity == 'month':
        months = date.year * 12 + date.month - 1 + amount
        return dt.date(months // 12, months % 12 + 1, 1)
    return date + dt.timedelta(days=amount * (7 if granularity == 'week' else 1))


def calendar_starts(now, timezone, granularity, count):
    limit = {'day': 30, 'week': 12, 'month': 12}.get(granularity, 0)
    if not 1 <= count <= limit:
        raise ValueError('unsupported calendar count')
    last = period_date(now.astimezone(ZoneInfo(timezone)).date(), granularity)
    return [shift_period(last, granularity, i - count + 1) for i in range(count)]


def report(c, days, registry, interval='auto', now=None, period='rolling', timezone='UTC',
           granularity='day', calendar_count=7):
    interval = resolve_interval(days, '1d' if period == 'calendar' else interval)
    seconds = INTERVALS[interval]
    now = now or dt.datetime.now(dt.timezone.utc)
    if period == 'today':
        if days != 1:
            raise ValueError('today requires days=1')
        local = now.astimezone(ZoneInfo(timezone))
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        since = start.astimezone(dt.timezone.utc).isoformat(timespec='microseconds')
    elif period == 'calendar':
        starts = calendar_starts(now, timezone, granularity, calendar_count)
        zone = ZoneInfo(timezone)
        since = dt.datetime.combine(starts[0], dt.time.min, zone).astimezone(dt.timezone.utc).isoformat(timespec='microseconds')
        c.create_function('usage_period', 1, lambda stamp: period_date(
            dt.datetime.fromisoformat(stamp).astimezone(zone).date(), granularity).isoformat(), deterministic=True)
    elif period == 'rolling':
        since = (now - dt.timedelta(days=days)).isoformat(timespec='microseconds')
    else:
        raise ValueError('unsupported period')
    until = now.isoformat(timespec='microseconds')
    sums = ','.join(f'COALESCE(SUM({m}),0) AS {m}' for m in METRICS)
    cost = 'estimate_cost(provider,model,input,output,cache_read,cache_write,quality)'
    upper = 'estimate_cost_max(provider,model,input,output,cache_read,cache_write,quality)'
    costs = (f'COALESCE(SUM({cost}),0) AS cost_usd,COALESCE(SUM({upper}),0) AS cost_usd_max,'
             f'COALESCE(SUM({upper} > {cost}),0) AS image_estimated_executions,'
             f'COALESCE(SUM({cost} IS NULL),0) AS unpriced_executions')
    aggregate = f'COUNT(*) AS executions, COUNT(DISTINCT client || char(58) || trace) AS requests, COALESCE(SUM(failed),0) AS errors,{sums},COALESCE(AVG(latency_ms),0) AS latency_ms,COALESCE(SUM(quality != "complete"),0) AS incomplete,{costs}'
    def query(sql):
        return [dict(r) for r in c.execute(sql, (since, until))]
    window = 'ts>=? AND ts<=?'
    # All parts of one report share a SQLite snapshot while the collector writes.
    c.execute('BEGIN')
    totals = query(f'SELECT {aggregate} FROM events WHERE {window}')[0]
    clients = query(f'SELECT client,{aggregate} FROM events WHERE {window} GROUP BY client ORDER BY total DESC')
    found = {r['client'] for r in clients}
    empty = dict.fromkeys(['executions','requests','errors','latency_ms','incomplete','cost_usd','cost_usd_max','image_estimated_executions','unpriced_executions'] + METRICS, 0)
    clients += [dict(empty, client=name) for name in sorted(set(registry.values()) - found)]
    models = query(f'SELECT provider,model,{aggregate} FROM events WHERE {window} GROUP BY provider,model ORDER BY total DESC')
    client_models = query(f'SELECT client,provider,model,{aggregate} FROM events WHERE {window} GROUP BY client,provider,model ORDER BY total DESC')
    daily = query(f'SELECT substr(ts,1,10) AS day,{aggregate} FROM events WHERE {window} GROUP BY day ORDER BY day')
    # Count a trace once, in its first observed bucket in the requested window.
    # Attempts/tokens retain their actual timestamps, even when a retry crosses a bucket.
    timeline = query(f'''WITH ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY client,trace ORDER BY ts,id) AS attempt
        FROM events WHERE {window}
    ) SELECT CAST(strftime('%s',ts) AS INTEGER)/{seconds}*{seconds} AS bucket,
        client,COUNT(*) AS executions,SUM(attempt=1) AS requests,
        SUM(failed) AS errors,{sums},AVG(latency_ms) AS latency_ms,
        SUM(quality != 'complete') AS incomplete,{costs}
        FROM ranked GROUP BY bucket,client ORDER BY bucket,client''')
    collector = dict(c.execute('SELECT key,value FROM collector'))
    calendar = {}
    if period == 'calendar':
        recorded = c.execute('SELECT MIN(ts) FROM events').fetchone()[0]
        history_start = min(filter(None, [recorded, collector.get('started_at')]), default=None)
        history = dt.datetime.fromisoformat(history_start) if history_start else None
        grouped = {r['period_start']: r for r in query(
            f'SELECT usage_period(ts) AS period_start,{aggregate} FROM events WHERE {window} GROUP BY period_start ORDER BY period_start')}
        by_period = {}
        for row in query(f'SELECT usage_period(ts) AS period_start,client,{aggregate} FROM events WHERE {window} GROUP BY period_start,client ORDER BY period_start,client'):
            key = row.pop('period_start')
            by_period.setdefault(key, []).append(row)
        series = []
        for index, date in enumerate(starts):
            start = dt.datetime.combine(date, dt.time.min, zone).astimezone(dt.timezone.utc)
            end = min(now, dt.datetime.combine(shift_period(date, granularity, 1), dt.time.min, zone).astimezone(dt.timezone.utc))
            series.append(dict(grouped.get(date.isoformat(), empty), period_start=date.isoformat(),
                               clients=by_period.get(date.isoformat(), []),
                               available=history is not None and history < end,
                               is_current=index == len(starts)-1,
                               partial=index == len(starts)-1 or (history is not None and history > start)))
        calendar = dict(series=series, granularity=granularity, calendar_count=calendar_count,
                        history_start=history_start)
    c.commit()
    return dict(days=days, period=period, timezone=timezone if period in ('today', 'calendar') else 'UTC',
                totals=totals, clients=clients, models=models, daily=daily,
                client_models=client_models, collector=collector, timeline=timeline,
                interval=interval, bucket_seconds=seconds, range_start=since, range_end=until,
                pricing=dict(as_of=PRICING_DATE, image_as_of=IMAGE_PRICING_DATE,
                             currency='USD', basis='standard-5m-cache-image-range'), **calendar)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        path = urlparse(self.path)
        expected = 'Bearer ' + KEY_FILE.read_text().strip()
        supplied = self.headers.get('Authorization', '')
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            self.send_json(401, {'error': 'management authentication required'})
            return
        if path.path != '/v8/management/device-usage':
            self.send_json(404, {'error': 'not found'})
            return
        try:
            params = parse_qs(path.query)
            days = int(params.get('days', ['7'])[0])
            if days not in (1, 7, 30, 90):
                raise ValueError()
            interval = resolve_interval(days, params.get('interval', ['auto'])[0])
            period = params.get('period', ['rolling'])[0]
            timezone = params.get('timezone', ['UTC'])[0]
            granularity = params.get('granularity', ['day'])[0]
            calendar_count = int(params.get('count', ['7'])[0])
            if period not in ('rolling', 'today', 'calendar') or (period == 'today' and days != 1):
                raise ValueError()
            if len(timezone) > 100:
                raise ValueError()
            if period in ('today', 'calendar'):
                ZoneInfo(timezone)
            if period == 'calendar':
                calendar_starts(dt.datetime.now(dt.timezone.utc), timezone, granularity, calendar_count)
        except (ValueError, ZoneInfoNotFoundError):
            self.send_json(400, {'error': 'unsupported days, interval, period or timezone (maximum 744 buckets)'})
            return
        try:
            registry = json.loads(REGISTRY.read_text())
            c = connect()
            try:
                body = report(c, days, registry, interval, period=period, timezone=timezone, granularity=granularity, calendar_count=calendar_count)
            finally:
                c.close()
            self.send_json(200, body)
        except Exception:
            self.send_json(503, {'error': 'usage storage unavailable'})

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    os.umask(0o077)
    threading.Thread(target=collect, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', 8318), Handler).serve_forever()
