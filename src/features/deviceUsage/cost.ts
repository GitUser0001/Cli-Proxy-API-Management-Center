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

export function formatCost(row: UsageMetrics, locale: string): string {
  if (
    row.cost_usd === undefined ||
    (row.executions > 0 && row.unpriced_executions === row.executions)
  )
    return '—';
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  if (row.cost_usd_max !== undefined && row.cost_usd_max > row.cost_usd) {
    // Round outward so even sub-cent ranges remain visible, without false precision.
    const low = Math.floor(row.cost_usd * 100 + 1e-8) / 100;
    const high = Math.ceil(row.cost_usd_max * 100 - 1e-8) / 100;
    return `≈${usd.format(low)}–${usd.format(high)}` + (row.unpriced_executions ? '*' : '');
  }
  const value =
    row.cost_usd > 0 && row.cost_usd < 0.01
      ? `<${usd.format(0.01)}`
      : `≈${usd.format(row.cost_usd)}`;
  return value + (row.unpriced_executions ? '*' : '');
}
