// DompetKu v1.0.0 — store tests (Dexie v2 indexes, fake IndexedDB).
// Proves the indexed queries the engine relies on: wallet by name,
// spending in a date range, spending in one category.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, defaultSettings } from './db';
import { createStores, type DataStores } from './stores';
import { STARTER_CATEGORIES } from './categories';
import type { Transaction } from './types';

let stores: DataStores;

function tx(
  id: string,
  walletId: string,
  categoryId: string,
  amount: number,
  occurredAt: number,
): Transaction {
  return {
    id,
    walletId,
    type: 'expense',
    amount,
    categoryId,
    note: `test ${id}`,
    currency: 'IDR',
    occurredAt,
    createdAt: occurredAt,
    source: 'manual',
  };
}

const NOV_23 = new Date(2026, 10, 23, 12).getTime();
const NOV_24 = new Date(2026, 10, 24, 12).getTime();
const NOV_24_LATE = new Date(2026, 10, 24, 13).getTime();
const NOV_24_START = new Date(2026, 10, 24, 0).getTime();
const NOV_25_START = new Date(2026, 10, 25, 0).getTime();
const DEC_1 = new Date(2026, 11, 1, 0).getTime();

beforeEach(async () => {
  await db.delete();
  await db.open();
  stores = createStores(db);
  await stores.settings.save({ ...defaultSettings(), setupDone: true });
  await stores.categories.bulkAdd(STARTER_CATEGORIES);
  await stores.wallets.bulkAdd([
    {
      id: 'w1',
      name: 'Makan',
      currency: 'IDR',
      budgetAmount: 2_000_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: NOV_23,
    },
    {
      id: 'w2',
      name: 'Transportasi',
      currency: 'IDR',
      budgetAmount: 500_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: NOV_23,
    },
  ]);
  await stores.transactions.bulkAdd([
    tx('t1', 'w1', 'makan', 45_000, NOV_24),
    tx('t2', 'w1', 'makan', 30_000, NOV_23),
    tx('t3', 'w1', 'transportasi', 15_000, NOV_24_LATE),
    tx('t4', 'w2', 'transportasi', 20_000, NOV_24),
  ]);
});

describe('WalletStore', () => {
  it('finds a wallet by name through the index, case-insensitive', async () => {
    const found = await stores.wallets.findByName('makan');
    expect(found?.id).toBe('w1');
    const upper = await stores.wallets.findByName('MAKAN');
    expect(upper?.id).toBe('w1');
    const missing = await stores.wallets.findByName('tidak ada');
    expect(missing).toBeUndefined();
  });

  it('finds a wallet named inside free text', async () => {
    const found = await stores.wallets.findInText('naik ojek pakai dompet transportasi');
    expect(found?.id).toBe('w2');
  });
});

describe('TransactionStore', () => {
  it('sums one wallet spending inside a date range', async () => {
    const oneDay = await stores.transactions.spentInRange(
      'w1',
      NOV_24_START,
      NOV_25_START,
    );
    expect(oneDay).toBe(60_000); // 45.000 makan + 15.000 transportasi
    const month = await stores.transactions.spentInRange('w1', NOV_24_START, DEC_1);
    expect(month).toBe(60_000);
    const other = await stores.transactions.spentInRange(
      'w2',
      NOV_24_START,
      NOV_25_START,
    );
    expect(other).toBe(20_000);
  });

  it('lists one wallet transactions by category', async () => {
    const rows = await stores.transactions.byCategory('w1', 'makan');
    expect(rows.map((r) => r.id).sort()).toEqual(['t1', 't2']);
  });

  it('lists one wallet transactions, newest first', async () => {
    const rows = await stores.transactions.byWallet('w1');
    expect(rows.map((r) => r.id)).toEqual(['t3', 't1', 't2']);
  });

  it('moves every transaction in a category to another', async () => {
    const moved = await stores.transactions.reassignCategory(
      'transportasi',
      'lainnya',
    );
    expect(moved).toBe(2);
    const rows = await stores.transactions.byCategory('w1', 'lainnya');
    expect(rows.map((r) => r.id)).toEqual(['t3']);
    const other = await stores.transactions.byCategory('w2', 'lainnya');
    expect(other.map((r) => r.id)).toEqual(['t4']);
  });
});

describe('CategoryStore', () => {
  it('adds and deletes a custom category', async () => {
    await stores.categories.put({ id: 'c1', name: 'Jajan', builtin: false });
    expect(
      (await stores.categories.list()).map((c) => c.id),
    ).toContain('c1');
    await stores.categories.delete('c1');
    expect(
      (await stores.categories.list()).map((c) => c.id),
    ).not.toContain('c1');
  });

  it('finds a category by name, case-insensitive', async () => {
    const found = await stores.categories.findByName('MAKAN');
    expect(found?.id).toBe('makan');
  });
});

describe('ChatMessageStore', () => {
  it('clears every message', async () => {
    await stores.chat.bulkAdd([
      {
        id: 'm1',
        role: 'user',
        text: 'Makan siang 45rb',
        createdAt: NOV_24,
      },
      {
        id: 'm2',
        role: 'assistant',
        text: 'Dicatat.',
        createdAt: NOV_24,
      },
    ]);
    expect(await stores.chat.list()).toHaveLength(2);
    await stores.chat.clear();
    expect(await stores.chat.list()).toHaveLength(0);
  });
});
