import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay, normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { ledgerQuota, remainingPercent, summarizeLedger } from '../ledger';
import { QuotaCard, type QuotaCardProps } from './QuotaCard';
import styles from './QuotaLedger.module.scss';

function Meter({ value }: { value: number | null }) {
  return (
    <div className={styles.track} aria-hidden="true">
      <span
        className={
          value === null || value >= 70 ? styles.high : value >= 30 ? styles.medium : styles.low
        }
        style={{ width: `${value ?? 0}%` }}
      />
    </div>
  );
}

export function QuotaSummary({
  entries,
  quotaFor,
  resolvedTheme,
}: {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const groups = QUOTA_TAB_ORDER.filter(
    (type) =>
      (type === 'claude' || type === 'codex') && entries.some((entry) => entry.type === type)
  );
  if (!groups.length) return null;
  return (
    <div>
      <div className={styles.summary}>
        {groups.map((type) => {
          const group = entries.filter((entry) => entry.type === type);
          const summary = summarizeLedger(group, quotaFor);
          return (
            <article key={type} className={styles.summaryCell}>
              <div className={styles.summaryHead}>
                <span>
                  <img src={getAuthFileIcon(type, resolvedTheme) ?? undefined} alt="" />
                  {getTypeLabel(t, type)}
                </span>
                <small>{t('quota_management.meta_credentials', { count: group.length })}</small>
              </div>
              <div className={styles.caption}>
                {t(type === 'claude' ? 'claude_quota.seven_day' : 'codex_quota.secondary_window')}
              </div>
              <div className={styles.total}>
                {summary.total === null ? '—' : `${summary.total}%`}
                <small>
                  {summary.known > 0 && t('quota_management.ledger_of', { value: summary.maximum })}
                </small>
              </div>
              <div className={styles.segments}>
                {summary.segments.map((value, index) => (
                  <Meter key={index} value={value} />
                ))}
              </div>
              <small className={styles.caption}>
                {t('quota_management.ledger_known', {
                  known: summary.known,
                  total: summary.eligible,
                })}
              </small>
            </article>
          );
        })}
      </div>
      <p className={styles.summaryNote}>{t('quota_management.ledger_summary_hint')}</p>
    </div>
  );
}

function LedgerRow(props: QuotaCardProps & { displayName: string }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const quota = ledgerQuota(props.entry.type, props.quota);
  const windows = quota?.windows ?? [];
  const plan = normalizePlanType(quota?.planType);
  const planLabel =
    props.entry.type === 'claude'
      ? t(`claude_quota.${plan}`, { defaultValue: quota?.planType ?? '' })
      : t(
          `codex_quota.${plan === 'self_serve_business_prolite' ? 'plan_business_premium' : plan === 'pro' ? 'plan_pro' : PREMIUM_CODEX_PLAN_TYPES.has(plan ?? '') ? 'plan_prolite' : `plan_${plan}`}`,
          { defaultValue: quota?.planType ?? '' }
        );
  const busy = props.quota?.status === 'loading' || props.resetting;
  const supported = props.entry.type === 'claude' || props.entry.type === 'codex';
  if (!supported) return <QuotaCard {...props} />;
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.identity}>
          <span className={styles.filename} title={props.displayName}>
            {props.displayName}
          </span>
          <small>
            {planLabel}
            {props.entry.file.disabled && ` · ${t('quota_management.ledger_disabled')}`}
          </small>
        </div>
        <div className={styles.windows} aria-busy={busy}>
          {windows.length > 0 ? (
            windows.map((window) => {
              const remaining = remainingPercent(window.usedPercent);
              const reset = buildResetDisplay(
                window.resetLabel,
                window.resetAtMs,
                now,
                i18n.resolvedLanguage
              );
              const label = window.labelKey
                ? t(window.labelKey, window.labelParams ?? {})
                : window.label;
              return (
                <div key={window.id} className={styles.window}>
                  <div className={styles.windowHead}>
                    <span>{label}</span>
                    <strong>{remaining === null ? '—' : `${Math.round(remaining)}%`}</strong>
                  </div>
                  <Meter value={remaining} />
                  <small>
                    {reset ? [reset.relative, reset.absolute].filter(Boolean).join(' · ') : '—'}
                  </small>
                </div>
              );
            })
          ) : (
            <span className={styles.caption}>
              {t(`quota_management.ledger_${props.quota?.status ?? 'idle'}`)}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={props.onRefresh} disabled={!props.canRefresh || busy}>
            <IconRefreshCw size={13} />
            {t('auth_files.quota_refresh_single')}
          </button>
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {t(expanded ? 'quota_management.ledger_less' : 'quota_management.ledger_details')}
          </button>
        </div>
      </div>
      {expanded && (
        <div className={styles.details}>
          <QuotaCard {...props} />
        </div>
      )}
    </article>
  );
}

export function QuotaLedger({
  entries,
  displayNameFor,
  cardProps,
}: {
  entries: QuotaFileEntry[];
  displayNameFor: (name: string) => string;
  cardProps: (entry: QuotaFileEntry) => QuotaCardProps;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.ledger}>
      {QUOTA_TAB_ORDER.map((type) => {
        const group = entries.filter((entry) => entry.type === type);
        if (!group.length) return null;
        return (
          <section key={type} className={styles.group}>
            <h2>
              {getTypeLabel(t, type)} <span>{group.length}</span>
            </h2>
            {group.map((entry) => (
              <LedgerRow
                key={getQuotaCacheKey(entry.file)}
                {...cardProps(entry)}
                displayName={displayNameFor(getQuotaDisplayName(entry.file))}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
