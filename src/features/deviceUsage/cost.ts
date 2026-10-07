import type { UsageMetrics } from '@/services/api/deviceUsage';
import type { TFunction } from 'i18next';

export function costTitle(row: UsageMetrics, t: TFunction): string {
  const notes = [
    row.unpriced_executions
      ? t('device_usage.cost_unpriced', { count: row.unpriced_executions })
      : t('dashboard.today_estimate'),
  ];
  if (row.image_estimated_executions) notes.push(t('device_usage.cost_image_range'));
  return notes.join(' ');
}

export function costValue(
  row: Pick<UsageMetrics, 'cost_usd' | 'cost_usd_max' | 'executions' | 'unpriced_executions'>
): number | undefined {
  if (
    row.cost_usd === undefined ||
    (row.executions > 0 && row.unpriced_executions === row.executions)
  )
    return undefined;
  return row.cost_usd_max ?? row.cost_usd;
}

export function formatCost(row: UsageMetrics, locale: string, showRange = false): string {
  const estimate = costValue(row);
  if (estimate === undefined) return '—';
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  if (row.cost_usd_max !== undefined && row.cost_usd_max > row.cost_usd!) {
    // Round outward so even sub-cent ranges remain visible, without false precision.
    const low = Math.floor(row.cost_usd! * 100 + 1e-8) / 100;
    const high = Math.ceil(row.cost_usd_max * 100 - 1e-8) / 100;
    return (
      (showRange ? `≈${usd.format(low)}–${usd.format(high)}` : `≈${usd.format(high)}`) +
      (row.unpriced_executions ? '*' : '')
    );
  }
  const value =
    estimate > 0 && estimate < 0.01 ? `<${usd.format(0.01)}` : `≈${usd.format(estimate)}`;
  return value + (row.unpriced_executions ? '*' : '');
}
