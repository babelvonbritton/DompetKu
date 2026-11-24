// DompetKu v1.0.0 — data stores.
// One small class per table. Every query goes through the table's indexes,
// so the app can point at exactly the data the user means: a wallet by name,
// a wallet's spending inside one budget cycle, a wallet's spending in one
// category. Components and the chat engine never touch Dexie directly.

import type { EntityTable } from 'dexie';
import type { DompetKuDb } from './db';
import { defaultSettings } from './db';
import type {
  Category,
  ChatMessage,
  Settings,
  Transaction,
  Wallet,
} from './types';

export class WalletStore {
  private table: EntityTable<Wallet, 'id'>;

  constructor(table: EntityTable<Wallet, 'id'>) {
    this.table = table;
  }

  list(): Promise<Wallet[]> {
    return this.table.orderBy('createdAt').toArray();
  }

  get(id: string): Promise<Wallet | undefined> {
    return this.table.get(id);
  }

  /** Exact name lookup through the name index (case-insensitive). */
  findByName(name: string): Promise<Wallet | undefined> {
    return this.table.where('name').equalsIgnoreCase(name.trim()).first();
  }

  /** Name mentioned inside free text, longest match wins. */
  findInText(text: string): Promise<Wallet | undefined> {
    return this.list().then((wallets) => {
      const compact = text.toLowerCase().replace(/\s+/g, '');
      let best: Wallet | undefined;
      for (const wallet of wallets) {
        const name = wallet.name.toLowerCase().replace(/\s+/g, '');
        if (name.length > 1 && compact.includes(name)) {
          if (!best || wallet.name.length > best.name.length) best = wallet;
        }
      }
      return best;
    });
  }

  put(wallet: Wallet): Promise<string> {
    return this.table.put(wallet);
  }

  add(wallet: Wallet): Promise<string> {
    return this.table.add(wallet);
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  clear(): Promise<void> {
    return this.table.clear();
  }

  bulkAdd(wallets: Wallet[]): Promise<void> {
    return this.table.bulkAdd(wallets).then(() => undefined);
  }
}

export class TransactionStore {
  private table: EntityTable<Transaction, 'id'>;

  constructor(table: EntityTable<Transaction, 'id'>) {
    this.table = table;
  }

  listAll(): Promise<Transaction[]> {
    return this.table.orderBy('occurredAt').toArray();
  }

  /** All of one wallet's transactions, newest first, via the wallet index. */
  async byWallet(walletId: string): Promise<Transaction[]> {
    const rows = await this.table
      .where('walletId')
      .equals(walletId)
      .sortBy('occurredAt');
    return rows.reverse();
  }

  /** One wallet's transactions inside a date range, via the compound index. */
  inRange(
    walletId: string,
    fromMs: number,
    toMs: number,
  ): Promise<Transaction[]> {
    return this.table
      .where('[walletId+occurredAt]')
      .between([walletId, fromMs], [walletId, toMs], true, false)
      .toArray();
  }

  /** Sum of one wallet's spending inside a date range (one cycle, one day). */
  async spentInRange(
    walletId: string,
    fromMs: number,
    toMs: number,
  ): Promise<number> {
    const rows = await this.inRange(walletId, fromMs, toMs);
    return rows.reduce((sum, t) => sum + t.amount, 0);
  }

  /** One wallet's spending in one category, via the compound index. */
  byCategory(walletId: string, categoryId: string): Promise<Transaction[]> {
    return this.table
      .where('[walletId+categoryId]')
      .equals([walletId, categoryId])
      .toArray();
  }

  /**
   * Move every transaction in one category to another (used when a category
   * is deleted). Returns how many moved.
   */
  reassignCategory(fromId: string, toId: string): Promise<number> {
    return this.table
      .where('categoryId')
      .equals(fromId)
      .modify({ categoryId: toId });
  }

  add(tx: Transaction): Promise<string> {
    return this.table.add(tx);
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  deleteByWallet(walletId: string): Promise<void> {
    return this.table
      .where('walletId')
      .equals(walletId)
      .delete()
      .then(() => undefined);
  }

  clear(): Promise<void> {
    return this.table.clear();
  }

  bulkAdd(rows: Transaction[]): Promise<void> {
    return this.table.bulkAdd(rows).then(() => undefined);
  }
}

export class CategoryStore {
  private table: EntityTable<Category, 'id'>;

  constructor(table: EntityTable<Category, 'id'>) {
    this.table = table;
  }

  list(): Promise<Category[]> {
    return this.table.toArray();
  }

  get(id: string): Promise<Category | undefined> {
    return this.table.get(id);
  }

  /** Exact name lookup through the name index (case-insensitive). */
  findByName(name: string): Promise<Category | undefined> {
    return this.table.where('name').equalsIgnoreCase(name.trim()).first();
  }

  put(category: Category): Promise<string> {
    return this.table.put(category);
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  clear(): Promise<void> {
    return this.table.clear();
  }

  bulkAdd(rows: Category[]): Promise<void> {
    return this.table.bulkAdd(rows).then(() => undefined);
  }
}

export class SettingsStore {
  private table: EntityTable<Settings, 'id'>;

  constructor(table: EntityTable<Settings, 'id'>) {
    this.table = table;
  }

  async get(): Promise<Settings> {
    const found = await this.table.get('main');
    // Merge over the defaults so settings stored before a field existed
    // (like localParserFallback) get its default instead of undefined.
    return found ? { ...defaultSettings(), ...found } : defaultSettings();
  }

  async save(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const next = { ...current, ...patch, id: 'main' };
    await this.table.put(next);
    return next;
  }
}

export class ChatMessageStore {
  private table: EntityTable<ChatMessage, 'id'>;

  constructor(table: EntityTable<ChatMessage, 'id'>) {
    this.table = table;
  }

  list(): Promise<ChatMessage[]> {
    return this.table.orderBy('createdAt').toArray();
  }

  bulkAdd(messages: ChatMessage[]): Promise<void> {
    return this.table.bulkAdd(messages).then(() => undefined);
  }

  clear(): Promise<void> {
    return this.table.clear();
  }
}

export interface DataStores {
  wallets: WalletStore;
  transactions: TransactionStore;
  categories: CategoryStore;
  settings: SettingsStore;
  chat: ChatMessageStore;
}

export function createStores(db: DompetKuDb): DataStores {
  return {
    wallets: new WalletStore(db.wallets),
    transactions: new TransactionStore(db.transactions),
    categories: new CategoryStore(db.categories),
    settings: new SettingsStore(db.settings),
    chat: new ChatMessageStore(db.chat),
  };
}
