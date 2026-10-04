import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import { deviceUsageApi, type DeviceUsage, type UsageMetrics } from '@/services/api/deviceUsage';
import styles from './DeviceUsagePage.module.scss';
import { formatCost } from './cost';
import { PersonModelBreakdown } from './PersonModelBreakdown';
import { UsageTimeline } from './UsageTimeline';
import {
  groupUsageByPerson,
  intervals,
  intervalAllowed,
  modelRows,
  sumMetrics,
  type Interval,
} from './timeline';

export function DeviceUsagePage() {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const status = useAuthStore((s) => s.connectionStatus);
  const [days, setDays] = useState(1);
  const [interval, setInterval] = useState<Interval>('auto');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selection, setSelection] = useState<string[] | null>(null);
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
      const result = await deviceUsageApi.get(days, abort.signal, interval);
      if (
        !abort.signal.aborted &&
        id === generation.current &&
        revision === apiClient.getConnectionRevision()
      )
        setData(groupUsageByPerson(result));
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
  }, [days, status, interval]);
  useEffect(() => {
    setData(null);
    void reload();
    return () => {
      controller.current?.abort();
    };
  }, [apiBase, managementKey, reload]);
  useHeaderRefresh(reload);
  useEffect(() => {
    setSelection(null);
  }, [apiBase, managementKey]);
  useEffect(() => {
    if (!autoRefresh || status !== 'connected') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, reload, status]);
  const clients = useMemo(() => data?.clients.map((c) => c.client).sort() ?? [], [data]);
  const selected = selection === null ? clients : clients.filter((c) => selection.includes(c));
  const filteredClients = data?.clients.filter((c) => selected.includes(c.client)) ?? [];
  const totals =
    data && selected.length === clients.length ? data.totals : sumMetrics(filteredClients);
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const compact = (n: number) =>
    new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(
      n
    );
  const hasPricing = Boolean(data?.pricing);
  const cost = (row: UsageMetrics) => formatCost(row, i18n.language);
  const costTitle = (row: UsageMetrics) =>
    row.unpriced_executions
      ? t('device_usage.cost_unpriced', { count: row.unpriced_executions })
      : t('device_usage.cost_equivalent');
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
            {hasPricing && <th scope="col">{t('device_usage.cost')}</th>}
            {columns.map((key) => (
              <th scope="col" key={key}>
                {t(`device_usage.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + 1 + Number(hasPricing)}>{t('device_usage.empty')}</td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {hasPricing && <td title={costTitle(row)}>{cost(row)}</td>}
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
  const stale =
    !lastPoll ||
    (data?.range_end ? Date.parse(data.range_end) : Date.now()) - Date.parse(lastPoll) > 60000;
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
            <select
              value={days}
              onChange={(e) => {
                const next = Number(e.target.value);
                setDays(next);
                if (!intervalAllowed(next, interval)) setInterval('auto');
              }}
            >
              {[1, 7, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {t(d === 1 ? 'device_usage.last_day' : 'device_usage.days', { count: d })}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>{t('device_usage.interval')}</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
              {intervals.map((value) => (
                <option key={value} value={value} disabled={!intervalAllowed(days, value)}>
                  {t(`device_usage.interval_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.autoRefresh}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            {t('device_usage.auto_refresh')}
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
          <div className={styles.scope}>{t('device_usage.scope', { count: selected.length })}</div>
          <div className={`${styles.stats} ${hasPricing ? styles.withCost : ''}`}>
            {hasPricing && (
              <div className={styles.costStat}>
                <span>{t('device_usage.cost')}</span>
                <strong title={costTitle(totals)}>{cost(totals)}</strong>
                <small>{t('device_usage.cost_equivalent')}</small>
              </div>
            )}
            {(['requests', 'total', 'cache_read', 'errors'] as const).map((key) => (
              <div key={key}>
                <span>{t(`device_usage.${key}`)}</span>
                <strong title={number(totals[key])}>{compact(totals[key])}</strong>
              </div>
            ))}
          </div>
          {hasPricing && (
            <details className={styles.costDetails}>
              <summary>{t('device_usage.cost_explained')}</summary>
              <p>{t('device_usage.cost_assumptions', { date: data.pricing!.as_of })}</p>
              <p>{t('device_usage.cost_formula')}</p>
              <p className={totals.unpriced_executions ? styles.notice : undefined}>
                {t('device_usage.cost_unpriced', { count: totals.unpriced_executions ?? 0 })}
              </p>
              <a
                href="https://developers.openai.com/api/docs/models/gpt-6.1-sol"
                target="_blank"
                rel="noreferrer"
              >
                GPT-6.1 Sol
              </a>
              {' · '}
              <a
                href="https://developers.openai.com/api/docs/models/gpt-6-luna"
                target="_blank"
                rel="noreferrer"
              >
                GPT-6 Luna
              </a>
              {' · '}
              <a
                href="https://platform.claude.com/docs/en/about-claude/pricing"
                target="_blank"
                rel="noreferrer"
              >
                Claude
              </a>
            </details>
          )}
          {hasPricing && Boolean(totals.unpriced_executions) && (
            <p className={styles.notice}>
              {t('device_usage.cost_unpriced', { count: totals.unpriced_executions })}
            </p>
          )}
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
          <UsageTimeline
            key={`${days}-${interval}`}
            data={data}
            clients={clients}
            selected={selected}
            onSelect={(value) => setSelection(value.length === clients.length ? null : value)}
          />
          <PersonModelBreakdown data={data} selected={selected} />
          <Card title={t('device_usage.clients')}>
            {table(
              filteredClients.map((r) => ({ ...r, label: r.client })),
              t('device_usage.client')
            )}
          </Card>
          <Card title={t('device_usage.models')}>
            {table(
              modelRows(data, selected).map((r) => ({ ...r, label: `${r.provider} / ${r.model}` })),
              t('device_usage.model')
            )}
          </Card>
          <p className={styles.note}>
            {t('device_usage.accounting')}{' '}
            {t('device_usage.attempts', { count: totals.executions })}{' '}
            {t('device_usage.quality', {
              count: totals.incomplete,
              rejected: data.collector.rejected ?? '0',
            })}
          </p>
        </>
      )}
    </section>
  );
}
