import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { deviceUsageApi, type DeviceUsage } from '@/services/api/deviceUsage';

export function useTodayUsage() {
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const status = useAuthStore((s) => s.connectionStatus);
  const [data, setData] = useState<DeviceUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [loadedScope, setLoadedScope] = useState<{
    base: string;
    key: string;
    revision: number;
  } | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++generation.current;
    const revision = apiClient.getConnectionRevision();
    if (status !== 'connected') return;
    setLoading(true);
    const current = () =>
      !abort.signal.aborted &&
      id === generation.current &&
      revision === apiClient.getConnectionRevision();
    try {
      const result = await deviceUsageApi.getToday(timezone, abort.signal);
      // Older collectors ignore unknown query parameters: never label a rolling day as today.
      if (result.period !== 'today' || result.timezone !== timezone) throw new Error('unsupported');
      if (current()) {
        setLoadedScope({ base: apiBase, key: managementKey, revision });
        setData(result);
        setError(false);
      }
    } catch {
      if (current()) {
        setData(null);
        setError(true);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [apiBase, managementKey, status, timezone]);

  useEffect(() => {
    setData(null);
    setError(false);
    setLoading(false);
    void refresh();
    return () => {
      controller.current?.abort();
    };
  }, [apiBase, managementKey, refresh]);

  useEffect(() => {
    if (status !== 'connected') return;
    const update = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [status, refresh]);

  const visibleData =
    status === 'connected' &&
    loadedScope?.base === apiBase &&
    loadedScope?.key === managementKey &&
    loadedScope?.revision === apiClient.getConnectionRevision()
      ? data
      : null;
  return { data: visibleData, loading, error: error || status !== 'connected', refresh, timezone };
}
