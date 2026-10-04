import { describe, expect, test } from 'bun:test';
import {
  buildTimeline,
  csvCell,
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
