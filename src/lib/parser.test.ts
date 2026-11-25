// DompetKu v1.0.2 — local rules parser tests.
import { describe, expect, it } from 'vitest';
import { parseUserMessage, type ParserContext } from './parser';
import { STARTER_CATEGORIES } from './categories';
import type { Wallet } from './types';

function makeWallet(id: string, name: string): Wallet {
  return {
    id,
    name,
    currency: 'IDR',
    budgetAmount: 2_000_000,
    cycleStartDay: 1,
    warnPercent: 80,
    createdAt: Date.now(),
  };
}

const ctx: ParserContext = {
  wallets: [makeWallet('w-makan', 'Makan'), makeWallet('w-jajan', 'Jajan')],
  categories: STARTER_CATEGORIES,
  now: new Date(2026, 10, 24, 12, 0, 0),
};

describe('expense note', () => {
  const weeklyCtx: ParserContext = {
    wallets: [makeWallet('w-mingguan', 'Mingguan')],
    categories: STARTER_CATEGORIES,
    now: new Date(2026, 10, 24, 12, 0, 0),
  };

  it('keeps only the item name when the wallet is named in the message', () => {
    const intent = parseUserMessage(
      'masukan jajan sushi 50k ke dompet mingguan',
      weeklyCtx,
    );
    expect(intent).toMatchObject({
      kind: 'log_expense',
      amount: 50_000,
      walletId: 'w-mingguan',
      categoryId: 'makan',
      note: 'sushi',
    });
  });

  it('keeps "Makan siang" intact when a wallet is named Makan', () => {
    const intent = parseUserMessage('Makan siang 30rb di dompet Makan', ctx);
    expect(intent).toMatchObject({
      kind: 'log_expense',
      note: 'Makan siang',
      walletId: 'w-makan',
    });
  });

  it('strips a trailing bare wallet name', () => {
    const intent = parseUserMessage('Beli kopi 25rb ke dompet Harian', {
      ...ctx,
      wallets: [makeWallet('w-harian', 'Harian')],
    });
    expect(intent).toMatchObject({
      kind: 'log_expense',
      note: 'kopi',
      walletId: 'w-harian',
    });
  });

  it('keeps numbers that are part of the item name', () => {
    const intent = parseUserMessage('Beli mie 2 telur 15rb', ctx);
    expect(intent).toMatchObject({
      kind: 'log_expense',
      amount: 15_000,
      note: 'mie 2 telur',
    });
  });
});

describe('price questions are not spending reports', () => {
  it('does not treat "rata rata harga sushi berapa?" as ask_spent', () => {
    expect(parseUserMessage('rata rata harga sushi berapa?', ctx)).toEqual({
      kind: 'unknown',
    });
  });

  it('does not treat "berapa harga kopi?" as ask_spent', () => {
    expect(parseUserMessage('berapa harga kopi?', ctx)).toEqual({
      kind: 'unknown',
    });
  });

  it('still reports spending when the question is about the user', () => {
    const intent = parseUserMessage(
      'rata-rata pengeluaranku bulan ini berapa?',
      ctx,
    );
    expect(intent).toMatchObject({ kind: 'ask_spent', range: 'month' });
  });
});

describe('log_expense', () => {
  it('logs with wallet, category and amount', () => {
    const intent = parseUserMessage('Makan siang 45rb Makan', ctx);
    expect(intent).toMatchObject({
      kind: 'log_expense',
      amount: 45_000,
      walletId: 'w-makan',
      categoryId: 'makan',
      confidence: 'high',
    });
  });

  it('infers the category from keywords', () => {
    const intent = parseUserMessage('Beli kopi 22k', ctx);
    expect(intent).toMatchObject({
      kind: 'log_expense',
      amount: 22_000,
      categoryId: 'makan',
    });
  });

  it('reads kemarin as yesterday', () => {
    const intent = parseUserMessage('Kemarin makan 30rb', ctx);
    expect(intent.kind).toBe('log_expense');
    if (intent.kind === 'log_expense') {
      const day = new Date(intent.occurredAt).getDate();
      expect(day).toBe(23);
    }
  });

  it('asks for confirmation when the message is just an amount', () => {
    const intent = parseUserMessage('2 juta', ctx);
    expect(intent).toMatchObject({ kind: 'log_expense', confidence: 'medium' });
  });
});

describe('questions', () => {
  it('asks spending for today', () => {
    expect(parseUserMessage('Berapa pengeluaranku hari ini?', ctx)).toMatchObject({
      kind: 'ask_spent',
      range: 'today',
    });
  });

  it('asks spending for yesterday', () => {
    expect(parseUserMessage('Berapa pengeluaranku kemarin?', ctx)).toMatchObject({
      kind: 'ask_spent',
      range: 'yesterday',
    });
  });

  it('asks budget left', () => {
    expect(parseUserMessage('Berapa sisa anggaranku?', ctx)).toMatchObject({
      kind: 'ask_budget_left',
    });
  });
});

describe('settings intents', () => {
  it('sets a budget', () => {
    expect(parseUserMessage('Atur anggaran Makan 2 juta', ctx)).toMatchObject({
      kind: 'set_budget',
      walletId: 'w-makan',
      amount: 2_000_000,
    });
  });

  it('sets a warn percent', () => {
    expect(
      parseUserMessage('Ingatkan aku kalau Makan sudah 80%', ctx),
    ).toMatchObject({ kind: 'set_warn', walletId: 'w-makan', percent: 80 });
  });

  it('adds a wallet', () => {
    expect(parseUserMessage('Tambah dompet Liburan', ctx)).toMatchObject({
      kind: 'add_wallet',
      name: 'Liburan',
    });
  });
});

describe('commands', () => {
  it('handles /catat', () => {
    expect(parseUserMessage('/catat 50rb Makan', ctx)).toMatchObject({
      kind: 'log_expense',
      amount: 50_000,
      walletId: 'w-makan',
    });
  });

  it('handles /sisa and /bantuan', () => {
    expect(parseUserMessage('/sisa', ctx)).toMatchObject({ kind: 'ask_budget_left' });
    expect(parseUserMessage('/bantuan', ctx)).toMatchObject({ kind: 'help' });
  });
});

describe('unknown', () => {
  it('returns unknown for greetings', () => {
    expect(parseUserMessage('Halo', ctx)).toMatchObject({ kind: 'unknown' });
  });
});
