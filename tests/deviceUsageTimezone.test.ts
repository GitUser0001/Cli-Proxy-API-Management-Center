import { describe, expect, test } from 'bun:test';
import { chartTimezone, formatChartTime } from '../src/features/deviceUsage/timezone';

const seconds = (date: string) => Date.parse(date) / 1000;

describe('Device usage chart timezone', () => {
  test('detects the browser zone and supports explicit UTC', () => {
    expect(chartTimezone('local')).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(chartTimezone('utc')).toBe('UTC');
  });

  test('formats the same chart point in Kyiv or UTC, including interval offsets', () => {
    const time = seconds('2026-10-05T10:00:00Z');
    expect(formatChartTime(time, 'en-GB', 'Europe/Kyiv', 300)).toContain('13:00');
    expect(formatChartTime(time, 'en-GB', 'UTC', 300)).toContain('10:00');
    expect(formatChartTime(time, 'en-GB', 'Europe/Kyiv', 300, true)).toContain('GMT+3');
  });

  test('distinguishes repeated DST hours and follows the timestamp’s offset', () => {
    const before = formatChartTime(
      seconds('2026-10-25T00:30:00Z'),
      'en-GB',
      'Europe/Kyiv',
      3600,
      true
    );
    const after = formatChartTime(
      seconds('2026-10-25T01:30:00Z'),
      'en-GB',
      'Europe/Kyiv',
      3600,
      true
    );
    expect(before).toContain('03:30');
    expect(after).toContain('03:30');
    expect(before).toContain('GMT+3');
    expect(after).toContain('GMT+2');
  });
});
