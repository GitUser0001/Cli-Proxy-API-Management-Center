import { expect, test } from 'bun:test';
import {
  calendarScale,
  calendarValue,
  type CalendarBucket,
} from '../src/features/dashboard/calendarUsage';
const row: CalendarBucket = {
  period_start: '2026-10-06',
  available: true,
  is_current: true,
  partial: true,
  executions: 2,
  requests: 1,
  errors: 1,
  input: 90,
  output: 10,
  total: 100,
  cache_read: 0,
  cache_write: 0,
  reasoning: 0,
  latency_ms: 0,
  incomplete: 0,
  cost_usd: 0.0001,
  unpriced_executions: 0,
};
test('calendar chart separates missing history and unknown pricing from real zero', () => {
  expect(calendarValue({ ...row, available: false }, 'requests')).toBeNull();
  expect(calendarValue({ ...row, unpriced_executions: 2 }, 'cost')).toBeNull();
  expect(calendarValue({ ...row, cost_usd: undefined }, 'cost')).toBeNull();
  expect(calendarValue({ ...row, unpriced_executions: 1 }, 'cost')).toBe(0.0001);
  expect(calendarValue({ ...row, requests: 0 }, 'requests')).toBe(0);
  expect(calendarValue(row, 'tokens')).toBe(100);
});
test('calendar dollar scale keeps sub-cent usage visible', () => {
  expect(calendarScale(0.0001, 'cost')).toBeGreaterThanOrEqual(0.0001);
  expect(calendarScale(0.0001, 'cost')).toBeLessThan(0.01);
  expect(calendarScale(163, 'cost')).toBe(200);
  expect(calendarScale(0, 'cost')).toBe(1);
  expect(calendarScale(79, 'requests')).toBe(80);
});
