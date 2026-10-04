import { apiClient } from './client';

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
}
export interface DeviceUsage {
  days: number;
  totals: UsageMetrics;
  clients: (UsageMetrics & { client: string })[];
  models: (UsageMetrics & { provider: string; model: string })[];
  daily: (UsageMetrics & { day: string })[];
  collector: { started_at?: string; last_poll?: string; rejected?: string };
}
export const deviceUsageApi = {
  get: (days: number, signal?: AbortSignal) =>
    apiClient.get<DeviceUsage>('/device-usage', { params: { days }, signal }),
};
