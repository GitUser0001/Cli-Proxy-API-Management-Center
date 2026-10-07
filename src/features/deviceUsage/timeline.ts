import type { DeviceUsage, UsageMetrics } from '@/services/api/deviceUsage';

export type Metric = 'requests' | 'total' | 'errors';
export type Interval = 'auto' | '5m' | '1h' | '1d';
export const intervals: Interval[] = ['auto', '5m', '1h', '1d'];
export const colors = ['#3978cf', '#d78129', '#218f83', '#aa65bf', '#d45d75', '#809332', '#777b8d'];
export const colorFor = (index: number) => colors[index % colors.length];
export const intervalAllowed = (days: number, interval: Interval) =>
  interval === 'auto' || (days * 86400) / { '5m': 300, '1h': 3600, '1d': 86400 }[interval] <= 744;

export function sumMetrics(rows: UsageMetrics[]): UsageMetrics {
  const result = {
    executions: 0,
    requests: 0,
    errors: 0,
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    reasoning: 0,
    total: 0,
    latency_ms: 0,
    incomplete: 0,
  };
  for (const row of rows) {
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      result[key] += key === 'latency_ms' ? row[key] * row.executions : row[key];
    }
  }
  const priced: Pick<
    UsageMetrics,
    'cost_usd' | 'cost_usd_max' | 'image_estimated_executions' | 'unpriced_executions'
  > = {};
  if (rows.every((row) => row.cost_usd !== undefined && row.unpriced_executions !== undefined)) {
    priced.cost_usd = rows.reduce((sum, row) => sum + row.cost_usd!, 0);
    priced.unpriced_executions = rows.reduce((sum, row) => sum + row.unpriced_executions!, 0);
    if (rows.every((row) => row.cost_usd_max !== undefined)) {
      priced.cost_usd_max = rows.reduce((sum, row) => sum + row.cost_usd_max!, 0);
    }
    if (rows.every((row) => row.image_estimated_executions !== undefined)) {
      priced.image_estimated_executions = rows.reduce(
        (sum, row) => sum + row.image_estimated_executions!,
        0
      );
    }
  }
  result.latency_ms = result.executions ? result.latency_ms / result.executions : 0;
  return { ...result, ...priced };
}

// Presentation-only aliases: keep the collector's per-key history and registry intact.
const people: Readonly<Record<string, string>> = {
  'dan-macbook': 'Dan',
  'devbox-dshcherbak': 'Dan',
  'devbox-dlukianenko': 'Denis',
  'laptop-dlukianenko': 'Denis',
  'devbox-hhodovaniuk': 'Hlib',
  'laptop-hhodovaniuk': 'Hlib',
  'devbox-dplokhuta': 'Dima',
  'laptop-dplokhuta': 'Dima',
};

export const personNames = ['Dan', 'Denis', 'Hlib', 'Dima'] as const;

export const personForClient = (client: string) =>
  Object.prototype.hasOwnProperty.call(people, client) ? people[client] : client;

export function groupUsageByPerson(data: DeviceUsage): DeviceUsage {
  function group<T extends UsageMetrics & { client: string }>(
    rows: T[],
    key: (row: T) => string
  ): T[] {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const renamed = { ...row, client: personForClient(row.client) };
      const id = key(renamed);
      const values = groups.get(id);
      if (values) values.push(renamed);
      else groups.set(id, [renamed]);
    }
    return [...groups.values()].map((rows) => ({ ...rows[0], ...sumMetrics(rows) }));
  }
  return {
    ...data,
    clients: group(data.clients, (row) => row.client).sort((a, b) => b.total - a.total),
    timeline:
      data.timeline && group(data.timeline, (row) => JSON.stringify([row.bucket, row.client])),
    client_models:
      data.client_models &&
      group(data.client_models, (row) => JSON.stringify([row.client, row.provider, row.model])),
  };
}

export function modelRows(data: DeviceUsage, selected: string[]) {
  if (!data.client_models) return data.models;
  const groups = new Map<string, (UsageMetrics & { provider: string; model: string })[]>();
  for (const row of data.client_models) {
    if (!selected.includes(row.client)) continue;
    const key = JSON.stringify([row.provider, row.model]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()]
    .map((rows) => ({ ...sumMetrics(rows), provider: rows[0].provider, model: rows[0].model }))
    .sort((a, b) => b.total - a.total);
}

export function buildTimeline(data: DeviceUsage, clients: string[], metric: Metric) {
  if (!data.range_start || !data.range_end || !data.bucket_seconds || !data.timeline) return [];
  const step = data.bucket_seconds;
  const start = Math.floor(Date.parse(data.range_start) / 1000 / step) * step;
  const end = Math.floor(Date.parse(data.range_end) / 1000 / step) * step;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / step > 744)
    return [];
  const rows = new Map(data.timeline.map((row) => [JSON.stringify([row.bucket, row.client]), row]));
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, index) => {
    const bucket = start + index * step;
    const values = clients.map(
      (client) => rows.get(JSON.stringify([bucket, client]))?.[metric] ?? 0
    );
    return { bucket, values, total: values.reduce((a, b) => a + b, 0) };
  });
}

// Prefix text cells so exported client labels cannot become spreadsheet formulas.
export function csvCell(value: string | number) {
  const text = String(value);
  return `"${(typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
}

export function timelineCsv(data: DeviceUsage, clients: string[]) {
  const requests = buildTimeline(data, clients, 'requests');
  const tokens = buildTimeline(data, clients, 'total');
  const errors = buildTimeline(data, clients, 'errors');
  return [
    [
      'bucket_start_utc',
      'bucket_end_utc',
      'person_or_app',
      'requests',
      'total_tokens',
      'failed_attempts',
    ],
    ...requests.flatMap((point, i) =>
      clients.map((client, j) => [
        new Date(Math.max(point.bucket * 1000, Date.parse(data.range_start!))).toISOString(),
        new Date(
          Math.min((point.bucket + data.bucket_seconds!) * 1000, Date.parse(data.range_end!))
        ).toISOString(),
        client,
        point.values[j],
        tokens[i].values[j],
        errors[i].values[j],
      ])
    ),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
