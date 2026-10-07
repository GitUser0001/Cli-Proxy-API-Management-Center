import { personModelRows } from '../src/features/deviceUsage/breakdown';
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
  test('combines each new laptop with its owner across cards, models, timeline and CSV', () => {
    const bucket = data.timeline![0].bucket;
    for (const [user, person] of [
      ['dplokhuta', 'Dima'],
      ['dlukianenko', 'Denis'],
      ['hhodovaniuk', 'Hlib'],
    ]) {
      const clients = [
        { ...metrics(3, 90), client: `devbox-${user}`, cost_usd: 0.75, unpriced_executions: 0 },
        { ...metrics(2, 60), client: `laptop-${user}`, cost_usd: 1.25, unpriced_executions: 1 },
        { ...metrics(1, 20), client: 'portal-demo-app', cost_usd: 0.25, unpriced_executions: 0 },
      ];
      const raw: DeviceUsage = {
        ...data,
        totals: sumMetrics(clients),
        clients,
        timeline: clients.map((row) => ({ ...row, bucket })),
        client_models: clients.map((row) => ({ ...row, provider: 'claude', model: 'm' })),
      };
      const grouped = groupUsageByPerson(raw);
      expect(grouped.clients.map((row) => row.client)).toEqual([person, 'portal-demo-app']);
      expect(grouped.totals).toEqual(raw.totals);
      expect(sumMetrics(grouped.clients)).toEqual(raw.totals);
      expect(buildTimeline(grouped, [person], 'requests')[0].total).toBe(5);
      expect(modelRows(grouped, [person])[0].total).toBe(150);
      const card = personModelRows(grouped, [person])![0];
      expect(card.requests).toBe(5);
      expect(card.cost_usd).toBe(2);
      expect(card.unpriced_executions).toBe(1);
      expect(card.models[0].requests).toBe(5);
      expect(card.providers[0].executions).toBe(5);
      const csv = timelineCsv(grouped, [person]);
      expect(csv).toContain(`"${person}","5","150","0"`);
      expect(csv).not.toContain(`laptop-${user}`);
      expect(raw.clients[1].client).toBe(`laptop-${user}`);
    }
  });
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
  test('preserves image ranges through people/model filters and rounds outward', () => {
    const image = {
      ...metrics(1),
      cost_usd: 0.491865,
      cost_usd_max: 0.535272,
      image_estimated_executions: 1,
      unpriced_executions: 0,
      client: 'dan-macbook',
      provider: 'codex',
      model: 'gpt-image-2',
    };
    const text = {
      ...image,
      client: 'devbox-dshcherbak',
      cost_usd: 1,
      cost_usd_max: 1,
      image_estimated_executions: 0,
      model: 'gpt-6.1-sol',
    };
    const grouped = groupUsageByPerson({
      ...data,
      clients: [image, text],
      client_models: [image, text],
    });
    const dan = grouped.clients[0];
    expect(dan.cost_usd).toBeCloseTo(1.491865);
    expect(dan.cost_usd_max).toBeCloseTo(1.535272);
    expect(dan.image_estimated_executions).toBe(1);
    expect(formatCost(dan, 'en-US')).toBe('≈$1.54');
    expect(formatCost(dan, 'en-US', true)).toBe('≈$1.49–$1.54');
    expect(
      formatCost(
        modelRows(grouped, ['Dan']).find((r) => r.model === 'gpt-image-2')!,
        'en-US',
        true
      )
    ).toBe('≈$0.49–$0.54');
    expect(modelRows(grouped, ['Denis'])).toEqual([]);
    expect(formatCost({ ...image, unpriced_executions: 0 }, 'en-US')).toBe('≈$0.54');
    expect(formatCost({ ...image, executions: 2, unpriced_executions: 1 }, 'en-US')).toBe(
      '≈$0.54*'
    );
    expect(formatCost({ ...image, cost_usd: 0.001, cost_usd_max: 0.002 }, 'en-US')).toBe('≈$0.01');
    expect(formatCost({ ...image, cost_usd: 1.5, cost_usd_max: 1.5 }, 'en-US')).toBe('≈$1.50');
    expect(sumMetrics([]).cost_usd_max).toBe(0);
    expect(sumMetrics([metrics(1)]).cost_usd_max).toBeUndefined();
  });
});

describe('People, providers and models', () => {
  test('keeps exact person request totals and bases provider shares on attempts', () => {
    const person = { ...metrics(2, 300), executions: 3, client: 'Dan' };
    const rows = [
      { ...metrics(2, 200), client: 'Dan', provider: 'claude', model: 'shared-name' },
      { ...metrics(1, 100), client: 'Dan', provider: 'codex', model: 'shared-name' },
      { ...metrics(4, 400), client: 'Denis', provider: 'claude', model: 'other' },
    ];
    const result = personModelRows({ ...data, clients: [person], client_models: rows }, ['Dan'])!;
    expect(result).toHaveLength(1);
    expect(result[0].requests).toBe(2);
    expect(result[0].models).toHaveLength(2);
    expect(result[0].providers.map((p) => p.share)).toEqual([2 / 3, 1 / 3]);
    expect(result[0].providers.map((p) => p.executions)).toEqual([2, 1]);
    expect(result[0].models.map((r) => r.provider)).toEqual(['claude', 'codex']);
    expect(rows[2].client).toBe('Denis');
  });
  test('combines both Dan devices before breakdown and handles idle/legacy/empty selection', () => {
    const mac = { ...metrics(2, 200), client: 'dan-macbook', provider: 'claude', model: 'm' };
    const vm = { ...metrics(1, 100), client: 'devbox-dshcherbak', provider: 'claude', model: 'm' };
    const idle = { ...metrics(), client: 'idle' };
    const grouped = groupUsageByPerson({
      ...data,
      clients: [mac, vm, idle],
      client_models: [mac, vm],
    });
    const result = personModelRows(grouped, ['Dan', 'idle'])!;
    expect(result[0].models[0].requests).toBe(3);
    expect(result[0].providers[0].share).toBe(1);
    expect(result[1].models).toEqual([]);
    expect(personModelRows(grouped, [])).toEqual([]);
    expect(personModelRows(data, ['Dan'])).toBeUndefined();
  });
});
