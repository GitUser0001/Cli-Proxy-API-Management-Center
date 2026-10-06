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

class TodayTests(unittest.TestCase):
    def report_at(self, now, timezone, stamps):
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'today.db')
            registry = {hashlib.sha256(b'secret-client').hexdigest(): 'dan-macbook', 'idle': 'idle'}
            for index, stamp in enumerate(stamps):
                event = UsageTests().event()
                event.update(execution_id=str(index), trace_id='same-request',
                             timestamp=stamp, model='claude-opus-5-5')
                u.record_batch(c, [event], registry)
            result = u.report(c, 1, registry, now=now, period='today', timezone=timezone)
            c.close()
            return result

    def test_local_midnight_excludes_yesterday_and_future(self):
        import datetime as dt
        result = self.report_at(dt.datetime(2026, 10, 6, 10, tzinfo=dt.timezone.utc),
            'Europe/Kyiv', ['2026-10-05T20:59:59Z', '2026-10-05T21:00:00Z',
                            '2026-10-06T09:00:00Z', '2026-10-06T11:00:00Z'])
        self.assertEqual(result['range_start'], '2026-10-05T21:00:00.000000+00:00')
        self.assertEqual((result['period'], result['timezone']), ('today', 'Europe/Kyiv'))
        self.assertEqual((result['totals']['executions'], result['totals']['requests']), (2, 1))
        self.assertAlmostEqual(result['totals']['cost_usd'], .001108)
        self.assertEqual(sum(r['requests'] for r in result['timeline']), 1)
        self.assertEqual(next(r for r in result['clients'] if r['client'] == 'idle')['cost_usd'], 0)

    def test_fall_back_day_can_exceed_24_hours(self):
        import datetime as dt
        result = self.report_at(dt.datetime(2026, 10, 25, 21, 30, tzinfo=dt.timezone.utc),
            'Europe/Kyiv', ['2026-10-24T20:59:59Z', '2026-10-24T21:00:00Z'])
        self.assertEqual(result['range_start'], '2026-10-24T21:00:00.000000+00:00')
        self.assertEqual(result['totals']['executions'], 1)

    def test_spring_forward_and_half_hour_timezone(self):
        import datetime as dt
        for timezone, now, start in [
            ('Europe/Kyiv', dt.datetime(2026, 3, 29, 20, 30, tzinfo=dt.timezone.utc),
             '2026-03-28T22:00:00.000000+00:00'),
            ('Asia/Kolkata', dt.datetime(2026, 10, 6, 10, tzinfo=dt.timezone.utc),
             '2026-10-05T18:30:00.000000+00:00'),
        ]:
            result = self.report_at(now, timezone, [])
            self.assertEqual(result['range_start'], start)
            self.assertEqual(result['totals']['executions'], 0)

    def test_browser_legacy_timezone_name(self):
        import datetime as dt
        result = self.report_at(dt.datetime(2026, 10, 6, 10, tzinfo=dt.timezone.utc),
                                'Europe/Kiev', [])
        self.assertEqual(result['range_start'], '2026-10-05T21:00:00.000000+00:00')
        self.assertEqual(result['timezone'], 'Europe/Kiev')

    def test_invalid_today_options(self):
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'today.db')
            for days, period, timezone in [(7, 'today', 'UTC'), (1, 'yesterday', 'UTC'),
                                            (1, 'today', 'Invalid/Zone')]:
                with self.assertRaises((ValueError, u.ZoneInfoNotFoundError)):
                    u.report(c, days, {}, period=period, timezone=timezone)
            c.close()

class CalendarTests(unittest.TestCase):
    def report_at(self, now, timezone, granularity, count, stamps):
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'calendar.db')
            for index, stamp in enumerate(stamps):
                event = UsageTests().event()
                event.update(execution_id=str(index), trace_id='same', timestamp=stamp,
                             model='claude-opus-5-5')
                u.record_batch(c, [event], {})
            result = u.report(c, 90, {}, now=now, period='calendar', timezone=timezone,
                              granularity=granularity, calendar_count=count)
            c.close()
            return result

    def test_local_days_and_no_history_are_not_false_zero(self):
        import datetime as dt
        result = self.report_at(dt.datetime(2026,10,6,10,tzinfo=dt.timezone.utc),
            'Europe/Kyiv', 'day', 7, ['2026-10-04T20:59:59Z','2026-10-04T21:00:00Z',
                                   '2026-10-05T09:00:00Z','2026-10-05T21:00:00Z',
                                   '2026-10-06T11:00:00Z'])
        self.assertEqual(result['range_start'], '2026-09-29T21:00:00.000000+00:00')
        self.assertEqual([r['executions'] for r in result['series']], [0,0,0,0,1,2,1])
        self.assertEqual([r['available'] for r in result['series']], [False]*4+[True]*3)
        self.assertTrue(result['series'][4]['partial'])
        self.assertTrue(result['series'][-1]['is_current'])
        self.assertAlmostEqual(sum(r['cost_usd'] for r in result['series']), result['totals']['cost_usd'])
        # A trace is counted once within each calendar period, even if it crosses midnight.
        self.assertEqual([r['requests'] for r in result['series'][-3:]], [1,1,1])

    def test_week_monday_and_month_year_boundary(self):
        import datetime as dt
        now=dt.datetime(2026,1,6,10,tzinfo=dt.timezone.utc)
        stamps=['2025-12-28T22:00:00Z','2026-01-04T22:00:00Z','2026-01-06T09:00:00Z']
        weeks=self.report_at(now,'Europe/Kyiv','week',2,stamps)
        self.assertEqual([r['period_start'] for r in weeks['series']],['2025-12-29','2026-01-05'])
        self.assertEqual([r['executions'] for r in weeks['series']],[1,2])
        months=self.report_at(now,'Europe/Kyiv','month',2,stamps)
        self.assertEqual([r['period_start'] for r in months['series']],['2025-12-01','2026-01-01'])
        self.assertEqual([r['executions'] for r in months['series']],[1,2])
        self.assertEqual(u.shift_period(dt.date(2024,3,1),'month',-1),dt.date(2024,2,1))

    def test_dst_day_boundaries_and_half_hour_zone(self):
        import datetime as dt
        result=self.report_at(dt.datetime(2026,3,30,10,tzinfo=dt.timezone.utc),
            'Europe/Kyiv','day',2,['2026-03-28T22:00:00Z','2026-03-29T20:59:59Z','2026-03-29T21:00:00Z'])
        self.assertEqual([r['executions'] for r in result['series']],[2,1])
        result=self.report_at(dt.datetime(2026,10,6,10,tzinfo=dt.timezone.utc),
            'Asia/Kolkata','day',2,['2026-10-05T18:29:59Z','2026-10-05T18:30:00Z'])
        self.assertEqual([r['executions'] for r in result['series']],[1,1])

    def test_bucket_clients_reconcile_for_days_weeks_and_months(self):
        import datetime as dt
        with tempfile.TemporaryDirectory() as root:
            c = u.connect(Path(root) / 'calendar-clients.db')
            registry = {hashlib.sha256(key.encode()).hexdigest(): key for key in ['vm', 'laptop', 'app']}
            for index, (stamp, key, model) in enumerate([
                ('2026-10-04T20:59:59Z', 'vm', 'claude-opus-5-5'),
                ('2026-10-04T21:00:00Z', 'laptop', 'claude-opus-5-5'),
                ('2026-10-05T21:00:00Z', 'app', 'unknown-model'),
            ]):
                event = UsageTests().event()
                event.update(execution_id=str(index), timestamp=stamp, api_key=key, model=model)
                u.record_batch(c, [event], registry)
            for granularity in ['day', 'week', 'month']:
                result = u.report(c, 90, registry, now=dt.datetime(2026,10,6,10,tzinfo=dt.timezone.utc),
                    period='calendar', timezone='Europe/Kyiv', granularity=granularity, calendar_count=7 if granularity!='month' else 6)
                for bucket in result['series']:
                    for metric in ['executions','requests','input','output','total','unpriced_executions']:
                        self.assertEqual(sum(row[metric] for row in bucket['clients']), bucket[metric])
                    self.assertAlmostEqual(sum(row['cost_usd'] for row in bucket['clients']), bucket['cost_usd'])
                if granularity == 'day':
                    self.assertEqual([row['client'] for row in result['series'][-3]['clients']], ['vm'])
                    self.assertEqual([row['client'] for row in result['series'][-2]['clients']], ['laptop'])
            c.close()

    def test_empty_and_bounded_calendar(self):
        import datetime as dt
        now=dt.datetime(2026,10,6,10,tzinfo=dt.timezone.utc)
        result=self.report_at(now,'UTC','month',6,[])
        self.assertEqual(len(result['series']),6)
        self.assertTrue(all(not r['available'] for r in result['series']))
        for granularity,count in [('year',1),('day',31),('week',13),('month',0),('month',13)]:
            with self.assertRaises(ValueError):u.calendar_starts(now,'UTC',granularity,count)

if __name__=='__main__':unittest.main()
