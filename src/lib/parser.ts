// DompetKu v1.0.2 — local rules parser for Indonesian chat input.
// Understands amounts ("45rb", "Rp50.000", "1,5jt"), wallets, categories,
// dates ("hari ini", "kemarin") and the common questions. Anything it cannot
// parse confidently goes to the LLM (when a key is set) or to guided help.

import { inferCategory } from './categories';
import { parseAmountId, parsePercent } from './money';
import type { Category, Wallet } from './types';

export type ParsedIntent =
  | {
      kind: 'log_expense';
      amount: number;
      walletId: string | null;
      categoryId: string;
      note: string;
      occurredAt: number;
      confidence: 'high' | 'medium';
    }
  | {
      kind: 'ask_spent';
      range: 'today' | 'yesterday' | 'week' | 'month';
      walletId: string | null;
    }
  | { kind: 'ask_budget_left'; walletId: string | null }
  | { kind: 'set_budget'; walletId: string | null; amount: number }
  | { kind: 'set_warn'; walletId: string | null; percent: number }
  | { kind: 'add_wallet'; name: string }
  | { kind: 'list_wallets' }
  | { kind: 'help' }
  | { kind: 'unknown' };

export interface ParserContext {
  wallets: Wallet[];
  categories: Category[];
  now: Date;
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

export function findWallet(text: string, wallets: Wallet[]): Wallet | null {
  const compact = norm(text).replace(/\s+/g, '');
  let best: Wallet | null = null;
  for (const wallet of wallets) {
    const name = wallet.name.toLowerCase().replace(/\s+/g, '');
    if (name.length > 1 && compact.includes(name)) {
      if (!best || wallet.name.length > best.name.length) best = wallet;
    }
  }
  return best;
}

function findCategoryId(text: string, categories: Category[]): string {
  // A custom category named in the message wins over keyword inference.
  const lower = norm(text);
  for (const category of categories) {
    if (!category.builtin && lower.includes(category.name.toLowerCase())) {
      return category.id;
    }
  }
  return inferCategory(text) ?? 'lainnya';
}

function parseOccurredAt(text: string, now: Date): number {
  if (text.includes('kemarin')) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  return now.getTime();
}

/**
 * Remove the amount-like tokens from a note when they equal the given
 * amount (the echoed price), keeping numbers that are part of the item name
 * — "mie 2 telur" keeps its "2" while a trailing "15rb" comes out.
 */
export function stripAmount(note: string, amount: number): string {
  return note.replace(
    /(?:rp\s*)?\d+(?:[.,]\d+)*\s*(?:rb|ribu|k|jt|juta)?/gi,
    (tok) => (parseAmountId(tok) === amount ? ' ' : tok),
  );
}

/** Words that are instructions, not the item itself. */
const NOTE_FILLERS = [
  'beli',
  'bayar',
  'habis',
  'keluar',
  'jajan',
  'belanja',
  'pakai',
  'tadi',
  'hari ini',
  'kemarin',
  'masukan',
  'masukkan',
  'catat',
  'tambah',
  'tambahkan',
  'isi',
  'buat',
  'untuk',
];

/**
 * Clean a note down to the item name: the wallet phrase ("ke dompet
 * Mingguan", "di dompet Makan", "dompet Harian") and filler verbs come out,
 * and a bare wallet name left at the end ("sushi mingguan") too. Only the
 * phrase is stripped, never the wallet name on its own — so "Makan siang"
 * survives even when a wallet is named "Makan".
 */
export function cleanNote(note: string, wallets: Wallet[]): string {
  let out = note;
  for (const wallet of wallets) {
    const name = wallet.name.trim();
    if (name.length < 2) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`\\b(ke|di|dari|untuk|pada|pakai)\\s+(dompet\\s+)?${esc}\\b`, 'gi'),
      ' ',
    );
    out = out.replace(new RegExp(`\\bdompet\\s+${esc}\\b`, 'gi'), ' ');
  }
  out = out.replace(
    new RegExp(`\\b(${NOTE_FILLERS.join('|')})\\b`, 'gi'),
    ' ',
  );
  for (const wallet of wallets) {
    const name = wallet.name.trim();
    if (name.length < 2) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trimmed = out.replace(new RegExp(`\\b${esc}\\s*$`, 'i'), '').trim();
    if (trimmed) out = trimmed;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function deriveNote(
  text: string,
  amount: number,
  categoryName: string,
  wallets: Wallet[],
): string {
  // Keep the user's own words: only the amount, the wallet phrase and the
  // filler verbs come out.
  const note = cleanNote(stripAmount(text, amount), wallets);
  if (note.length > 120) return note.slice(0, 120).trim();
  return note || categoryName;
}

function parseCommand(text: string, ctx: ParserContext): ParsedIntent | null {
  if (!text.startsWith('/')) return null;
  const parts = text.slice(1).trim().split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();
  const rest = text.slice(1 + (parts[0] ?? '').length).trim();
  const wallet = findWallet(rest, ctx.wallets);
  switch (cmd) {
    case 'catat': {
      const amount = parseAmountId(rest);
      if (amount === null) return { kind: 'unknown' };
      return {
        kind: 'log_expense',
        amount,
        walletId: wallet ? wallet.id : null,
        categoryId: findCategoryId(rest, ctx.categories),
        note: deriveNote(rest, amount, 'Pengeluaran', ctx.wallets),
        occurredAt: parseOccurredAt(norm(rest), ctx.now),
        confidence: 'high',
      };
    }
    case 'sisa':
      return { kind: 'ask_budget_left', walletId: wallet ? wallet.id : null };
    case 'keluar': {
      const lower = norm(rest);
      const range = lower.includes('kemarin')
        ? 'yesterday'
        : lower.includes('minggu')
          ? 'week'
          : lower.includes('bulan')
            ? 'month'
            : 'today';
      return { kind: 'ask_spent', range, walletId: wallet ? wallet.id : null };
    }
    case 'anggaran': {
      const amount = parseAmountId(rest);
      if (amount === null) return { kind: 'unknown' };
      return { kind: 'set_budget', walletId: wallet ? wallet.id : null, amount };
    }
    case 'peringatan': {
      const percent = parsePercent(rest);
      if (percent === null) return { kind: 'unknown' };
      return { kind: 'set_warn', walletId: wallet ? wallet.id : null, percent };
    }
    case 'dompet':
      return { kind: 'list_wallets' };
    case 'bantuan':
      return { kind: 'help' };
    default:
      return { kind: 'unknown' };
  }
}

export function parseUserMessage(raw: string, ctx: ParserContext): ParsedIntent {
  const text = norm(raw);
  if (!text) return { kind: 'unknown' };

  const command = parseCommand(text, ctx);
  if (command) return command;

  const wallet = findWallet(text, ctx.wallets);
  const amount = parseAmountId(text);

  if (hasAny(text, ['bantuan', 'help', 'apa yang bisa', 'cara pakai', 'perintah'])) {
    return { kind: 'help' };
  }
  if (
    hasAny(text, ['daftar dompet', 'dompet saya', 'lihat dompet', 'dompetku']) &&
    amount === null
  ) {
    return { kind: 'list_wallets' };
  }
  if (hasAny(text, ['tambah dompet', 'buat dompet', 'dompet baru'])) {
    const name = raw
      .replace(/tambah dompet|buat dompet|dompet baru/gi, '')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim()
      .slice(0, 40);
    return { kind: 'add_wallet', name: name || 'Dompet baru' };
  }
  if (
    hasAny(text, ['ingatkan', 'peringatan', 'peringatkan', 'warning']) &&
    text.includes('%')
  ) {
    const percent = parsePercent(text);
    if (percent !== null) {
      return { kind: 'set_warn', walletId: wallet ? wallet.id : null, percent };
    }
  }
  if (hasAny(text, ['sisa anggaran', 'sisa budget', 'berapa sisa', 'sisa dompet'])) {
    return { kind: 'ask_budget_left', walletId: wallet ? wallet.id : null };
  }
  if (
    hasAny(text, ['atur anggaran', 'set anggaran', 'pasang anggaran', 'anggaran']) &&
    amount !== null
  ) {
    return { kind: 'set_budget', walletId: wallet ? wallet.id : null, amount };
  }
  // A question about a price ("rata-rata harga sushi berapa?", "berapa
  // harga kopi?") is not a spending report. It only becomes ask_spent when
  // the message is actually about the user's own spending.
  const isPriceQuestion =
    (text.includes('harga') || text.includes('rata')) &&
    !hasAny(text, ['pengeluaran', 'habis', 'keluar', 'total', 'sisa']);
  if (
    !isPriceQuestion &&
    hasAny(text, [
      'berapa',
      'total pengeluaran',
      'pengeluaran',
      'habis berapa',
      'keluar berapa',
    ])
  ) {
    const range = text.includes('kemarin')
      ? 'yesterday'
      : text.includes('minggu')
        ? 'week'
        : text.includes('bulan')
          ? 'month'
          : 'today';
    return { kind: 'ask_spent', range, walletId: wallet ? wallet.id : null };
  }
  if (amount !== null) {
    const hasCue = hasAny(text, [
      'beli',
      'bayar',
      'makan',
      'jajan',
      'belanja',
      'keluar',
      'habis',
      'pakai',
      'naik',
      'isi',
      'tadi',
      'kemarin',
    ]);
    const categoryId = findCategoryId(text, ctx.categories);
    const hasCategory = categoryId !== 'lainnya';
    return {
      kind: 'log_expense',
      amount,
      walletId: wallet ? wallet.id : null,
      categoryId,
      note: deriveNote(
        raw,
        amount,
        ctx.categories.find((c) => c.id === categoryId)?.name ?? 'Pengeluaran',
        ctx.wallets,
      ),
      occurredAt: parseOccurredAt(text, ctx.now),
      confidence: hasCue || hasCategory || wallet !== null ? 'high' : 'medium',
    };
  }
  return { kind: 'unknown' };
}
