import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import type { CalendarGranularity, DeviceUsage } from '@/services/api/deviceUsage';
import { formatCost } from '@/features/deviceUsage/cost';
import { colorFor, sumMetrics } from '@/features/deviceUsage/timeline';
import { formatCompactNumber } from '@/utils/format';
import {
  calendarScale,
  calendarValue,
  type CalendarBucket,
  type CalendarMetric,
} from '../calendarUsage';
import layout from '../dashboard.module.scss';
import chart from './ThroughputChart.module.scss';
import styles from './CalendarUsage.module.scss';

interface Props {
  data: DeviceUsage | null;
  loading: boolean;
  error: boolean;
  timezone: string;
  granularity: CalendarGranularity;
  onGranularity: (value: CalendarGranularity) => void;
  onRetry: () => void;
}

export function CalendarUsage({
  data,
  loading,
  error,
  timezone,
  granularity,
  onGranularity,
  onRetry,
}: Props) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState<CalendarMetric>('cost');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const rows = data?.series ?? [];
  const chosen = rows.find((row) => row.period_start === activeKey) ?? rows[rows.length - 1];
  const peak = Math.max(0, ...rows.map((row) => calendarValue(row, metric) ?? 0));
  const scale = calendarScale(peak, metric);
  const total = sumMetrics(rows.filter((row) => row.available));
  const count = new Intl.NumberFormat(i18n.language);
  const cost = (row: CalendarBucket) => (row.available ? formatCost(row, i18n.language) : '—');
  const valueLabel = (row: CalendarBucket) =>
    metric === 'cost'
      ? cost(row)
      : calendarValue(row, metric) === null
        ? '—'
        : count.format(calendarValue(row, metric)!);
  const dateLabel = (stamp: string, full = false) =>
    new Intl.DateTimeFormat(i18n.language, {
      month: 'short',
      day: granularity === 'month' ? undefined : 'numeric',
      year: full ? 'numeric' : undefined,
      timeZone: 'UTC',
    }).format(new Date(`${stamp}T00:00:00Z`));
  const periodLabel = (row: CalendarBucket) =>
    granularity === 'week'
      ? t('dashboard.calendar_week_of', { date: dateLabel(row.period_start, true) })
      : dateLabel(row.period_start, true);
  const tickLabel = (value: number) =>
    metric === 'cost'
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(scale / 4)))),
        }).format(value)
      : formatCompactNumber(value);
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll('button'));
    const index = buttons.indexOf(event.currentTarget);
    const target = {
      ArrowLeft: Math.max(0, index - 1),
      ArrowRight: Math.min(buttons.length - 1, index + 1),
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      buttons[target]?.focus();
    }
  };

  return (
    <section className={layout.section} aria-labelledby="calendar-usage-title" aria-busy={loading}>
      <header className={layout.sectionHead}>
        <span className={layout.eyebrow}>{t('dashboard.calendar_eyebrow')}</span>
        <h2 className={layout.sectionTitle} id="calendar-usage-title">
          {t('dashboard.calendar_title')}
        </h2>
        <p className={layout.sectionDescription}>{t('dashboard.calendar_description')}</p>
      </header>
      <div className={layout.panel}>
        <div className={styles.toolbar}>
          <div className={styles.controls}>
            <div className={styles.switch} role="group" aria-label={t('dashboard.calendar_period')}>
              {(['day', 'week', 'month'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={value === granularity}
                  onClick={() => onGranularity(value)}
                >
                  {t(`dashboard.calendar_${value}`)}
                </button>
              ))}
            </div>
            <div className={styles.switch} role="group" aria-label={t('dashboard.calendar_metric')}>
              {(['cost', 'requests', 'tokens'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={value === metric}
                  onClick={() => setMetric(value)}
                >
                  {t(`dashboard.calendar_${value}`)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.summary}>
            <span>{t(`dashboard.calendar_range_${granularity}`)}</span>
            <strong
              title={
                metric === 'cost'
                  ? total.unpriced_executions
                    ? t('dashboard.today_partial')
                    : t('dashboard.today_estimate')
                  : undefined
              }
            >
              {!data
                ? '—'
                : metric === 'cost'
                  ? formatCost(total, i18n.language)
                  : count.format(metric === 'requests' ? total.requests : total.total)}
            </strong>
          </div>
        </div>
        {data ? (
          <figure className={chart.chart}>
            <figcaption className={styles.caption}>
              {timezone} · {t('dashboard.calendar_current_partial')}
            </figcaption>
            <div className={chart.plot}>
              <div className={`${chart.yAxis} ${styles.yAxis}`} aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span className={chart.yTick} key={i} style={{ top: `${i * 25}%` }}>
                    {tickLabel(scale * (1 - i / 4))}
                  </span>
                ))}
              </div>
              <div className={chart.canvas}>
                <div className={chart.gridlines} aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span key={i} className={chart.gridline} style={{ top: `${i * 25}%` }} />
                  ))}
                </div>
                <div className={chart.columns}>
                  {rows.map((row, index) => {
                    const value = calendarValue(row, metric);
                    return (
                      <button
                        key={row.period_start}
                        className={`${styles.barButton} ${chosen === row ? styles.active : ''}`}
                        aria-label={`${periodLabel(row)}: ${valueLabel(row)} ${t(`dashboard.calendar_${metric}`)}`}
                        aria-pressed={chosen === row}
                        title={
                          metric === 'cost' && row.unpriced_executions
                            ? t('dashboard.today_partial')
                            : undefined
                        }
                        onMouseEnter={(event) => {
                          if (
                            !event.currentTarget.parentElement?.contains(document.activeElement)
                          ) {
                            setActiveKey(row.period_start);
                          }
                        }}
                        onFocus={() => setActiveKey(row.period_start)}
                        onClick={() => setActiveKey(row.period_start)}
                        onKeyDown={keyboard}
                      >
                        <span
                          aria-hidden="true"
                          className={`${styles.bar} ${value === null ? styles.unknown : ''} ${row.is_current ? styles.current : ''}`}
                          style={
                            {
                              height:
                                value === null
                                  ? '12px'
                                  : `${Math.max(value > 0 ? 1 : 0, (value / scale) * 100)}%`,
                              '--bar-color':
                                metric === 'cost'
                                  ? 'var(--viz-success)'
                                  : metric === 'requests'
                                    ? colorFor(0)
                                    : 'var(--amber-color)',
                            } as CSSProperties
                          }
                        />
                        {rows.length <= 8 && value !== null && value > 0 && (
                          <span
                            className={styles.barValue}
                            aria-hidden="true"
                            style={{ bottom: `${Math.max(1, (value / scale) * 100)}%` }}
                          >
                            {metric === 'cost' ? cost(row) : formatCompactNumber(value)}
                          </span>
                        )}
                        <span className={styles.date} aria-hidden="true">
                          {row.is_current
                            ? t('dashboard.calendar_current')
                            : rows.length <= 8
                              ? dateLabel(row.period_start)
                              : index === 0 || index === rows.length - 1
                                ? dateLabel(row.period_start)
                                : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {chosen && (
              <div className={styles.detail} aria-live="polite">
                <div className={styles.detailDate}>
                  <strong>{periodLabel(chosen)}</strong>
                  <span>
                    {!chosen.available
                      ? t('dashboard.calendar_no_history')
                      : chosen.partial
                        ? t('dashboard.calendar_partial')
                        : t('dashboard.calendar_complete')}
                  </span>
                </div>
                <dl>
                  {[
                    ['cost', cost(chosen)],
                    ['requests', chosen.available ? count.format(chosen.requests) : '—'],
                    ['tokens', chosen.available ? formatCompactNumber(chosen.total) : '—'],
                    ['failures', chosen.available ? count.format(chosen.errors) : '—'],
                  ].map(([key, value]) => (
                    <div key={key}>
                      <dt>{t(`dashboard.calendar_${key}`)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <Collapsible className={chart.tableToggle} label={t('dashboard.traffic_table')}>
              <div className={styles.tableWrap}>
                <table className={chart.table}>
                  <thead>
                    <tr>
                      {['period', 'cost', 'requests', 'tokens', 'failures'].map((key) => (
                        <th key={key} scope="col">
                          {t(`dashboard.calendar_${key}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.period_start}>
                        <th scope="row">
                          {periodLabel(row)}
                          {row.partial && row.available ? ' *' : ''}
                        </th>
                        <td>{cost(row)}</td>
                        <td>{row.available ? count.format(row.requests) : '—'}</td>
                        <td>{row.available ? count.format(row.total) : '—'}</td>
                        <td>{row.available ? count.format(row.errors) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Collapsible>
            <p className={styles.note}>
              {t('dashboard.today_estimate')} · {t('dashboard.calendar_all_clients')}
              {data.history_start && (
                <>
                  {' '}
                  ·{' '}
                  {t('dashboard.calendar_history', {
                    date: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: timezone,
                    }).format(new Date(data.history_start)),
                  })}
                </>
              )}
            </p>
          </figure>
        ) : (
          <div className={styles.state} role="status">
            {t(error ? 'dashboard.calendar_unavailable' : 'dashboard.today_loading')}
            {error && (
              <button className="btn btn-secondary" disabled={loading} onClick={onRetry}>
                {t('dashboard.today_retry')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
