import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { DeviceUsage } from '@/services/api/deviceUsage';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { buildTimeline, colorFor, timelineCsv, type Metric } from './timeline';
import { chartTimezone, formatChartTime, type ChartTimezone } from './timezone';
import styles from './DeviceUsagePage.module.scss';

const timezoneStorageKey = 'device-usage-chart-timezone';

interface Props {
  data: DeviceUsage;
  clients: string[];
  selected: string[];
  onSelect: (clients: string[]) => void;
}

export function UsageTimeline({ data, clients, selected, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const hintId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(900);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setPlotWidth(Math.max(280, entry.contentRect.width))
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected.length, data.timeline]);
  const [metric, setMetric] = useState<Metric>('requests');
  const [view, setView] = useState<'lines' | 'bars'>('lines');
  const [timezone, setTimezone] = useState<ChartTimezone>(() => {
    try {
      return obfuscatedStorage.getItem(timezoneStorageKey, { obfuscate: false }) === 'utc'
        ? 'utc'
        : 'local';
    } catch {
      return 'local';
    }
  });
  const timeZone = chartTimezone(timezone);
  const changeTimezone = (value: ChartTimezone) => {
    setTimezone(value);
    try {
      obfuscatedStorage.setItem(timezoneStorageKey, value, { obfuscate: false });
    } catch {
      // The switch still works when browser storage is unavailable.
    }
  };
  const [cursor, setCursor] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const points = useMemo(() => buildTimeline(data, selected, metric), [data, selected, metric]);
  const peak = points.reduce((best, p, i) => (p.total > (points[best]?.total ?? -1) ? i : best), 0);
  const active =
    cursor === null
      ? peak
      : Math.max(
          0,
          points.findIndex((p) => p.bucket === cursor)
        );
  const point = points[active];
  const total = points.reduce((sum, p) => sum + p.total, 0);
  const maxValue = Math.max(
    1,
    ...points.map((p) => (view === 'bars' ? p.total : Math.max(0, ...p.values)))
  );
  const roughStep = Math.max(1, maxValue / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].find((value) => value * magnitude >= roughStep)! * magnitude;
  const ceiling = step * 4;
  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const compact = (n: number) =>
    new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 }).format(
      n
    );
  const stamp = (seconds: number, full = false) =>
    formatChartTime(seconds, i18n.language, timeZone, data.bucket_seconds ?? 300, full);
  const left = 54,
    right = plotWidth - 22,
    top = 24,
    bottom = 266;
  const width = right - left;
  const x = (i: number) => left + ((i + 0.5) / Math.max(1, points.length)) * width;
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const ticks = [
    ...new Set(
      plotWidth < 420
        ? [0, points.length - 1]
        : plotWidth < 700
          ? [0, Math.floor(points.length / 2), points.length - 1]
          : [
              0,
              Math.floor(points.length / 4),
              Math.floor(points.length / 2),
              Math.floor((points.length * 3) / 4),
              points.length - 1,
            ]
    ),
  ].filter((i) => i >= 0);
  const available = data.timeline !== undefined;
  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', timelineCsv(data, selected)], { type: 'text/csv;charset=utf-8' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `device-usage-${data.range_end?.slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className={styles.timelineCard}>
      <div className={styles.chartHeader}>
        <div>
          <div className={styles.eyebrow}>{t('device_usage.activity')}</div>
          <h2 id={titleId}>{t('device_usage.over_time')}</h2>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!points.length || !selected.length}
          onClick={exportCsv}
        >
          {t('device_usage.export')}
        </Button>
      </div>
      <div className={styles.chartToolbar}>
        <div className={styles.segmented} role="group" aria-label={t('device_usage.metric')}>
          {(['requests', 'total', 'errors'] as const).map((key) => (
            <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
              {t(`device_usage.${key}`)}
            </button>
          ))}
        </div>
        <div className={styles.segmented} role="group" aria-label={t('device_usage.chart_type')}>
          {(['lines', 'bars'] as const).map((key) => (
            <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
              {t(`device_usage.${key}`)}
            </button>
          ))}
        </div>
        <div className={styles.segmented} role="group" aria-label={t('device_usage.timezone')}>
          {(['local', 'utc'] as const).map((key) => (
            <button key={key} aria-pressed={timezone === key} onClick={() => changeTimezone(key)}>
              {t(`device_usage.timezone_${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.legend} role="group" aria-label={t('device_usage.filter_users')}>
        {clients.map((client, i) => (
          <button
            key={client}
            aria-pressed={selected.includes(client)}
            onClick={() =>
              onSelect(
                selected.includes(client)
                  ? selected.filter((c) => c !== client)
                  : clients.filter((c) => c === client || selected.includes(c))
              )
            }
          >
            <span className={styles.dot} style={{ background: colorFor(i) }} />
            {client}
            <span className={styles.legendCount}>
              {compact(data.clients.find((c) => c.client === client)?.[metric] ?? 0)}
            </span>
          </button>
        ))}
        <button
          className={styles.allUsers}
          onClick={() => onSelect(selected.length === clients.length ? [] : clients)}
        >
          {t(
            selected.length === clients.length
              ? 'device_usage.clear_users'
              : 'device_usage.all_users'
          )}
        </button>
      </div>
      {!available ? (
        <p className={styles.empty}>{t('device_usage.timeline_unavailable')}</p>
      ) : !selected.length ? (
        <p className={styles.empty}>{t('device_usage.select_users')}</p>
      ) : (
        <>
          <div className={styles.chartSummary}>
            <strong>
              {compact(total)}{' '}
              <span>{t(`device_usage.${metric}`).toLocaleLowerCase(i18n.language)}</span>
            </strong>
            <span>
              {t('device_usage.selected_users', { count: selected.length })} ·{' '}
              {t(`device_usage.interval_${data.interval ?? 'auto'}`)} · {timeZone}
            </span>
          </div>
          <div className={styles.chartLayout}>
            <div className={styles.plotArea} ref={plotRef}>
              <svg
                viewBox={`0 0 ${plotWidth} 310`}
                className={styles.plot}
                role="img"
                aria-labelledby={titleId}
                aria-describedby={hintId}
                onPointerMove={(event) => {
                  if (pinned) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const px = ((event.clientX - rect.left) / rect.width) * plotWidth;
                  setCursor(
                    points[
                      Math.max(
                        0,
                        Math.min(
                          points.length - 1,
                          Math.floor(((px - left) / width) * points.length)
                        )
                      )
                    ]?.bucket ?? null
                  );
                }}
                onPointerLeave={() => {
                  if (!pinned) setCursor(null);
                }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const px = ((event.clientX - rect.left) / rect.width) * plotWidth;
                  setCursor(
                    points[
                      Math.max(
                        0,
                        Math.min(
                          points.length - 1,
                          Math.floor(((px - left) / width) * points.length)
                        )
                      )
                    ]?.bucket ?? null
                  );
                  setPinned(!pinned);
                }}
              >
                <title>
                  {t('device_usage.chart_description', {
                    metric: t(`device_usage.${metric}`),
                    count: selected.length,
                  })}
                </title>
                {[0, 1, 2, 3, 4].map((n) => {
                  const value = (ceiling * n) / 4;
                  return (
                    <g key={n}>
                      <line
                        x1={left}
                        x2={right}
                        y1={y(value)}
                        y2={y(value)}
                        className={styles.gridLine}
                      />
                      <text x={left - 12} y={y(value) + 4} textAnchor="end">
                        {compact(value)}
                      </text>
                    </g>
                  );
                })}
                {view === 'lines'
                  ? selected.map((client, j) => (
                      <g key={client}>
                        <path
                          d={points
                            .map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.values[j])}`)
                            .join(' ')}
                          fill="none"
                          stroke={colorFor(clients.indexOf(client))}
                          strokeWidth="2.2"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        />
                        {points.filter((p) => p.values[j] > 0).length <= 1 &&
                          points.map(
                            (p, i) =>
                              p.values[j] > 0 && (
                                <circle
                                  key={i}
                                  cx={x(i)}
                                  cy={y(p.values[j])}
                                  r="4"
                                  fill={colorFor(clients.indexOf(client))}
                                />
                              )
                          )}
                      </g>
                    ))
                  : points.map((p, i) => {
                      let base = 0;
                      return (
                        <g key={p.bucket}>
                          {p.values.map((value, j) => {
                            const y1 = y(base + value);
                            base += value;
                            return (
                              value > 0 && (
                                <rect
                                  key={selected[j]}
                                  x={x(i) - (width / points.length) * 0.4}
                                  y={y1}
                                  width={(width / points.length) * 0.8}
                                  height={(value / ceiling) * (bottom - top)}
                                  fill={colorFor(clients.indexOf(selected[j]))}
                                  rx="1"
                                />
                              )
                            );
                          })}
                        </g>
                      );
                    })}
                {point && (
                  <g>
                    <line
                      x1={x(active)}
                      x2={x(active)}
                      y1={top}
                      y2={bottom}
                      className={styles.crosshair}
                    />
                    {view === 'lines' &&
                      point.values.map((v, j) => (
                        <circle
                          key={selected[j]}
                          cx={x(active)}
                          cy={y(v)}
                          r="4"
                          fill={colorFor(clients.indexOf(selected[j]))}
                          className={styles.chartPoint}
                        />
                      ))}
                  </g>
                )}
                {ticks.map((i, j) => (
                  <text
                    key={i}
                    x={x(i)}
                    y={293}
                    textAnchor={j === 0 ? 'start' : j === ticks.length - 1 ? 'end' : 'middle'}
                  >
                    {stamp(points[i].bucket)}
                  </text>
                ))}
              </svg>
              {!total && <p className={styles.zeroNotice}>{t('device_usage.no_metric')}</p>}
              <input
                className={styles.scrubber}
                type="range"
                min={0}
                max={Math.max(0, points.length - 1)}
                value={active}
                aria-label={t('device_usage.explore')}
                aria-valuetext={
                  point
                    ? `${stamp(point.bucket, true)}: ${number(point.total)} ${t(`device_usage.${metric}`)}`
                    : ''
                }
                onChange={(e) => {
                  setCursor(points[Number(e.target.value)]?.bucket ?? null);
                  setPinned(true);
                }}
              />
              <p className={styles.chartHint} id={hintId}>
                {t('device_usage.chart_hint')}
              </p>
            </div>
            <aside className={styles.bucketDetail} aria-label={t('device_usage.bucket_detail')}>
              <div className={styles.detailLabel}>
                {t(
                  pinned
                    ? 'device_usage.pinned'
                    : cursor === null
                      ? 'device_usage.peak'
                      : 'device_usage.bucket_detail'
                )}
              </div>
              <time>
                {point && stamp(Math.max(point.bucket, Date.parse(data.range_start!) / 1000), true)}
              </time>
              <span className={styles.bucketEnd}>
                {point &&
                  t('device_usage.bucket_until', {
                    time: stamp(
                      Math.min(
                        point.bucket + data.bucket_seconds!,
                        Date.parse(data.range_end!) / 1000
                      ),
                      true
                    ),
                  })}
              </span>
              <strong className={styles.bucketValue}>{number(point?.total ?? 0)}</strong>
              <span className={styles.detailMetric}>{t(`device_usage.${metric}`)}</span>
              <div className={styles.detailRows}>
                {selected.map((client, j) => (
                  <div key={client}>
                    <span>
                      <i
                        className={styles.dot}
                        style={{ background: colorFor(clients.indexOf(client)) }}
                      />
                      {client}
                    </span>
                    <b>{number(point?.values[j] ?? 0)}</b>
                  </div>
                ))}
              </div>
              {pinned && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPinned(false);
                    setCursor(null);
                  }}
                >
                  {t('device_usage.unpin')}
                </Button>
              )}
            </aside>
          </div>
          <p className={styles.chartFootnote}>{t('device_usage.bucket_note')}</p>
        </>
      )}
    </div>
  );
}
