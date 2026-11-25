// DompetKu v1.0.3 — chat engine.
// Cascade: with a Gemini key, Gemini answers first and the local rules
// parser is the fallback (network failure, quota). Without a key the parser
// is the only engine. Slash commands always go to the parser — they are
// explicit syntax, not natural language. The app works fully without LLM.
//
// The engine reads everything through the stores (indexed queries), so it
// always points at the exact wallet, category, and cycle the user means.
// When a message could go into more than one wallet, it asks first and
// waits for the wallet name before writing anything.

import { cycleRange, budgetStatus, formatIDR } from './money';
import { CHAT_COMMANDS } from './commands';
import { DEFAULT_MODEL } from './db';
import { parseUserMessage, type ParsedIntent } from './parser';
import { GeminiClient, LlmApiError, LlmQuotaError, type LlmClient } from './llm';
import type { DataStores } from './stores';
import type {
  Category,
  ChatCard,
  ChatMessage,
  Settings,
  Transaction,
  TransactionSource,
  Wallet,
} from './types';
import { uid } from './types';

export interface PendingIntent {
  intent: Extract<
    ParsedIntent,
    { kind: 'log_expense' | 'set_budget' | 'set_warn' }
  >;
  summary: string;
  /** Set while the engine waits for the user to name a wallet. */
  needsWallet: boolean;
}

export interface EngineReply {
  messages: ChatMessage[];
  /** How long the typing indicator should show, in ms. */
  typingMs: number;
}

function assistant(text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: uid(),
    role: 'assistant',
    text,
    createdAt: Date.now(),
    ...extra,
  };
}

/**
 * Typing time grows with the reply, so a short answer appears quickly and a
 * long one feels typed rather than pasted. Bounded so it never drags.
 */
export function typingDelayMs(messages: ChatMessage[]): number {
  const words = messages
    .map((m) => m.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.min(2800, Math.max(900, 800 + words * 70));
}

function categoryName(categories: Category[], id: string): string {
  return categories.find((c) => c.id === id)?.name ?? 'Lainnya';
}

export class ChatEngine {
  private pending: PendingIntent | null = null;
  private stores: DataStores;

  constructor(stores: DataStores) {
    this.stores = stores;
  }

  getPending(): PendingIntent | null {
    return this.pending;
  }

  private async resolveWallet(
    wallets: Wallet[],
    walletId: string | null,
  ): Promise<Wallet | null> {
    if (walletId) return wallets.find((w) => w.id === walletId) ?? null;
    if (wallets.length === 1) return wallets[0];
    return null;
  }

  private walletQuickReplies(wallets: Wallet[]): string[] {
    return [...wallets.map((w) => w.name), 'Batal'];
  }

  private rangeBounds(
    range: 'today' | 'yesterday' | 'week' | 'month',
    wallet: Wallet | null,
    now: Date,
  ): { from: number; to: number; label: string } {
    const startOfDay = (d: Date): number => {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy.getTime();
    };
    const todayStart = startOfDay(now);
    const day = 24 * 60 * 60 * 1000;
    switch (range) {
      case 'today':
        return { from: todayStart, to: todayStart + day, label: 'hari ini' };
      case 'yesterday':
        return { from: todayStart - day, to: todayStart, label: 'kemarin' };
      case 'week': {
        const d = new Date(now);
        const dayOfWeek = (d.getDay() + 6) % 7; // Monday = 0
        const monday = startOfDay(new Date(d.getTime() - dayOfWeek * day));
        return { from: monday, to: now.getTime(), label: 'minggu ini' };
      }
      case 'month': {
        if (wallet) {
          const { start, end } = cycleRange(now, wallet.cycleStartDay);
          return {
            from: start.getTime(),
            to: end.getTime(),
            label: `periode ini (${start.getDate()}/${start.getMonth() + 1}–${end.getDate()}/${end.getMonth() + 1})`,
          };
        }
        const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
        return { from: start, to: end, label: 'bulan ini' };
      }
    }
  }

  private budgetLeftNote(wallet: Wallet, spent: number): string {
    if (wallet.budgetAmount === null) {
      return 'Dompet ini belum punya anggaran. Atur di tab Dompet supaya aku bisa mengingatkanmu.';
    }
    const status = budgetStatus(spent, wallet.budgetAmount, wallet.warnPercent);
    return `Sisa anggaran ${wallet.name}: ${formatIDR(status.left)} dari ${formatIDR(wallet.budgetAmount)}, ${Math.round(status.usedPercent)}% terpakai.`;
  }

  private async executeLogExpense(
    intent: Extract<ParsedIntent, { kind: 'log_expense' }>,
    wallets: Wallet[],
    categories: Category[],
    source: TransactionSource,
    now: Date,
  ): Promise<EngineReply> {
    const wallet = await this.resolveWallet(wallets, intent.walletId);
    if (!wallet) {
      this.pending = {
        intent,
        summary: `Catat ${formatIDR(intent.amount)} (${intent.note})`,
        needsWallet: true,
      };
      const messages = [
        assistant('Masuk ke dompet mana?', {
          quickReplies: this.walletQuickReplies(wallets),
        }),
      ];
      return { messages, typingMs: typingDelayMs(messages) };
    }
    const cycle = cycleRange(now, wallet.cycleStartDay);
    const spentBefore = await this.stores.transactions.spentInRange(
      wallet.id,
      cycle.start.getTime(),
      cycle.end.getTime(),
    );
    const tx: Transaction = {
      id: uid(),
      walletId: wallet.id,
      type: 'expense',
      amount: intent.amount,
      categoryId: intent.categoryId,
      note: intent.note,
      currency: 'IDR',
      occurredAt: intent.occurredAt,
      createdAt: now.getTime(),
      source,
    };
    await this.stores.transactions.add(tx);
    const spentAfter = spentBefore + intent.amount;
    const card: ChatCard = {
      title: intent.note,
      rows: [
        { label: 'Jumlah', value: formatIDR(intent.amount) },
        {
          label: 'Dompet',
          value: `${wallet.name} · ${categoryName(categories, intent.categoryId)}`,
        },
        {
          label: 'Tanggal',
          value: new Date(intent.occurredAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        },
      ],
      note: this.budgetLeftNote(wallet, spentAfter),
      tone: 'info',
    };
    const messages: ChatMessage[] = [assistant('Sudah dicatat.', { card })];
    if (wallet.budgetAmount !== null) {
      const before = budgetStatus(spentBefore, wallet.budgetAmount, wallet.warnPercent);
      const after = budgetStatus(spentAfter, wallet.budgetAmount, wallet.warnPercent);
      if (!before.over && after.over) {
        messages.push(
          assistant(
            `Anggaran ${wallet.name} sudah lewat. Kamu sudah memakai ${formatIDR(after.spent)} dari ${formatIDR(wallet.budgetAmount)}.`,
            {
              card: {
                title: 'Anggaran lewat',
                rows: [
                  { label: 'Terpakai', value: formatIDR(after.spent) },
                  { label: 'Anggaran', value: formatIDR(wallet.budgetAmount) },
                  { label: 'Kelebihan', value: formatIDR(-after.left) },
                ],
                tone: 'danger',
              },
            },
          ),
        );
      } else if (!before.warned && after.warned) {
        messages.push(
          assistant(
            `Hati-hati, dompet ${wallet.name} sudah ${Math.round(after.usedPercent)}% dari anggaran bulan ini. Sisa ${formatIDR(after.left)}.`,
            {
              card: {
                title: 'Mendekati batas anggaran',
                rows: [
                  { label: 'Terpakai', value: formatIDR(after.spent) },
                  { label: 'Sisa', value: formatIDR(after.left) },
                ],
                tone: 'warn',
              },
            },
          ),
        );
      }
    }
    return { messages, typingMs: typingDelayMs(messages) };
  }

  private async executeIntent(
    intent: ParsedIntent,
    wallets: Wallet[],
    categories: Category[],
    source: TransactionSource,
    now: Date,
  ): Promise<EngineReply> {
    switch (intent.kind) {
      case 'log_expense':
        return this.executeLogExpense(intent, wallets, categories, source, now);
      case 'ask_spent': {
        const wallet = await this.resolveWallet(wallets, intent.walletId);
        const { from, to, label } = this.rangeBounds(intent.range, wallet, now);
        const targets = wallet ? [wallet] : wallets;
        const sums = await Promise.all(
          targets.map((w) =>
            this.stores.transactions.spentInRange(w.id, from, to),
          ),
        );
        const rows = targets.map((w, i) => ({
          label: w.name,
          value: formatIDR(sums[i]),
        }));
        const total = sums.reduce((a, b) => a + b, 0);
        const messages = [
          assistant(`Pengeluaran ${label}: ${formatIDR(total)}.`, {
            card: {
              title: `Pengeluaran ${label}`,
              rows,
              tone: 'info',
            },
          }),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'ask_budget_left': {
        const wallet = await this.resolveWallet(wallets, intent.walletId);
        const targets = wallet ? [wallet] : wallets;
        const rows = await Promise.all(
          targets.map(async (w) => {
            if (w.budgetAmount === null) {
              return { label: w.name, value: 'Belum diatur' };
            }
            const cycle = cycleRange(now, w.cycleStartDay);
            const spent = await this.stores.transactions.spentInRange(
              w.id,
              cycle.start.getTime(),
              cycle.end.getTime(),
            );
            const status = budgetStatus(spent, w.budgetAmount, w.warnPercent);
            return {
              label: w.name,
              value: `${formatIDR(status.left)} lagi (${Math.round(status.usedPercent)}% terpakai)`,
            };
          }),
        );
        const messages = [
          assistant('Ini sisa anggaranmu.', {
            card: { title: 'Sisa anggaran', rows, tone: 'info' },
          }),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'set_budget': {
        const wallet = await this.resolveWallet(wallets, intent.walletId);
        if (!wallet) {
          this.pending = {
            intent,
            summary: `Atur anggaran ${formatIDR(intent.amount)}`,
            needsWallet: true,
          };
          const messages = [
            assistant('Atur anggaran untuk dompet yang mana?', {
              quickReplies: this.walletQuickReplies(wallets),
            }),
          ];
          return { messages, typingMs: typingDelayMs(messages) };
        }
        await this.stores.wallets.put({ ...wallet, budgetAmount: intent.amount });
        const messages = [
          assistant(
            `Anggaran ${wallet.name} diatur ke ${formatIDR(intent.amount)} per bulan. Aku ingatkan kamu kalau sudah ${wallet.warnPercent}%.`,
          ),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'set_warn': {
        const wallet = await this.resolveWallet(wallets, intent.walletId);
        if (!wallet) {
          this.pending = {
            intent,
            summary: `Atur peringatan ${intent.percent}%`,
            needsWallet: true,
          };
          const messages = [
            assistant('Peringatan untuk dompet yang mana?', {
              quickReplies: this.walletQuickReplies(wallets),
            }),
          ];
          return { messages, typingMs: typingDelayMs(messages) };
        }
        await this.stores.wallets.put({ ...wallet, warnPercent: intent.percent });
        const messages = [
          assistant(
            `Siap. Aku ingatkan kamu kalau dompet ${wallet.name} sudah ${intent.percent}% dari anggaran.`,
          ),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'add_wallet': {
        const wallet: Wallet = {
          id: uid(),
          name: intent.name,
          currency: 'IDR',
          budgetAmount: null,
          cycleStartDay: 1,
          warnPercent: 80,
          createdAt: now.getTime(),
        };
        await this.stores.wallets.put(wallet);
        const messages = [
          assistant(
            `Dompet "${wallet.name}" sudah dibuat. Atur anggarannya di tab Dompet supaya aku bisa mengingatkanmu.`,
          ),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'list_wallets': {
        const rows = await Promise.all(
          wallets.map(async (w) => {
            if (w.budgetAmount === null) {
              return { label: w.name, value: 'Belum ada anggaran' };
            }
            const cycle = cycleRange(now, w.cycleStartDay);
            const spent = await this.stores.transactions.spentInRange(
              w.id,
              cycle.start.getTime(),
              cycle.end.getTime(),
            );
            const status = budgetStatus(spent, w.budgetAmount, w.warnPercent);
            return {
              label: w.name,
              value: `${formatIDR(status.left)} lagi dari ${formatIDR(w.budgetAmount)}`,
            };
          }),
        );
        const messages = [
          assistant('Ini dompetmu.', {
            card: { title: 'Dompet', rows, tone: 'info' },
          }),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'help': {
        const lines = CHAT_COMMANDS.map((c) => `/${c.name} — ${c.description}`);
        const messages = [
          assistant(
            `Perintah yang bisa kamu pakai (ketik / di chat untuk melihat daftarnya):\n${lines.join('\n')}\n\nAtau tulis saja dengan kalimat biasa, contohnya "Makan siang 45rb".`,
            {
              quickReplies: [
                'Makan siang 45rb',
                'Berapa pengeluaranku hari ini?',
                'Berapa sisa anggaranku?',
                'Atur anggaran Makan 2 juta',
              ],
            },
          ),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      case 'unknown':
        return { messages: [], typingMs: 0 };
    }
  }

  private llmClient(settings: Settings): LlmClient | null {
    if (!settings.geminiApiKey) return null;
    return new GeminiClient(settings.geminiApiKey, settings.geminiModel);
  }

  /**
   * Ask Gemini to handle one message. Returns `handled` when Gemini
   * answered (an intent, a direct answer, or a refusal), and `fallback`
   * when it could not — network failure, bad JSON, or quota — so the caller
   * can hand the message to the local parser. A setup error (400/403/404)
   * is not silent: its text travels as `warning`, shown above whatever the
   * parser does, so a broken key never hides behind the fallback.
   */
  private async askGemini(
    client: LlmClient,
    text: string,
    lastAssistantText: string | null,
    wallets: Wallet[],
    categories: Category[],
    now: Date,
  ): Promise<
    | { kind: 'handled'; reply: EngineReply }
    | { kind: 'fallback'; warning: string | null; offline: EngineReply }
  > {
    const messageForLlm = lastAssistantText
      ? `Konteks balasan terakhirku: ${lastAssistantText.slice(0, 500)}\nPesan baru: ${text}`
      : text;
    const quickReplies = ['Makan siang 45rb', 'Berapa sisa anggaranku?'];
    const offline = (body: string): EngineReply => {
      const messages = [assistant(body, { quickReplies })];
      return { messages, typingMs: typingDelayMs(messages) };
    };
    try {
      const llmIntent = await client.ask({
        message: messageForLlm,
        wallets,
        categories,
        now,
      });
      if (!llmIntent) {
        return {
          kind: 'fallback',
          warning: null,
          offline: offline(
            'Aku belum bisa menghubungi Gemini saat ini. Coba lagi nanti, atau pakai kalimat seperti "Makan siang 45rb".',
          ),
        };
      }
      if (llmIntent.kind === 'refuse') {
        const messages = [
          assistant(
            'Maaf, aku hanya membantu soal anggaran dan pengeluaran. Coba tanya soal pengeluaran atau anggaranmu.',
          ),
        ];
        return { kind: 'handled', reply: { messages, typingMs: typingDelayMs(messages) } };
      }
      if (llmIntent.kind === 'answer') {
        const messages = [assistant(llmIntent.text)];
        return { kind: 'handled', reply: { messages, typingMs: typingDelayMs(messages) } };
      }
      const reply = await this.executeIntent(
        llmIntent,
        wallets,
        categories,
        'chat-llm',
        now,
      );
      return { kind: 'handled', reply };
    } catch (error) {
      if (error instanceof LlmQuotaError) {
        return {
          kind: 'fallback',
          warning: null,
          offline: offline(
            'Kuota gratis Gemini hari ini habis (reset tengah malam WIB). Aku tetap bisa membantumu dengan perintah seperti "Makan siang 45rb" atau "Berapa sisa anggaranku?".',
          ),
        };
      }
      if (error instanceof LlmApiError) {
        const apiText =
          error.status === 404
            ? `Gemini menjawab 404 untuk model ${error.model} — kunci ini tidak punya akses ke model itu. Ganti model di Pengaturan, misalnya ke ${DEFAULT_MODEL}.`
            : error.status === 400
              ? 'Gemini menolak kunci API ini (400). Periksa lagi kunci yang ditempel di Pengaturan — mungkin ada karakter yang hilang.'
              : error.status === 403
                ? 'Gemini menolak kunci ini (403) — API-nya belum diaktifkan untuk proyek kunci ini. Pakai kunci dari AI Studio.'
                : `Gemini menjawab ${error.status}. Coba lagi nanti, atau pakai kalimat seperti "Makan siang 45rb".`;
        return { kind: 'fallback', warning: apiText, offline: offline(apiText) };
      }
      return {
        kind: 'fallback',
        warning: null,
        offline: offline(
          'Ada gangguan saat menghubungi Gemini. Coba lagi, atau pakai kalimat seperti "Makan siang 45rb".',
        ),
      };
    }
  }

  /**
   * Handle one message with the local rules parser. Used when there is no
   * Gemini key, and as the fallback when Gemini could not answer.
   */
  private async runLocal(
    text: string,
    wallets: Wallet[],
    categories: Category[],
    source: TransactionSource,
    now: Date,
    hasKey: boolean,
  ): Promise<EngineReply> {
    const intent = parseUserMessage(text, { wallets, categories, now });
    if (intent.kind === 'unknown') {
      const hint = hasKey
        ? 'Gemini sedang tidak bisa dihubungi dan aturan lokal pun tidak memahami kalimat ini.'
        : 'Kalau kamu tambahkan kunci API Gemini di Pengaturan, aku bisa memahami bahasa yang lebih bebas.';
      const messages = [
        assistant(
          `Aku belum paham kalimat itu. Aku paling paham kalimat seperti "Makan siang 45rb" atau "Berapa pengeluaranku hari ini?". ${hint}`,
          {
            quickReplies: [
              'Makan siang 45rb',
              'Berapa pengeluaranku hari ini?',
              'Berapa sisa anggaranku?',
            ],
          },
        ),
      ];
      return { messages, typingMs: typingDelayMs(messages) };
    }

    // Medium-confidence expense logs ask for confirmation first.
    if (intent.kind === 'log_expense' && intent.confidence === 'medium') {
      this.pending = {
        intent,
        summary: `Catat ${formatIDR(intent.amount)}`,
        needsWallet: false,
      };
      const messages = [
        assistant(`Maksudmu catat pengeluaran ${formatIDR(intent.amount)}?`, {
          quickReplies: ['Ya, catat', 'Batal'],
        }),
      ];
      return { messages, typingMs: typingDelayMs(messages) };
    }

    return this.executeIntent(intent, wallets, categories, source, now);
  }

  /**
   * Handle one user message. Returns assistant messages to show.
   * `lastAssistantText` is the previous assistant reply, passed as the only
   * conversation context to the LLM when it is called.
   */
  async handle(
    rawText: string,
    lastAssistantText: string | null,
  ): Promise<EngineReply> {
    const text = rawText.trim();
    const now = new Date();
    if (!text) return { messages: [], typingMs: 0 };

    const [wallets, categories] = await Promise.all([
      this.stores.wallets.list(),
      this.stores.categories.list(),
    ]);

    const lower = text.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (this.pending) {
      const pending = this.pending;
      if (YES_WORDS.has(lower)) {
        this.pending = null;
        const source: TransactionSource = text.startsWith('/')
          ? 'chat-command'
          : 'chat-rules';
        return this.executeIntent(pending.intent, wallets, categories, source, now);
      }
      if (NO_WORDS.has(lower)) {
        this.pending = null;
        const messages = [assistant('Baik, dibatalkan.')];
        return { messages, typingMs: typingDelayMs(messages) };
      }
      if (pending.needsWallet) {
        // The answer is a wallet name: exact match through the name index
        // first, then a name mentioned inside the reply.
        const named =
          (await this.stores.wallets.findByName(text)) ??
          (await this.stores.wallets.findInText(text));
        if (named) {
          this.pending = null;
          const source: TransactionSource = text.startsWith('/')
            ? 'chat-command'
            : 'chat-rules';
          const intent = { ...pending.intent, walletId: named.id };
          return this.executeIntent(intent, wallets, categories, source, now);
        }
        const messages = [
          assistant(
            `Aku tidak menemukan dompet bernama "${text}". Pilih salah satu di bawah ini, atau ketik Batal.`,
            { quickReplies: this.walletQuickReplies(wallets) },
          ),
        ];
        return { messages, typingMs: typingDelayMs(messages) };
      }
    }

    // The message was not an answer to the pending question, so the user
    // has moved on: drop the pending item and handle the new message fresh.
    this.pending = null;

    const source: TransactionSource = text.startsWith('/')
      ? 'chat-command'
      : 'chat-rules';
    const settings = await this.stores.settings.get();
    const client = this.llmClient(settings);

    // Slash commands are explicit syntax: the local parser always handles
    // them, with or without a key.
    if (text.startsWith('/')) {
      return this.runLocal(text, wallets, categories, source, now, !!client);
    }

    // With a key, Gemini answers first and the local parser is the fallback.
    if (client) {
      const gemini = await this.askGemini(
        client,
        text,
        lastAssistantText,
        wallets,
        categories,
        now,
      );
      if (gemini.kind === 'handled') return gemini.reply;
      if (!settings.localParserFallback) return gemini.offline;
      const local = await this.runLocal(
        text,
        wallets,
        categories,
        source,
        now,
        true,
      );
      if (!gemini.warning) return local;
      const messages = [
        assistant(gemini.warning, {
          quickReplies: ['Makan siang 45rb', 'Berapa sisa anggaranku?'],
        }),
        ...local.messages,
      ];
      return { messages, typingMs: typingDelayMs(messages) };
    }

    // No key: the local parser is the only engine.
    return this.runLocal(text, wallets, categories, source, now, false);
  }
}

const YES_WORDS = new Set(['ya', 'iya', 'betul', 'benar', 'oke', 'ok', 'yap', 'catat', 'setuju']);
const NO_WORDS = new Set(['bukan', 'batal', 'tidak', 'nggak', 'gak', 'jangan', 'enggak']);
