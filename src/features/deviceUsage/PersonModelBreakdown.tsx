import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { DeviceUsage } from '@/services/api/deviceUsage';
import { colorFor } from './timeline';
import { personModelRows } from './breakdown';
import { costTitle, formatCost } from './cost';
import styles from './PersonModelBreakdown.module.scss';

const providerName = (name: string) =>
  name === 'claude' ? 'Claude' : name === 'codex' ? 'Codex' : name;

export function PersonModelBreakdown({
  data,
  selected,
}: {
  data: DeviceUsage;
  selected: string[];
}) {
  const { t, i18n } = useTranslation();
  const people = personModelRows(data, selected);
  const providers = [...new Set(data.client_models?.map((row) => row.provider) ?? [])].sort();
  const color = (provider: string) => colorFor(providers.indexOf(provider));
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const compact = (value: number) =>
    new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value
    );
  const percent = (value: number) =>
    new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(
      value
    );
  const priced = Boolean(data.pricing);
  return (
    <Card title={<h2 className={styles.title}>{t('device_usage.breakdown_title')}</h2>}>
      <p className={styles.intro}>{t('device_usage.breakdown_intro')}</p>
      {!people ? (
        <p>{t('device_usage.breakdown_unavailable')}</p>
      ) : !people.length ? (
        <p>{t('device_usage.select_users')}</p>
      ) : (
        <div className={styles.people}>
          {people.map((person) => (
            <article className={styles.person} key={person.client} aria-label={person.client}>
              <header className={styles.personHeader}>
                <div>
                  <h3>{person.client}</h3>
                  <span>
                    {t('device_usage.breakdown_requests', { value: number(person.requests) })}
                  </span>
                </div>
                {priced && (
                  <div className={styles.cost}>
                    <strong title={costTitle(person, t)}>
                      {formatCost(person, i18n.language)}
                    </strong>
                    <span>{t('device_usage.cost')}</span>
                  </div>
                )}
              </header>
              {!person.models.length ? (
                <p className={styles.noActivity}>{t('device_usage.empty')}</p>
              ) : (
                <>
                  <div className={styles.mix} aria-hidden="true">
                    {person.providers.map((provider) => (
                      <span
                        key={provider.provider}
                        style={{
                          width: `${provider.share * 100}%`,
                          background: color(provider.provider),
                        }}
                      />
                    ))}
                  </div>
                  <ul className={styles.providers} aria-label={t('device_usage.provider_mix')}>
                    {person.providers.map((provider) => (
                      <li key={provider.provider}>
                        <span
                          className={styles.dot}
                          style={{ background: color(provider.provider) }}
                          aria-hidden="true"
                        />
                        <b>{providerName(provider.provider)}</b>
                        <span>
                          {percent(provider.share)} ·{' '}
                          {t('device_usage.breakdown_attempts', {
                            value: number(provider.executions),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className={styles.tableScroll}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">{t('device_usage.model')}</th>
                          <th scope="col">{t('device_usage.requests')}</th>
                          <th scope="col">{t('device_usage.total')}</th>
                          {priced && <th scope="col">{t('device_usage.cost')}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {person.models.map((row) => (
                          <tr key={JSON.stringify([row.provider, row.model])}>
                            <th scope="row">
                              <span className={styles.model}>{row.model}</span>
                              <small>{providerName(row.provider)}</small>
                            </th>
                            <td>{number(row.requests)}</td>
                            <td title={number(row.total)}>{compact(row.total)}</td>
                            {priced && (
                              <td title={costTitle(row, t)}>
                                {formatCost(row, i18n.language, true)}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      <p className={styles.footnote}>{t('device_usage.breakdown_note')}</p>
    </Card>
  );
}
