import { formatCost } from '../src/features/deviceUsage/cost';
import { describe, expect, test } from 'bun:test';
import {
  buildTimeline,
  csvCell,
  groupUsageByPerson,
  intervalAllowed,
  modelRows,
  sumMetrics,
  timelineCsv,
} from '../src/features/deviceUsage/timeline';
import type { DeviceUsage, UsageMetrics } from '../src/services/api/deviceUsage';

const metrics = (requests = 0, total = 0): UsageMetrics => ({
  requests,
  total,
  executions: requests,
  errors: 0,
  input: 0,
  output: 0,
  cache_read: 0,
  cache_write: 0,
  reasoning: 0,
  latency_ms: 0,
  incomplete: 0,
});
const data: DeviceUsage = {
  days: 1,
  totals: metrics(3, 90),
  clients: [],
  models: [],
  daily: [],
  collector: {},
  range_start: '2026-10-04T10:02:00Z',
  range_end: '2026-10-04T10:13:00Z',
  bucket_seconds: 300,
  interval: '5m',
  timeline: [
    { ...metrics(1, 30), bucket: Date.parse('2026-10-04T10:00:00Z') / 1000, client: 'alice' },
    { ...metrics(2, 60), bucket: Date.parse('2026-10-04T10:10:00Z') / 1000, client: 'bob' },
  ],
};
describe('Device usage time series', () => {
  test('fills silent intervals and inactive users with zero and filters independently', () => {
    const result = buildTimeline(data, ['alice', 'bob', 'idle'], 'requests');
    expect(result.map((p) => p.values)).toEqual([
      [1, 0, 0],
      [0, 0, 0],
      [0, 2, 0],
    ]);
    expect(buildTimeline(data, ['bob'], 'total').map((p) => p.total)).toEqual([0, 0, 60]);
    expect(buildTimeline(data, [], 'requests').every((p) => p.total === 0)).toBe(true);
  });
  test('handles older collectors and rejects invalid or excessive ranges', () => {
    expect(buildTimeline({ ...data, timeline: undefined }, ['alice'], 'requests')).toEqual([]);
    expect(buildTimeline({ ...data, range_end: '2027-10-04' }, [], 'requests')).toEqual([]);
    expect(buildTimeline({ ...data, range_start: 'invalid' }, [], 'requests')).toEqual([]);
    expect(intervalAllowed(30, '1h')).toBe(true);
    expect(intervalAllowed(90, '1h')).toBe(false);
    expect(intervalAllowed(7, '5m')).toBe(false);
  });
  test('combines latency with attempt weighting and applies model filters', () => {
    const a = { ...metrics(1, 30), latency_ms: 100, provider: 'p', model: 'm', client: 'alice' };
    const b = { ...metrics(3, 90), latency_ms: 200, provider: 'p', model: 'm', client: 'bob' };
    expect(sumMetrics([a, b]).latency_ms).toBe(175);
    expect(modelRows({ ...data, client_models: [a, b] }, ['bob'])[0].total).toBe(90);
    expect(modelRows({ ...data, client_models: [a, b] }, [])).toEqual([]);
  });
  test('CSV uses the selected clients, UTC, partial edges, and formula-safe labels', () => {
    const csv = timelineCsv(data, ['alice']);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv).toContain('2026-10-04T10:02:00.000Z');
    expect(csv).toContain('2026-10-04T10:13:00.000Z');
    expect(csv).not.toContain('bob');
    expect(csvCell('=cmd()')).toBe('"\'=cmd()"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});

describe('Device usage grouped by person', () => {
  test('combines Dan across devices in totals, overlapping buckets, model filters and CSV', () => {
    const bucket = data.timeline![0].bucket;
    const mac = { ...metrics(2, 60), latency_ms: 100, client: 'dan-macbook' };
    const vm = { ...metrics(3, 90), latency_ms: 200, client: 'devbox-dshcherbak' };
    const app = { ...metrics(1, 20), client: 'dan-test-app' };
    const raw: DeviceUsage = {
      ...data,
      totals: metrics(6, 170),
      clients: [mac, vm, app],
      timeline: [mac, vm, app].map((r) => ({ ...r, bucket })),
      client_models: [mac, vm, app].map((r) => ({ ...r, provider: 'p', model: 'm' })),
    };
    const grouped = groupUsageByPerson(raw);
    expect(grouped.clients.map((r) => r.client)).toEqual(['Dan', 'dan-test-app']);
    expect(grouped.clients[0].requests).toBe(5);
    expect(grouped.clients[0].total).toBe(150);
    expect(grouped.clients[0].latency_ms).toBe(160);
    expect(grouped.totals).toEqual(raw.totals);
    expect(buildTimeline(grouped, ['Dan'], 'requests').map((r) => r.total)).toEqual([5, 0, 0]);
    expect(modelRows(grouped, ['Dan'])[0].total).toBe(150);
    expect(timelineCsv(grouped, ['Dan'])).toContain('"Dan","5","150","0"');
    expect(timelineCsv(grouped, ['Dan'])).not.toContain('dan-test-app');
    expect(raw.clients[0].client).toBe('dan-macbook');
    expect(raw.timeline).toHaveLength(3);
  });
  test('maps all four people and preserves unknown clients and legacy responses', () => {
    const clients = [
      'devbox-dlukianenko',
      'devbox-hhodovaniuk',
      'devbox-dplokhuta',
      'new-device',
      'constructor',
    ];
    const grouped = groupUsageByPerson({
      ...data,
      timeline: undefined,
      clients: clients.map((client) => ({ ...metrics(), client })),
    });
    expect(grouped.clients.map((r) => r.client)).toEqual([
      'Denis',
      'Hlib',
      'Dima',
      'new-device',
      'constructor',
    ]);
    expect(grouped.timeline).toBeUndefined();
    expect(grouped.client_models).toBeUndefined();
  });
});

describe('API cost estimates', () => {
  test('preserves price coverage through people and model filters', () => {
    const mac = {
      ...metrics(2, 20),
      client: 'dan-macbook',
      cost_usd: 1.25,
      unpriced_executions: 1,
    };
    const vm = {
      ...metrics(1, 10),
      client: 'devbox-dshcherbak',
      cost_usd: 0.75,
      unpriced_executions: 0,
    };
    const other = {
      ...metrics(1, 10),
      client: 'devbox-dlukianenko',
      cost_usd: 4,
      unpriced_executions: 0,
    };
    const grouped = groupUsageByPerson({
      ...data,
      clients: [mac, vm, other],
      client_models: [mac, vm, other].map((r) => ({ ...r, provider: 'claude', model: 'm' })),
    });
    const dan = grouped.clients.find((r) => r.client === 'Dan')!;
    expect(dan.cost_usd).toBe(2);
    expect(dan.unpriced_executions).toBe(1);
    expect(modelRows(grouped, ['Dan'])[0].cost_usd).toBe(2);
    expect(sumMetrics([]).cost_usd).toBe(0);
    expect(sumMetrics([mac, metrics(1)]).cost_usd).toBeUndefined();
  });
  test('distinguishes unknown, partial, tiny and zero cost', () => {
    const row = { ...metrics(2), cost_usd: 1.5, unpriced_executions: 0 };
    expect(formatCost(row, 'en-US')).toBe('≈$1.50');
    expect(formatCost({ ...row, unpriced_executions: 1 }, 'en-US')).toBe('≈$1.50*');
    expect(formatCost({ ...row, unpriced_executions: 2 }, 'en-US')).toBe('—');
    expect(formatCost(metrics(1), 'en-US')).toBe('—');
    expect(formatCost({ ...row, cost_usd: 0.001 }, 'en-US')).toBe('<$0.01');
    expect(formatCost({ ...row, cost_usd: 0 }, 'en-US')).toBe('≈$0.00');
  });
});
