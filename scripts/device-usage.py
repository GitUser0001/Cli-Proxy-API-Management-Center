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

STATE = Path(os.environ.get('USAGE_STATE', '/work/cliproxyapi-usage'))
KEY_FILE = Path(os.environ.get('CREDENTIALS_DIRECTORY', str(STATE))) / 'management-key'
REGISTRY = STATE / 'clients.json'
DB = STATE / 'usage.sqlite'
PROXY = 'http://127.0.0.1:8317'
COLUMNS = 'id,ts,client,provider,model,account,trace,input,output,cache_read,cache_write,reasoning,total,failed,latency_ms,quality'
METRICS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning', 'total']


def connect(path=DB):
    c = sqlite3.connect(path, timeout=20)
    c.row_factory = sqlite3.Row
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


def report(c, days, registry):
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat(timespec='microseconds')
    sums = ','.join(f'COALESCE(SUM({m}),0) AS {m}' for m in METRICS)
    aggregate = f'COUNT(*) AS executions, COUNT(DISTINCT trace) AS requests, COALESCE(SUM(failed),0) AS errors,{sums},COALESCE(AVG(latency_ms),0) AS latency_ms,COALESCE(SUM(quality != "complete"),0) AS incomplete'
    def query(sql):
        return [dict(r) for r in c.execute(sql, (since,))]
    totals = query(f'SELECT {aggregate} FROM events WHERE ts>=?')[0]
    clients = query(f'SELECT client,{aggregate} FROM events WHERE ts>=? GROUP BY client ORDER BY total DESC')
    found = {r['client'] for r in clients}
    empty = dict.fromkeys(['executions','requests','errors','latency_ms','incomplete'] + METRICS, 0)
    clients += [dict(empty, client=name) for name in sorted(set(registry.values()) - found)]
    models = query(f'SELECT provider,model,{aggregate} FROM events WHERE ts>=? GROUP BY provider,model ORDER BY total DESC')
    daily = query(f'SELECT substr(ts,1,10) AS day,{aggregate} FROM events WHERE ts>=? GROUP BY day ORDER BY day')
    collector = dict(c.execute('SELECT key,value FROM collector'))
    return dict(days=days, totals=totals, clients=clients, models=models, daily=daily, collector=collector)


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
            days = int(parse_qs(path.query).get('days', ['7'])[0])
            if days not in (1, 7, 30, 90):
                raise ValueError()
        except ValueError:
            self.send_json(400, {'error': 'days must be 1, 7, 30 or 90'})
            return
        try:
            registry = json.loads(REGISTRY.read_text())
            c = connect()
            try:
                body = report(c, days, registry)
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
