// DompetKu v1.0.3 — money parsing, formatting and budget-cycle tests.
import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  cycleRange,
  formatIDR,
  parseAmountId,
} from './money';

describe('parseAmountId', () => {
  it.each([
    ['45rb', 45_000],
    ['Makan siang 45rb GoPay', 45_000],
    ['Rp50.000', 50_000],
    ['1,5jt', 1_500_000],
    ['2 juta', 2_000_000],
    ['50000', 50_000],
    ['1.500.000', 1_500_000],
    ['kopi 22k', 22_000],
    ['45 ribu', 45_000],
    ['bayar tol 15000', 15_000],
  ])('parses %s as %d', (text, expected) => {
    expect(parseAmountId(text)).toBe(expected);
  });

  it.each(['tidak ada angka', 'nol', '0', ''])(
    'returns null for %s',
    (text) => {
      expect(parseAmountId(text)).toBeNull();
    },
  );
});

describe('formatIDR', () => {
  it('groups thousands with dots', () => {
    expect(formatIDR(45_000)).toBe('Rp45.000');
    expect(formatIDR(1_500_000)).toBe('Rp1.500.000');
    expect(formatIDR(0)).toBe('Rp0');
  });
});

describe('cycleRange', () => {
  it('starts on the 1st for a 1st-cycle wallet', () => {
    const { start, end } = cycleRange(new Date(2026, 10, 24), 1);
    expect(start).toEqual(new Date(2026, 10, 1));
    expect(end).toEqual(new Date(2026, 11, 1));
  });

  it('uses a 25th-to-24th cycle', () => {
    const before = cycleRange(new Date(2026, 10, 24), 25);
    expect(before.start).toEqual(new Date(2026, 9, 25));
    expect(before.end).toEqual(new Date(2026, 10, 25));
    const after = cycleRange(new Date(2026, 10, 26), 25);
    expect(after.start).toEqual(new Date(2026, 10, 25));
    expect(after.end).toEqual(new Date(2026, 11, 25));
  });

  it('clamps a 31st cycle in February', () => {
    const { start, end } = cycleRange(new Date(2026, 1, 15), 31);
    expect(start).toEqual(new Date(2026, 0, 31));
    expect(end).toEqual(new Date(2026, 1, 28));
  });

  it('keeps Feb 29 for a 31st cycle in a leap year', () => {
    // 2028 is a leap year (divisible by 4, not a century).
    const { start, end } = cycleRange(new Date(2028, 1, 15), 31);
    expect(start).toEqual(new Date(2028, 0, 31));
    expect(end).toEqual(new Date(2028, 1, 29));
  });

  it('clamps a 29th cycle to Feb 28 outside leap years', () => {
    const nonLeap = cycleRange(new Date(2026, 1, 15), 29);
    expect(nonLeap.end).toEqual(new Date(2026, 1, 28));
    const leap = cycleRange(new Date(2028, 1, 15), 29);
    expect(leap.end).toEqual(new Date(2028, 1, 29));
  });

  it('clamps a 31st cycle to the 30th in 30-day months', () => {
    const { start, end } = cycleRange(new Date(2026, 3, 15), 31);
    expect(start).toEqual(new Date(2026, 2, 31));
    expect(end).toEqual(new Date(2026, 3, 30));
  });

  it('treats 2100 as a non-leap century year', () => {
    // 2100 is divisible by 100 but not by 400, so February has 28 days.
    const { start, end } = cycleRange(new Date(2100, 1, 15), 31);
    expect(start).toEqual(new Date(2100, 0, 31));
    expect(end).toEqual(new Date(2100, 1, 28));
  });
});

describe('budgetStatus', () => {
  it('reports left, percent and warned state', () => {
    const status = budgetStatus(1_640_000, 2_000_000, 80);
    expect(status.left).toBe(360_000);
    expect(Math.round(status.usedPercent)).toBe(82);
    expect(status.warned).toBe(true);
    expect(status.over).toBe(false);
  });

  it('reports over when spending passes the budget', () => {
    const status = budgetStatus(2_100_000, 2_000_000, 80);
    expect(status.over).toBe(true);
    expect(status.left).toBe(-100_000);
  });
});
