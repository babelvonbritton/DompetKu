// DompetKu v1.0.0 — slash-command catalog tests.
// The catalog is the single source of truth for the suggestion menu and
// /bantuan, so these tests also prove every listed command is one the
// parser actually handles.

import { describe, expect, it } from 'vitest';
import {
  CHAT_COMMANDS,
  filterCommands,
  slashQuery,
} from './commands';
import { parseUserMessage, type ParserContext } from './parser';
import { STARTER_CATEGORIES } from './categories';

const ctx: ParserContext = {
  wallets: [
    {
      id: 'w1',
      name: 'Makan',
      currency: 'IDR',
      budgetAmount: 2_000_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: 0,
    },
  ],
  categories: STARTER_CATEGORIES,
  now: new Date(2026, 10, 24, 12),
};

describe('slashQuery', () => {
  it('returns the command name while it is being typed', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/cat')).toBe('cat');
    expect(slashQuery('/sisa')).toBe('sisa');
  });

  it('returns null once the command is chosen (a space follows it)', () => {
    expect(slashQuery('/catat ')).toBeNull();
    expect(slashQuery('/catat makan 45rb')).toBeNull();
  });

  it('returns null when the message is not a command', () => {
    expect(slashQuery('makan siang 45rb')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
});

describe('filterCommands', () => {
  it('shows every command for an empty query', () => {
    expect(filterCommands('')).toEqual(CHAT_COMMANDS);
    expect(filterCommands('').length).toBe(7);
  });

  it('narrows by command-name prefix', () => {
    expect(filterCommands('sis').map((c) => c.name)).toEqual(['sisa']);
    expect(filterCommands('cat').map((c) => c.name)).toEqual(['catat']);
    expect(filterCommands('ban').map((c) => c.name)).toEqual(['bantuan']);
  });

  it('also matches the start of a word in the description', () => {
    // 'siang' in /catat's description starts with 'si'.
    expect(filterCommands('si').map((c) => c.name)).toEqual(['catat', 'sisa']);
    const names = filterCommands('dompet').map((c) => c.name);
    expect(names).toContain('dompet');
    expect(names).toContain('anggaran');
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCommands('xyz')).toEqual([]);
  });
});

describe('catalog matches the parser', () => {
  it('every listed command parses to a real intent', () => {
    const cases: Array<[string, string]> = [
      ['/catat makan 45rb', 'log_expense'],
      ['/sisa', 'ask_budget_left'],
      ['/keluar kemarin', 'ask_spent'],
      ['/anggaran Makan 2 juta', 'set_budget'],
      ['/peringatan 80%', 'set_warn'],
      ['/dompet', 'list_wallets'],
      ['/bantuan', 'help'],
    ];
    for (const [text, kind] of cases) {
      expect(parseUserMessage(text, ctx)).toMatchObject({ kind });
    }
    const names = cases.map(([text]) => text.split(/\s+/)[0].slice(1));
    expect(names.sort()).toEqual(CHAT_COMMANDS.map((c) => c.name).sort());
  });

  it('a custom category named in the message wins over keywords', () => {
    const customCtx: ParserContext = {
      ...ctx,
      categories: [
        ...STARTER_CATEGORIES,
        { id: 'c-jajan', name: 'Jajan', builtin: false },
      ],
    };
    // 'jajan' is also a Makan keyword — the custom name still wins.
    expect(parseUserMessage('Beli jajan 20rb', customCtx)).toMatchObject({
      kind: 'log_expense',
      categoryId: 'c-jajan',
    });
  });
});
