import { expect, test } from 'bun:test';
import {
  calendarPeople,
  calendarScale,
  calendarStack,
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

test('stacked calendar bars preserve person colors and upper image contributions', () => {
  const bucket = {
    ...row,
    cost_usd: 4,
    cost_usd_max: 8,
    clients: [
      { ...row, client: 'dan-macbook', cost_usd: 1, cost_usd_max: 3 },
      { ...row, client: 'devbox-dshcherbak', cost_usd: 1, cost_usd_max: 2 },
      { ...row, client: 'portal-demo-app', cost_usd: 2, cost_usd_max: 3 },
    ],
  };
  const stack = calendarStack(bucket, 'cost');
  expect(stack.map(({ name, colorIndex }) => [name, colorIndex])).toEqual([
    ['Dan', 0],
    ['Denis', 1],
    ['Hlib', 2],
    ['Dima', 3],
    ['apps', 4],
  ]);
  expect(stack[0].share).toBe(5 / 8);
  expect(stack[4].share).toBe(3 / 8);
  expect(stack.reduce((sum, person) => sum + person.share, 0)).toBe(1);
});

test('stacked calendar bars leave missing breakdowns and unknown prices uncolored', () => {
  expect(calendarStack(row, 'cost').every((person) => person.share === 0)).toBe(true);
  expect(
    calendarStack({ ...row, available: false, clients: [] }, 'tokens').every(
      (person) => person.value === null && person.share === 0
    )
  ).toBe(true);
  const partial = calendarStack(
    {
      ...row,
      cost_usd: 4,
      clients: [
        { ...row, client: 'dan-macbook', cost_usd: 1 },
        { ...row, client: 'portal-demo-app', cost_usd: undefined },
      ],
    },
    'cost'
  );
  expect(partial[0].share).toBe(0.25);
  expect(partial[4].value).toBeNull();
  expect(partial[4].share).toBe(0);
});

test('stacked calendar bars stay finite for idle and repeated cross-client requests', () => {
  const idle = calendarStack({ ...row, requests: 0, clients: [] }, 'requests');
  expect(idle.every((person) => person.value === 0 && person.share === 0)).toBe(true);
  const overlap = calendarStack(
    {
      ...row,
      clients: [
        { ...row, client: 'dan-macbook' },
        { ...row, client: 'portal-demo-app' },
      ],
    },
    'requests'
  );
  expect(overlap[0].share).toBe(0.5);
  expect(overlap[4].share).toBe(0.5);
});
test('calendar dollar scale keeps sub-cent usage visible', () => {
  expect(calendarScale(0.0001, 'cost')).toBeGreaterThanOrEqual(0.0001);
  expect(calendarScale(0.0001, 'cost')).toBeLessThan(0.01);
  expect(calendarScale(163, 'cost')).toBe(200);
  expect(calendarScale(0, 'cost')).toBe(1);
  expect(calendarScale(79, 'requests')).toBe(80);
});

test('calendar bars and people shares use upper image estimates', () => {
  const image = { ...row, cost_usd: 2, cost_usd_max: 4, image_estimated_executions: 1 };
  expect(calendarValue(image, 'cost')).toBe(4);
  expect(calendarValue({ ...image, unpriced_executions: 2 }, 'cost')).toBeNull();
  expect(calendarValue({ ...image, available: false }, 'cost')).toBeNull();
  const people = calendarPeople({
    ...image,
    clients: [
      { ...image, client: 'dan-macbook' },
      { ...image, cost_usd: 3, cost_usd_max: 3, client: 'devbox-dshcherbak' },
    ],
  });
  expect(calendarValue(people[0], 'cost')).toBe(7);
});

test('calendar breakdown groups laptop and VM people and keeps apps separate', () => {
  const bucket = {
    ...row,
    clients: [
      { ...row, client: 'devbox-dplokhuta', cost_usd: 2 },
      { ...row, client: 'laptop-dplokhuta', cost_usd: 3 },
      { ...row, client: 'portal-demo-app', cost_usd: 4 },
    ],
  };
  const people = calendarPeople(bucket);
  expect(people.map((person) => person.name)).toEqual(['Dan', 'Denis', 'Hlib', 'Dima', 'apps']);
  expect(people[3].cost_usd).toBe(5);
  expect(people[3].requests).toBe(2);
  expect(people[4].cost_usd).toBe(4);
  expect(people.reduce((sum, person) => sum + person.cost_usd!, 0)).toBe(9);
  expect(people[0].cost_usd).toBe(0);
});
test('absent bucket breakdown and missing history never imply zero usage', () => {
  expect(calendarPeople().every((person) => !person.available)).toBe(true);
  expect(calendarPeople(row).every((person) => !person.available)).toBe(true);
  expect(
    calendarPeople({ ...row, available: false, clients: [] }).every((person) => !person.available)
  ).toBe(true);
  expect(
    calendarPeople({ ...row, clients: [] }).every(
      (person) => person.available && person.cost_usd === 0
    )
  ).toBe(true);
});
