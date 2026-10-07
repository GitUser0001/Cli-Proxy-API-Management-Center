import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DeviceUsage, UsageMetrics } from '@/services/api/deviceUsage';
import { colorFor } from '@/features/deviceUsage/timeline';
import { costTitle, formatCost } from '@/features/deviceUsage/cost';
import { todaySummary } from '../todayUsage';
import styles from './TodaySpend.module.scss';

interface Props {
  data: DeviceUsage | null;
  loading: boolean;
  error: boolean;
  timezone: string;
  onRetry: () => void;
}

export function TodaySpend({ data, loading, error, timezone, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const summary = data ? todaySummary(data) : null;
  const cost = (row: UsageMetrics) => formatCost(row, i18n.language);
  const title = (row: UsageMetrics) => costTitle(row, t);
  const date = data?.range_end
    ? new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        timeZone: timezone,
      }).format(new Date(data.range_end))
    : null;

  return (
    <section className={styles.section} aria-labelledby="today-spend-title" aria-busy={loading}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('dashboard.today_eyebrow')}</span>
          <h2 id="today-spend-title" className={styles.title}>
            {t('dashboard.today_title')}
          </h2>
          <p className={styles.period}>
            {date && <>{date} · </>}
            {t('dashboard.today_since')} · {timezone}
          </p>
        </div>
        <div className={styles.total}>
          <span>{t('dashboard.today_people_total')}</span>
          <strong title={summary ? title(summary.total) : undefined}>
            {summary ? cost(summary.total) : '—'}
          </strong>
        </div>
      </header>

      {summary ? (
        <ul className={styles.people} aria-label={t('dashboard.today_people_aria')}>
          {summary.people.map((person) => (
            <li
              key={person.name}
              className={styles.person}
              style={{ '--person-color': colorFor(person.colorIndex) } as CSSProperties}
            >
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {person.initials}
                </span>
                <span className={styles.name}>{person.name}</span>
              </div>
              <strong className={styles.amount} title={title(person)}>
                {cost(person)}
              </strong>
              <span className={styles.requests}>
                {t('dashboard.today_requests', {
                  count: person.requests,
                  value: new Intl.NumberFormat(i18n.language).format(person.requests),
                })}
              </span>
              <div className={styles.track} aria-hidden="true">
                <span
                  style={{
                    width: `${
                      summary.maxCost > 0 ? ((person.cost_usd ?? 0) / summary.maxCost) * 100 : 0
                    }%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.state} role="status">
          <span>{t(error ? 'dashboard.today_unavailable' : 'dashboard.today_loading')}</span>
          {error && (
            <button onClick={onRetry} disabled={loading}>
              {t('dashboard.today_retry')}
            </button>
          )}
        </div>
      )}

      <footer className={styles.footer}>
        <span>
          {t('dashboard.today_estimate')}
          {data?.totals.image_estimated_executions ? (
            <> · {t('device_usage.cost_image_chart')}</>
          ) : null}
          {summary && summary.apps.executions > 0 && (
            <>
              {' '}
              ·{' '}
              {t('dashboard.today_apps', {
                value: cost(summary.apps),
              })}
            </>
          )}
        </span>
        <Link to="/device-usage">
          {t('dashboard.today_details')} <span aria-hidden="true">↗</span>
        </Link>
      </footer>
    </section>
  );
}
