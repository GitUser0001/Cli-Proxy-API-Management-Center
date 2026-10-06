import type { DeviceUsage } from '@/services/api/deviceUsage';
import { axisMax } from './utils';
import { personForClient, personNames, sumMetrics } from '@/features/deviceUsage/timeline';

export type CalendarMetric = 'cost' | 'requests' | 'tokens';
export type CalendarBucket = NonNullable<DeviceUsage['series']>[number];

export function calendarValue(
  row: Pick<
    CalendarBucket,
    'available' | 'cost_usd' | 'executions' | 'unpriced_executions' | 'requests' | 'total'
  >,
  metric: CalendarMetric
): number | null {
  if (!row.available) return null;
  if (metric === 'cost') {
    return row.cost_usd === undefined ||
      (row.executions > 0 && row.unpriced_executions === row.executions)
      ? null
      : row.cost_usd;
  }
  return metric === 'requests' ? row.requests : row.total;
}

export function calendarScale(peak: number, metric: CalendarMetric): number {
  if (metric !== 'cost') return axisMax(peak, 4);
  if (peak <= 0) return 1;
  const rawStep = peak / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 5, 10].find((n) => n * power >= rawStep)! * power;
  return step * 4;
}

// Stable people order; VM and laptop usage sum within the exact local calendar bucket.
export function calendarPeople(row?: CalendarBucket) {
  const clients = row?.clients;
  const available = Boolean(row?.available && clients);
  const people = personNames.map((name, index) => ({
    ...sumMetrics((clients ?? []).filter((client) => personForClient(client.client) === name)),
    name,
    colorIndex: index,
    available,
  }));
  return [
    ...people,
    {
      ...sumMetrics(
        (clients ?? []).filter(
          (client) => !personNames.some((name) => name === personForClient(client.client))
        )
      ),
      name: 'apps',
      colorIndex: 4,
      available,
    },
  ];
}
