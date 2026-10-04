import type { CodexQuotaState } from '@/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import type { QuotaFileEntry } from './logic';

export type LedgerQuota = CodexQuotaState;

export function ledgerQuota(type: QuotaProviderType, quota?: QuotaCardState): LedgerQuota | null {
  if ((type !== 'claude' && type !== 'codex') || quota?.status !== 'success') return null;
  return quota as LedgerQuota;
}

export function remainingPercent(used: number | null | undefined): number | null {
  return typeof used === 'number' && Number.isFinite(used)
    ? 100 - Math.min(100, Math.max(0, used))
    : null;
}

// Mask the entire mailbox, including UUID-style local parts and subdomains.
// Filenames without email addresses remain useful identifiers.
export function maskQuotaEmails(name: string): string {
  return name.replace(/[^\s@·]+@[^\s@·]+/g, (mailbox) => {
    const suffix = mailbox.endsWith('.json') ? '.json' : '';
    const prefix = mailbox.startsWith('claude-') ? 'claude-' : '';
    return `${prefix}•••@•••${suffix}`;
  });
}

/** Sum comparable weekly percentages, never claim this is pooled token capacity. */
export function summarizeLedger(
  entries: QuotaFileEntry[],
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined
) {
  const eligible = entries.filter((entry) => !entry.file.disabled);
  const segments = eligible.map((entry) => {
    const quota = ledgerQuota(entry.type, quotaFor(entry));
    const id = entry.type === 'claude' ? 'seven-day' : 'weekly';
    const window = quota?.windows.find((item) => item.id === id);
    return remainingPercent(window?.usedPercent);
  });
  const known = segments.filter((value): value is number => value !== null);
  return {
    segments,
    known: known.length,
    eligible: eligible.length,
    total: known.length ? Math.round(known.reduce((sum, value) => sum + value, 0)) : null,
    maximum: known.length * 100,
  };
}
