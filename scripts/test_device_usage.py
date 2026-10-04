import importlib.util
import hashlib
import unittest
import tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location('usage', Path(__file__).with_name('device-usage.py'))
u = importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)

class UsageTests(unittest.TestCase):
    def event(self):
        return dict(execution_id='test-1',timestamp='2026-10-04T12:00:00Z',api_key='secret-client',provider='claude',model='test',source='private-email',fail={'body':'secret-prompt'},token_breakdown=dict(schema_version=2,quality='complete',total_tokens=120,input=dict(total_tokens=100,cache_read_tokens=70,cache_write_tokens=20),output=dict(total_tokens=20,reasoning_tokens=10)))
    def test_accounting_and_redaction(self):
        e=self.event(); reg={hashlib.sha256(b'secret-client').hexdigest():'laptop'}
        row=u.normalize(e,reg)
        self.assertEqual(row[7:13],(100,20,70,20,10,120))
        self.assertNotIn('secret',str(row));self.assertNotIn('private-email',str(row))
        self.assertEqual(row[2],'laptop')
    def test_duplicate_and_bad_records(self):
        with tempfile.TemporaryDirectory() as root:
            c=u.connect(Path(root)/'test.db');e=self.event();bad=self.event();bad['token_breakdown']['total_tokens']=1
            u.record_batch(c,[e,e,bad],{})
            self.assertEqual(c.execute('select count(*) from events').fetchone()[0],1)
            self.assertEqual(c.execute("select value from collector where key='rejected'").fetchone()[0],'1')
            c.close()
    def test_unknown_schema_rejected(self):
        e=self.event();e['token_breakdown']['schema_version']=1
        with self.assertRaises(ValueError):u.normalize(e,{})


class PricingTests(unittest.TestCase):
    def test_cache_and_reasoning_are_not_charged_twice(self):
        # 10 uncached + 70 read + 20 write + 20 output (including reasoning).
        self.assertAlmostEqual(u.estimate_cost('claude', 'claude-opus-5-5', 100, 20, 70, 20, 'complete'), .000554)
        self.assertAlmostEqual(u.estimate_cost('codex', 'gpt-6-luna', 100, 20, 70, 20, 'complete'), .0000142)

    def test_long_context_threshold_is_per_attempt(self):
        for model in ['gpt-6.1-sol', 'gpt-6-luna']:
            rates = u.RATES[('codex', model)]
            for tokens in [272000, 272001]:
                factor = 2 if tokens > 272000 else 1
                output_factor = 1.5 if tokens > 272000 else 1
                expected = ((tokens - 120) * rates[0] * factor + 100 * rates[1] * factor + 20 * rates[2] * factor + 30 * rates[3] * output_factor) / 1000000
                self.assertAlmostEqual(u.estimate_cost('codex', model, tokens, 30, 100, 20, 'complete'), expected)
        self.assertAlmostEqual(u.estimate_cost('claude', 'claude-opus-5-5', 900000, 0, 0, 0, 'complete'), 3.6)

    def test_unknown_and_incomplete_are_unpriced(self):
        for provider, model, quality in [('codex','unknown','complete'), ('claude','gpt-6.1-sol','complete'), ('codex','gpt-6.1-sol','unclassified')]:
            self.assertIsNone(u.estimate_cost(provider, model, 100, 20, 70, 20, quality))

    def test_report_costs_reconcile_and_preserve_unknown_coverage(self):
        import datetime as dt
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'test.db')
            events = []
            for ident, model in [('one','claude-opus-5-5'), ('retry','claude-opus-5-5'), ('unknown','new-model')]:
                event = UsageTests().event()
                event.update(execution_id=ident, model=model, trace_id='same', failed=ident=='retry')
                events.append(event)
            registry = {hashlib.sha256(b'secret-client').hexdigest(): 'Dan', 'idle': 'idle'}
            u.record_batch(c, events, registry)
            result = u.report(c, 1, registry, now=dt.datetime(2026,10,4,13,tzinfo=dt.timezone.utc))
            self.assertAlmostEqual(result['totals']['cost_usd'], .001108)
            self.assertEqual(result['totals']['unpriced_executions'], 1)
            self.assertEqual(result['totals']['requests'], 1)
            for key in ['clients','models','daily','timeline','client_models']:
                self.assertAlmostEqual(sum(r['cost_usd'] for r in result[key]), .001108)
                self.assertEqual(sum(r['unpriced_executions'] for r in result[key]), 1)
            idle = next(r for r in result['clients'] if r['client']=='idle')
            self.assertEqual((idle['cost_usd'],idle['unpriced_executions']), (0,0))
            c.close()


class AccessTests(unittest.TestCase):
    def test_client_key_cannot_read_statistics(self):
        import threading,json,urllib.request,urllib.error
        from http.server import ThreadingHTTPServer
        with tempfile.TemporaryDirectory() as root:
            old=u.KEY_FILE;u.KEY_FILE=Path(root)/'key';u.KEY_FILE.write_text('management-only')
            server=ThreadingHTTPServer(('127.0.0.1',0),u.Handler)
            t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
            try:
                for key in ['','Bearer client-key']:
                    req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/v8/management/device-usage',headers={'Authorization':key})
                    with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
                    self.assertEqual(error.exception.code,401);error.exception.close()
                req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/v8/management/device-usage?days=999',headers={'Authorization':'Bearer management-only'})
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
                self.assertEqual(error.exception.code,400);error.exception.close()
            finally:
                server.shutdown();server.server_close();u.KEY_FILE=old

class TimelineTests(unittest.TestCase):
    def test_requests_deduplicate_retries_but_tokens_keep_actual_time(self):
        import datetime as dt
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'test.db')
            events = []
            for ident, stamp, trace, key in [
                ('a', '2026-10-04T11:59:00Z', 'trace-a', 'one'),
                ('retry', '2026-10-04T12:01:00Z', 'trace-a', 'one'),
                ('b', '2026-10-04T12:02:00Z', 'trace-b', 'two'),
                ('future', '2026-10-05T12:02:00Z', 'trace-c', 'two'),
                ('old', '2026-10-02T12:02:00Z', 'trace-d', 'two'),
            ]:
                event = UsageTests().event()
                event.update(execution_id=ident, timestamp=stamp, trace_id=trace, api_key=key, failed=ident == 'retry')
                events.append(event)
            registry = {hashlib.sha256(k.encode()).hexdigest(): k for k in ['one', 'two', 'idle']}
            u.record_batch(c, events, registry)
            now = dt.datetime(2026, 10, 4, 13, tzinfo=dt.timezone.utc)
            for interval in ['5m', '1h', '1d']:
                result = u.report(c, 1, registry, interval, now)
                self.assertEqual(result['totals']['requests'], 2)
                self.assertEqual(result['totals']['executions'], 3)
                self.assertEqual(result['totals']['total'], 360)
                for metric in ['requests', 'executions', 'total', 'errors']:
                    self.assertEqual(sum(r[metric] for r in result['timeline']), result['totals'][metric])
                self.assertEqual(next(r for r in result['clients'] if r['client'] == 'idle')['requests'], 0)
                self.assertEqual(len(result['client_models']), 2)
                if interval == '1h':
                    retry = next(r for r in result['timeline'] if r['client'] == 'one' and r['bucket'] == 1791115200)
                    self.assertEqual((retry['requests'], retry['executions'], retry['total'], retry['errors']), (0, 1, 120, 1))
            c.close()

    def test_intervals_are_bounded(self):
        self.assertEqual([u.resolve_interval(d) for d in [1, 7, 30, 90]], ['5m', '1h', '1d', '1d'])
        for days, interval in [(7, '5m'), (90, '1h'), (1, 'invalid')]:
            with self.assertRaises(ValueError): u.resolve_interval(days, interval)

    def test_empty_report(self):
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'test.db')
            result = u.report(c, 1, {'hash': 'idle'})
            self.assertEqual(result['timeline'], [])
            self.assertEqual(result['clients'][0]['requests'], 0)
            self.assertEqual(result['totals']['requests'], 0)
            c.close()

if __name__=='__main__':unittest.main()
