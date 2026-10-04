import type { UsageMetrics } from '@/services/api/deviceUsage';

export function formatCost(row: UsageMetrics, locale: string): string {
  if (
    row.cost_usd === undefined ||
    (row.executions > 0 && row.unpriced_executions === row.executions)
  )
    return '—';
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const value =
    row.cost_usd > 0 && row.cost_usd < 0.01
      ? `<${usd.format(0.01)}`
      : `≈${usd.format(row.cost_usd)}`;
  return value + (row.unpriced_executions ? '*' : '');
}
