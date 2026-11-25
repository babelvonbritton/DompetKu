// DompetKu v1.0.3 — chat engine tests.
// The wallet question: with more than one wallet the engine asks first
// and only writes once the user names a wallet.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from './db';
import { createStores, type DataStores } from './stores';
import { ChatEngine, typingDelayMs } from './chat';
import { STARTER_CATEGORIES } from './categories';

let stores: DataStores;
let engine: ChatEngine;

async function seed(twoWallets: boolean): Promise<void> {
  await db.delete();
  await db.open();
  stores = createStores(db);
  engine = new ChatEngine(stores);
  await stores.settings.save({ ...defaultSettings(), setupDone: true });
  await stores.categories.bulkAdd(STARTER_CATEGORIES);
  const wallets = [
    {
      id: 'w1',
      name: 'Makan',
      currency: 'IDR' as const,
      budgetAmount: 2_000_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: Date.now(),
    },
  ];
  if (twoWallets) {
    wallets.push({
      id: 'w2',
      name: 'Transportasi',
      currency: 'IDR' as const,
      budgetAmount: 500_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: Date.now(),
    });
  }
  await stores.wallets.bulkAdd(wallets);
}

beforeEach(async () => {
  await seed(true);
});

describe('wallet disambiguation', () => {
  it('asks which wallet when there are two and none is named', async () => {
    const reply = await engine.handle('Beli kopi 25rb', null);
    expect(reply.messages[0].text).toBe('Masuk ke dompet mana?');
    expect(reply.messages[0].quickReplies).toEqual([
      'Makan',
      'Transportasi',
      'Batal',
    ]);
    expect(engine.getPending()?.needsWallet).toBe(true);
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(0);
  });

  it('writes to the wallet the user names', async () => {
    await engine.handle('Beli kopi 25rb', null);
    const reply = await engine.handle('Makan', null);
    expect(reply.messages[0].text).toBe('Sudah dicatat.');
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(25_000);
    expect(engine.getPending()).toBeNull();
  });

  it('re-asks when the named wallet does not exist', async () => {
    await engine.handle('Beli kopi 25rb', null);
    const reply = await engine.handle('Jajan', null);
    expect(reply.messages[0].text).toContain('tidak menemukan dompet');
    expect(engine.getPending()?.needsWallet).toBe(true);
    const rows = await stores.transactions.listAll();
    expect(rows).toHaveLength(0);
  });

  it('cancels on Batal', async () => {
    await engine.handle('Beli kopi 25rb', null);
    const reply = await engine.handle('Batal', null);
    expect(reply.messages[0].text).toBe('Baik, dibatalkan.');
    expect(engine.getPending()).toBeNull();
    expect(await stores.transactions.listAll()).toHaveLength(0);
  });

  it('logs straight into the only wallet', async () => {
    await seed(false);
    const reply = await engine.handle('Makan siang 45rb', null);
    expect(reply.messages[0].text).toBe('Sudah dicatat.');
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
  });

  it('uses the wallet named in the message', async () => {
    const reply = await engine.handle(
      'Naik ojek 20rb pakai dompet Transportasi',
      null,
    );
    expect(reply.messages[0].text).toBe('Sudah dicatat.');
    const rows = await stores.transactions.byWallet('w2');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(20_000);
  });

  it('a wallet name inside the note counts as naming the wallet', async () => {
    const reply = await engine.handle('Makan siang 45rb', null);
    expect(reply.messages[0].text).toBe('Sudah dicatat.');
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    expect(engine.getPending()).toBeNull();
  });
});

describe('help', () => {
  it('lists every slash command', async () => {
    const reply = await engine.handle('/bantuan', null);
    const text = reply.messages[0].text;
    for (const name of ['catat', 'sisa', 'keluar', 'anggaran', 'peringatan', 'dompet', 'bantuan']) {
      expect(text).toContain(`/${name}`);
    }
  });
});

describe('Gemini API errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says plainly when Gemini answers 404 for the model', async () => {
    await stores.settings.save({
      geminiApiKey: 'AIzaFake',
      geminiModel: 'gemini-2.5-flash-lite',
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 404 } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const reply = await engine.handle(
      'aku pengen makan sushi besok tapi yang murah',
      null,
    );
    const text = reply.messages[0].text;
    expect(text).toContain('404');
    expect(text).toContain('gemini-2.5-flash-lite');
    expect(text).toContain('gemini-3.5-flash-lite');
  });
});

describe('Gemini direct answers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers a price question directly instead of a spending report', async () => {
    await stores.settings.save({
      geminiApiKey: 'AIzaFake',
      geminiModel: 'gemini-3.5-flash-lite',
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        kind: 'answer',
                        text: 'Rata-rata harga sushi sekitar Rp30rb–Rp80rb per porsi.',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    const reply = await engine.handle('rata rata harga sushi berapa?', null);
    expect(reply.messages[0].text).toContain('Rp30rb');
  });
});

describe('Gemini-first with the local parser as fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchJson(body: unknown, status = 200): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  }

  function geminiBody(obj: unknown): unknown {
    return {
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    };
  }

  async function seedWithKey(fallback: boolean): Promise<void> {
    await stores.settings.save({
      geminiApiKey: 'AIzaFake',
      geminiModel: 'gemini-3.5-flash-lite',
      localParserFallback: fallback,
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  }

  it('Gemini answers first even when the parser could handle the message', async () => {
    await seedWithKey(true);
    stubFetchJson(
      geminiBody({
        kind: 'log_expense',
        amount: 50000,
        walletId: 'w1',
        categoryId: 'makan',
        note: 'sushi',
        when: 'today',
      }),
    );
    await engine.handle('Makan siang 45rb', null);
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    // The parser would have logged 45rb with the note "Makan siang" — the
    // values here are the ones Gemini returned, so Gemini ran first.
    expect(rows[0].amount).toBe(50_000);
    expect(rows[0].note).toBe('sushi');
  });

  it('falls back to the parser when Gemini cannot be reached', async () => {
    await seedWithKey(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    await engine.handle('Makan siang 45rb', null);
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(45_000);
  });

  it('shows the offline message and writes nothing when the fallback is off', async () => {
    await seedWithKey(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const reply = await engine.handle('Makan siang 45rb', null);
    expect(reply.messages[0].text).toContain('belum bisa menghubungi Gemini');
    expect(await stores.transactions.listAll()).toHaveLength(0);
  });

  it('falls back to the parser when the quota is exhausted', async () => {
    await seedWithKey(true);
    stubFetchJson({ error: { code: 429 } }, 429);
    await engine.handle('Makan siang 45rb', null);
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(45_000);
  });

  it('warns about a broken key and still falls back to the parser', async () => {
    await seedWithKey(true);
    stubFetchJson({ error: { code: 404 } }, 404);
    const reply = await engine.handle('Makan siang 45rb', null);
    expect(reply.messages[0].text).toContain('404');
    const rows = await stores.transactions.byWallet('w1');
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(45_000);
  });

  it('slash commands stay local and never call Gemini', async () => {
    await seedWithKey(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const reply = await engine.handle('/sisa', null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply.messages[0].text).toContain('sisa anggaran');
  });
});

describe('typing delay', () => {
  it('has a floor and a cap', () => {
    const short = typingDelayMs([
      { id: 'a', role: 'assistant', text: 'Ya.', createdAt: 0 },
    ]);
    expect(short).toBeGreaterThanOrEqual(900);
    const long = typingDelayMs([
      {
        id: 'b',
        role: 'assistant',
        text: 'kata '.repeat(200),
        createdAt: 0,
      },
    ]);
    expect(long).toBe(2800);
  });

  it('grows with the reply', () => {
    const one = typingDelayMs([
      { id: 'a', role: 'assistant', text: 'Sudah dicatat.', createdAt: 0 },
    ]);
    const many = typingDelayMs([
      {
        id: 'b',
        role: 'assistant',
        text: 'Sudah dicatat. Sisa anggaran Makan Rp1.955.000 dari Rp2.000.000, 2% terpakai.',
        createdAt: 0,
      },
    ]);
    expect(many).toBeGreaterThan(one);
  });
});
