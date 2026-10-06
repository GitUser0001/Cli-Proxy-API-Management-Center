import { apiClient } from './client';

export type CalendarGranularity = 'day' | 'week' | 'month';

export interface UsageMetrics {
  executions: number;
  requests: number;
  errors: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  total: number;
  latency_ms: number;
  incomplete: number;
  cost_usd?: number;
  unpriced_executions?: number;
}
export interface DeviceUsage {
  days: number;
  period?: 'rolling' | 'today' | 'calendar';
  granularity?: CalendarGranularity;
  calendar_count?: number;
  history_start?: string | null;
  series?: (UsageMetrics & {
    period_start: string;
    available: boolean;
    is_current: boolean;
    partial: boolean;
  })[];
  timezone?: string;
  pricing?: { as_of: string; currency: string; basis: string };
  totals: UsageMetrics;
  clients: (UsageMetrics & { client: string })[];
  models: (UsageMetrics & { provider: string; model: string })[];
  daily: (UsageMetrics & { day: string })[];
  collector: { started_at?: string; last_poll?: string; rejected?: string };
  client_models?: (UsageMetrics & { client: string; provider: string; model: string })[];
  timeline?: (UsageMetrics & { bucket: number; client: string })[];
  interval?: string;
  bucket_seconds?: number;
  range_start?: string;
  range_end?: string;
}
export const deviceUsageApi = {
  get: (days: number, signal?: AbortSignal, interval = 'auto') =>
    apiClient.get<DeviceUsage>('/device-usage', { params: { days, interval }, signal }),
  getCalendar: (granularity: CalendarGranularity, timezone: string, signal?: AbortSignal) =>
    apiClient.get<DeviceUsage>('/device-usage', {
      params: {
        days: 90,
        period: 'calendar',
        granularity,
        count: { day: 7, week: 8, month: 6 }[granularity],
        timezone,
      },
      signal,
    }),
  getToday: (timezone: string, signal?: AbortSignal) =>
    apiClient.get<DeviceUsage>('/device-usage', {
      params: { days: 1, period: 'today', timezone },
      signal,
    }),
};
