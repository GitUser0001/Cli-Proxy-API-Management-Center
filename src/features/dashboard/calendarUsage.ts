import type { DeviceUsage } from '@/services/api/deviceUsage';
import { axisMax } from './utils';

export type CalendarMetric = 'cost' | 'requests' | 'tokens';
export type CalendarBucket = NonNullable<DeviceUsage['series']>[number];

export function calendarValue(row: CalendarBucket, metric: CalendarMetric): number | null {
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
