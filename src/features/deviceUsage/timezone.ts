export type ChartTimezone = 'local' | 'utc';

export function chartTimezone(preference: ChartTimezone): string {
  return preference === 'utc' ? 'UTC' : new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatChartTime(
  seconds: number,
  locale: string,
  timeZone: string,
  bucketSeconds: number,
  full = false
): string {
  return new Date(seconds * 1000).toLocaleString(locale, {
    timeZone,
    month: 'short',
    day: 'numeric',
    ...(full || bucketSeconds < 86400
      ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const)
      : {}),
    ...(full ? { timeZoneName: 'shortOffset' as const } : {}),
  });
}
