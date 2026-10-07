import { describe, expect, test } from 'bun:test';
import { todaySummary } from '../src/features/dashboard/todayUsage';
import type { DeviceUsage, UsageMetrics } from '../src/services/api/deviceUsage';

const metrics = (cost: number, requests: number): UsageMetrics => ({
  executions: requests,
  requests,
  errors: 0,
  input: 100,
  output: 10,
  total: 110,
  cache_read: 0,
  cache_write: 0,
  reasoning: 0,
  latency_ms: 10,
  incomplete: 0,
  cost_usd: cost,
  unpriced_executions: 0,
});
const fixture = (clients: DeviceUsage['clients']): DeviceUsage => ({
  days: 1,
  period: 'today',
  timezone: 'Europe/Kyiv',
  totals: metrics(100, 100),
  clients,
  models: [],
  daily: [],
  collector: {},
});

describe('dashboard today summary', () => {
  test('sorts people and scales bars by the upper estimate while retaining both totals', () => {
    const result = todaySummary(
      fixture([
        { ...metrics(2, 1), cost_usd_max: 4, client: 'dan-macbook' },
        { ...metrics(3, 1), cost_usd_max: 3, client: 'devbox-dplokhuta' },
        { ...metrics(1, 1), cost_usd_max: 2, client: 'hermes-work-1' },
      ])
    );
    expect(result.people.map((row) => row.name)).toEqual(['Dan', 'Dima', 'Denis', 'Hlib']);
    expect(result.maxCost).toBe(4);
    expect(result.total.cost_usd).toBe(5);
    expect(result.total.cost_usd_max).toBe(7);
    expect(result.apps.cost_usd_max).toBe(2);
  });
  test('combines devices and keeps app spend out of the people total', () => {
    const result = todaySummary(
      fixture([
        { ...metrics(4, 2), client: 'dan-macbook' },
        { ...metrics(3, 1), client: 'devbox-dshcherbak' },
        { ...metrics(1, 1), client: 'laptop-dplokhuta' },
        { ...metrics(2, 2), client: 'devbox-dplokhuta' },
        { ...metrics(20, 9), client: 'hermes-work-1' },
      ])
    );
    expect(result.people.map((row) => row.name)).toEqual(['Dan', 'Dima', 'Denis', 'Hlib']);
    expect(result.people[0].cost_usd).toBe(7);
    expect(result.people[0].requests).toBe(3);
    expect(result.total.cost_usd).toBe(10);
    expect(result.apps.cost_usd).toBe(20);
    expect(result.maxCost).toBe(7);
  });

  test('zero activity still shows all four people with actual zero values', () => {
    const result = todaySummary(fixture([]));
    expect(result.people).toHaveLength(4);
    expect(result.people.every((row) => row.cost_usd === 0 && row.requests === 0)).toBe(true);
    expect(result.maxCost).toBe(0);
  });

  test('preserves missing and partial prices instead of assigning zero spend', () => {
    const missing = { ...metrics(0, 2), cost_usd: undefined, unpriced_executions: undefined };
    const result = todaySummary(
      fixture([
        { ...missing, client: 'devbox-dlukianenko' },
        { ...metrics(1, 3), unpriced_executions: 1, client: 'dan-macbook' },
      ])
    );
    expect(result.people.find((row) => row.name === 'Denis')?.cost_usd).toBeUndefined();
    expect(result.people.find((row) => row.name === 'Dan')?.unpriced_executions).toBe(1);
    expect(result.total.cost_usd).toBeUndefined();
  });
});
