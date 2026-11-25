// DompetKu v1.0.2 — shared types.
// Comments are general and functional only.

export type CurrencyCode = 'IDR';

// 'income' comes later; the field exists now so adding it is not a rewrite.
export type TransactionType = 'expense';

export type TransactionSource =
  | 'chat-rules'
  | 'chat-llm'
  | 'chat-command'
  | 'manual';

export interface Wallet {
  id: string;
  name: string;
  currency: CurrencyCode;
  /** Monthly budget in IDR. null = not set yet (the app reminds the user). */
  budgetAmount: number | null;
  /** First day of the monthly cycle, 1..31 (clamped to the month length). */
  cycleStartDay: number;
  /** Warn when spending reaches this percent of the budget. */
  warnPercent: number;
  createdAt: number;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  /** Amount in IDR, positive integer. */
  amount: number;
  categoryId: string;
  note: string;
  currency: CurrencyCode;
  /** When the spending happened (may be earlier than createdAt). */
  occurredAt: number;
  createdAt: number;
  source: TransactionSource;
}

export interface Category {
  id: string;
  name: string;
  builtin: boolean;
}

export interface Settings {
  id: string; // always 'main'
  geminiApiKey: string | null;
  geminiModel: string;
  /**
   * When a Gemini key is set, Gemini answers first and the local parser is
   * only the fallback (network failure, quota). Turned off, Gemini is the
   * only engine. Without a key this is ignored — the parser is the only
   * engine there is, so it cannot be turned off.
   */
  localParserFallback: boolean;
  launchTab: 'home' | 'chat';
  setupDone: boolean;
  /** Last time the user dismissed the "add your API key" chat reminder. */
  keyReminderDismissedAt: number | null;
  /** Google OAuth client ID for Drive backup (public identifier, not a secret). */
  driveClientId: string | null;
  /** Drive access token for this device. Never included in a backup. */
  driveAccessToken: string | null;
  /** When the Drive access token expires (epoch ms). */
  driveTokenExpiresAt: number | null;
  /** When the last Drive backup finished (epoch ms). */
  driveLastBackupAt: number | null;
}

export interface DriveBackupInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size: number;
}

export interface ChatCardRow {
  label: string;
  value: string;
}

export interface ChatCard {
  title: string;
  rows: ChatCardRow[];
  note?: string;
  tone?: 'info' | 'warn' | 'danger';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  card?: ChatCard;
  quickReplies?: string[];
  createdAt: number;
}

export type TabId = 'home' | 'wallets' | 'chat' | 'history' | 'settings';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
