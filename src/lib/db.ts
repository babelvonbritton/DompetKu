// DompetKu v1.0.0 — local-first store (Dexie / IndexedDB).
// Everything lives on the device. No account, no server.

import Dexie, { type EntityTable } from 'dexie';
import type {
  Category,
  ChatMessage,
  Settings,
  Transaction,
  Wallet,
} from './types';
import { STARTER_CATEGORIES } from './categories';

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * The model name the app shipped with before. Google limits the 2.5 models
 * to keys that already used them, so a fresh key gets a 404 for it.
 */
const LEGACY_MODEL = 'gemini-2.5-flash-lite';

/** Move a stored model name to the current default when it can no longer
 *  be reached with a fresh key. A model the user typed themselves stays. */
export function migrateModel(model: string): string {
  return model === LEGACY_MODEL ? DEFAULT_MODEL : model;
}

export class DompetKuDb extends Dexie {
  wallets!: EntityTable<Wallet, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  chat!: EntityTable<ChatMessage, 'id'>;

  constructor() {
    super('dompetku');
    this.version(1).stores({
      wallets: 'id, createdAt',
      transactions: 'id, walletId, occurredAt, createdAt',
      categories: 'id',
      settings: 'id',
      chat: 'id, createdAt',
    });
    // v2 adds the indexes the stores query on: wallet name lookups, and
    // transactions by wallet + date (spending in a budget cycle) and by
    // wallet + category. Dexie upgrades the schema in place; data is kept.
    this.version(2).stores({
      wallets: 'id, name, createdAt',
      transactions:
        'id, walletId, categoryId, occurredAt, [walletId+occurredAt], [walletId+categoryId]',
      categories: 'id, name',
      settings: 'id',
      chat: 'id, createdAt',
    });
  }
}

export const db = new DompetKuDb();

export function defaultSettings(): Settings {
  return {
    id: 'main',
    geminiApiKey: null,
    geminiModel: DEFAULT_MODEL,
    localParserFallback: true,
    launchTab: 'home',
    setupDone: false,
    keyReminderDismissedAt: null,
    driveClientId: null,
    driveAccessToken: null,
    driveTokenExpiresAt: null,
    driveLastBackupAt: null,
  };
}

/** Create starter categories and default settings when the app runs first. */
export async function ensureSeed(): Promise<void> {
  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    await db.categories.bulkAdd(STARTER_CATEGORIES);
  }
  const existing = await db.settings.get('main');
  if (!existing) {
    await db.settings.add(defaultSettings());
    return;
  }
  // A stored legacy model breaks every Gemini call for a fresh key, so move
  // it to the current default on boot.
  if (existing.geminiModel === LEGACY_MODEL) {
    await db.settings.put({ ...existing, geminiModel: DEFAULT_MODEL });
  }
}

export async function getSettings(): Promise<Settings> {
  const found = await db.settings.get('main');
  return found ?? defaultSettings();
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch, id: 'main' };
  await db.settings.put(next);
  return next;
}
