import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import { deviceUsageApi, type DeviceUsage, type UsageMetrics } from '@/services/api/deviceUsage';
import styles from './DeviceUsagePage.module.scss';

export function DeviceUsagePage() {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const status = useAuthStore((s) => s.connectionStatus);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<DeviceUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++generation.current;
    const revision = apiClient.getConnectionRevision();
    if (status !== 'connected') return;
    setLoading(true);
    setError(false);
    try {
      const result = await deviceUsageApi.get(days, abort.signal);
      if (
        !abort.signal.aborted &&
        id === generation.current &&
        revision === apiClient.getConnectionRevision()
      )
        setData(result);
    } catch {
      if (
        !abort.signal.aborted &&
        id === generation.current &&
        revision === apiClient.getConnectionRevision()
      )
        setError(true);
    } finally {
      if (
        !abort.signal.aborted &&
        id === generation.current &&
        revision === apiClient.getConnectionRevision()
      )
        setLoading(false);
    }
  }, [days, status]);
  useEffect(() => {
    setData(null);
    void reload();
    return () => {
      controller.current?.abort();
    };
  }, [apiBase, managementKey, reload]);
  useHeaderRefresh(reload);
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const compact = (n: number) =>
    new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(
      n
    );
  const columns = [
    'requests',
    'input',
    'output',
    'cache_read',
    'cache_write',
    'total',
    'errors',
  ] as const;
  const table = (rows: (UsageMetrics & { label: string })[], label: string) => (
    <div className={styles.scroll}>
      <table>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            {columns.map((key) => (
              <th scope="col" key={key}>
                {t(`device_usage.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {columns.map((key) => (
                <td key={key}>{number(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const lastPoll = data?.collector.last_poll;
  const stale = !lastPoll || Date.now() - Date.parse(lastPoll) > 60000;
  const maxDay = Math.max(1, ...(data?.daily.map((d) => d.total) ?? []));
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{t('device_usage.private')}</div>
          <h1>{t('device_usage.title')}</h1>
          <p>{t('device_usage.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <label>
            <span className={styles.srOnly}>{t('device_usage.period')}</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t('device_usage.days', { count: d })}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => void reload()} loading={loading}>
            {t('device_usage.refresh')}
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.notice}>
          {t('device_usage.unavailable')}
        </p>
      )}
      {!data && !error && <p role="status">{t('device_usage.loading')}</p>}
      {data && (
        <>
          <div className={styles.stats}>
            {(['total', 'requests', 'cache_read', 'errors'] as const).map((key) => (
              <div key={key}>
                <span>{t(`device_usage.${key}`)}</span>
                <strong title={number(data.totals[key])}>{compact(data.totals[key])}</strong>
              </div>
            ))}
          </div>
          <div className={styles.status} role="status">
            <span className={stale ? styles.stale : styles.live}>
              {t(stale ? 'device_usage.stale' : 'device_usage.collecting')}
            </span>
            <span>
              {t('device_usage.since')}:{' '}
              {data.collector.started_at
                ? new Date(data.collector.started_at).toLocaleString(i18n.language)
                : '—'}
            </span>
            <span>
              {t('device_usage.updated')}:{' '}
              {lastPoll ? new Date(lastPoll).toLocaleString(i18n.language) : '—'}
            </span>
          </div>
          <Card title={t('device_usage.clients')}>
            {table(
              data.clients.map((r) => ({ ...r, label: r.client })),
              t('device_usage.client')
            )}
          </Card>
          <Card title={t('device_usage.daily')}>
            <div className={styles.chart}>
              {data.daily.length ? (
                data.daily.map((d) => (
                  <div className={styles.barRow} key={d.day}>
                    <time>{d.day}</time>
                    <div>
                      <span style={{ width: `${Math.max(1, (d.total / maxDay) * 100)}%` }} />
                    </div>
                    <strong>{number(d.total)}</strong>
                  </div>
                ))
              ) : (
                <p>{t('device_usage.empty')}</p>
              )}
            </div>
          </Card>
          <Card title={t('device_usage.models')}>
            {table(
              data.models.map((r) => ({ ...r, label: `${r.provider} / ${r.model}` })),
              t('device_usage.model')
            )}
          </Card>
          <p className={styles.note}>
            {t('device_usage.accounting')}{' '}
            {t('device_usage.attempts', { count: data.totals.executions })}{' '}
            {t('device_usage.quality', {
              count: data.totals.incomplete,
              rejected: data.collector.rejected ?? '0',
            })}
          </p>
        </>
      )}
    </section>
  );
}
