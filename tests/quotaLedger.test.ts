import { describe, expect, test } from 'bun:test';
import {
  ledgerQuota,
  maskQuotaEmails,
  remainingPercent,
  summarizeLedger,
} from '../src/features/quota/ledger';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import type { ClaudeQuotaState } from '../src/types';

const entry = (name: string, disabled = false): QuotaFileEntry => ({
  type: 'claude',
  file: { name, disabled },
});
const quota = (used: number | null): ClaudeQuotaState => ({
  status: 'success',
  windows: [
    { id: 'seven-day', label: 'Weekly', usedPercent: used, resetLabel: '' },
    { id: 'seven-day-fable', label: 'Fable', usedPercent: 0, resetLabel: '' },
  ],
});

describe('quota ledger', () => {
  test('distinguishes unknown, empty and exhausted capacity', () => {
    expect(remainingPercent(null)).toBeNull();
    expect(remainingPercent(Number.NaN)).toBeNull();
    expect(remainingPercent(Infinity)).toBeNull();
    expect(remainingPercent(100)).toBe(0);
    expect(remainingPercent(-3)).toBe(100);
    expect(summarizeLedger([], () => undefined).total).toBeNull();
  });
  test('only combines comparable weekly observations from enabled accounts', () => {
    const values = { a: quota(25), b: quota(50), off: quota(0) };
    const result = summarizeLedger(
      [entry('a'), entry('b'), entry('unknown'), entry('off', true)],
      (item) => values[item.file.name as keyof typeof values]
    );
    expect(result).toEqual({
      segments: [75, 50, null],
      known: 2,
      eligible: 3,
      total: 125,
      maximum: 200,
    });
    expect(summarizeLedger([entry('empty')], () => quota(null)).total).toBeNull();
    expect(summarizeLedger([entry('error')], () => ({ ...quota(10), status: 'error' })).known).toBe(
      0
    );
  });
  test('a missing weekly window is unknown, not replaced by a different model window', () => {
    const data = quota(20);
    data.windows.shift();
    expect(summarizeLedger([entry('a')], () => data).total).toBeNull();
    expect(ledgerQuota('kimi', data)).toBeNull();
  });
  test('masks UUID filenames, plus aliases, subdomains and Devin display identities', () => {
    expect(maskQuotaEmails('claude-uuid+alias@private.example.org.json')).toBe(
      'claude-•••@•••.json'
    );
    expect(maskQuotaEmails('account.json · person@sub.example.org')).toBe('account.json · •••@•••');
    expect(maskQuotaEmails('devbox-claude.json')).toBe('devbox-claude.json');
    const masked = maskQuotaEmails('person@example.com.json');
    expect(masked).not.toContain('person');
    expect(masked).not.toContain('example');
  });
});
