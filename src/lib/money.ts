// DompetKu v1.0.0 — money parsing, formatting and budget-cycle math.
// All amounts are IDR integers. Indonesian shorthands: rb/ribu/k = thousand,
// jt/juta = million. Decimal comma ("1,5jt") and thousand dots ("50.000").

export function parseAmountId(text: string): number | null {
  const re =
    /(?:rp\s*)?(\d+(?:[.,]\d+)*)\s*(rb|ribu|k|jt|juta)?/gi;
  type Candidate = { value: number; score: number; index: number };
  const candidates: Candidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const suffix = (m[2] ?? '').toLowerCase();
    const hasRp = /^rp/i.test(text.slice(Math.max(0, m.index - 3), m.index + 2));
    const hasSeparator = /[.,]/.test(raw);
    let value: number;
    if (suffix) {
      // With a suffix, dots are thousand separators and comma is the decimal mark.
      const normalized = raw.replace(/\./g, '').replace(',', '.');
      const base = Number.parseFloat(normalized);
      if (!Number.isFinite(base)) continue;
      const mult =
        suffix === 'jt' || suffix === 'juta'
          ? 1_000_000
          : 1_000; // rb, ribu, k
      value = Math.round(base * mult);
    } else {
      // Without a suffix, every dot/comma is a thousand separator.
      const digits = raw.replace(/[.,]/g, '');
      value = Number.parseInt(digits, 10);
      if (!Number.isFinite(value)) continue;
    }
    if (value <= 0 || value > 1_000_000_000_000) continue;
    const score = (suffix ? 3 : 0) + (hasRp ? 2 : 0) + (hasSeparator ? 1 : 0);
    candidates.push({ value, score, index: m.index });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0].value;
}

export function parsePercent(text: string): number | null {
  const m = /(\d{1,3})\s*%/.exec(text);
  if (!m) return null;
  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value) || value < 1 || value > 100) return null;
  return value;
}

/** "Rp45.000" — Indonesian grouping, no decimals. */
export function formatIDR(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}

/** Signed form for lists: "−Rp45.000" / "+Rp45.000". */
export function formatSignedIDR(amount: number): string {
  if (amount < 0) return `−${formatIDR(Math.abs(amount))}`;
  return `+${formatIDR(amount)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function clampedDay(year: number, month: number, startDay: number): number {
  return Math.min(Math.max(1, startDay), daysInMonth(year, month));
}

export interface CycleRange {
  start: Date;
  end: Date;
}

/**
 * The budget cycle containing `now`. The cycle starts on `startDay` of a
 * month and ends on `startDay` of the next month (clamped when the month is
 * shorter). Both bounds are local midnight.
 */
export function cycleRange(now: Date, startDay: number): CycleRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  let start: Date;
  if (now.getDate() >= clampedDay(year, month, startDay)) {
    start = new Date(year, month, clampedDay(year, month, startDay));
  } else {
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    start = new Date(
      prevYear,
      prevMonth,
      clampedDay(prevYear, prevMonth, startDay),
    );
  }
  const endYear = start.getMonth() === 11 ? start.getFullYear() + 1 : start.getFullYear();
  const endMonth = (start.getMonth() + 1) % 12;
  const end = new Date(endYear, endMonth, clampedDay(endYear, endMonth, startDay));
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { start, end };
}

export function sumSpent(
  transactions: { walletId: string; amount: number; occurredAt: number }[],
  walletId: string,
  fromMs: number,
  toMs: number,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.walletId !== walletId) continue;
    if (t.occurredAt < fromMs || t.occurredAt >= toMs) continue;
    total += t.amount;
  }
  return total;
}

export interface BudgetStatus {
  spent: number;
  budget: number;
  left: number;
  usedPercent: number;
  over: boolean;
  warned: boolean;
}

export function budgetStatus(
  spent: number,
  budget: number,
  warnPercent: number,
): BudgetStatus {
  const left = budget - spent;
  const usedPercent = budget > 0 ? (spent / budget) * 100 : 0;
  return {
    spent,
    budget,
    left,
    usedPercent,
    over: spent > budget,
    warned: usedPercent >= warnPercent,
  };
}
