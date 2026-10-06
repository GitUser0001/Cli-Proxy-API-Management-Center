import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceUsage } from '@/services/api/deviceUsage';
import { formatCost } from '@/features/deviceUsage/cost';
import { todaySummary } from '../todayUsage';
import styles from '../dashboard.module.scss';

interface Props {
  data: DeviceUsage | null;
  loading: boolean;
  error: boolean;
  timezone: string;
}

export function TeamSpendHero({ data, loading, error, timezone }: Props) {
  const { t, i18n } = useTranslation();
  const team = data ? todaySummary(data).total : null;
  const value = team ? formatCost(team, i18n.language) : '—';
  return (
    <div
      className={`${styles.heroPanel} ${styles.heroSpend}`}
      data-reveal="scale"
      aria-busy={loading}
    >
      <div className={styles.heroPanelTop}>
        <span className={styles.heroPanelLabel}>{t('dashboard.hero_team_value')}</span>
        {data && !error && (
          <span className={styles.liveBadge}>
            <i className={styles.liveDot} aria-hidden="true" />
            {t('dashboard.hero_live')}
          </span>
        )}
      </div>
      <strong
        className={`${styles.heroFigure} ${styles.heroCurrency}`}
        style={{ '--money-chars': value.length } as CSSProperties}
        title={
          team?.unpriced_executions ? t('dashboard.today_partial') : t('dashboard.today_estimate')
        }
      >
        {value}
      </strong>
      <span className={styles.heroPanelMeta}>
        {t('dashboard.today_eyebrow')} · {t('dashboard.today_since')} · {timezone}
      </span>
      <div className={styles.heroSpendFoot}>
        <span>{t('dashboard.hero_team_scope')}</span>
        <span>
          {t(
            error
              ? 'dashboard.today_unavailable'
              : !data
                ? 'dashboard.today_loading'
                : 'dashboard.hero_api_estimate'
          )}
        </span>
      </div>
    </div>
  );
}
