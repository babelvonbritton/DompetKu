// DompetKu v1.0.0 — Gemini BYOK client.
// Called ONLY when the local rules parser is unsure AND the user set an API
// key. The model only returns JSON matching the parser's intents, and every
// result is validated client-side before the app acts on it.

import { cleanNote, stripAmount, type ParsedIntent } from './parser';
import type { Category, Wallet } from './types';

export class LlmQuotaError extends Error {
  constructor() {
    super('Kuota Gemini habis');
    this.name = 'LlmQuotaError';
  }
}

/** Any other HTTP error from Gemini (400 bad key, 403 not enabled, 404
 *  model the key cannot reach). The status is what tells the user what to
 *  fix, so it travels with the error instead of collapsing to null. */
export class LlmApiError extends Error {
  status: number;
  model: string;
  constructor(status: number, model: string) {
    super(`Gemini menjawab ${status} untuk model ${model}`);
    this.name = 'LlmApiError';
    this.status = status;
    this.model = model;
  }
}

const KNOWN_KINDS = new Set([
  'log_expense',
  'ask_spent',
  'ask_budget_left',
  'set_budget',
  'set_warn',
  'add_wallet',
  'list_wallets',
  'help',
  'answer',
  'refuse',
]);

export interface LlmAskInput {
  message: string;
  wallets: Wallet[];
  categories: Category[];
  now: Date;
}

export interface LlmClient {
  ask(
    input: LlmAskInput,
  ): Promise<
    ParsedIntent | { kind: 'refuse' } | { kind: 'answer'; text: string } | null
  >;
}

export class GeminiClient implements LlmClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  private buildSystemPrompt(input: LlmAskInput): string {
    const walletList = input.wallets
      .map((w) => `- ${w.id}: "${w.name}"`)
      .join('\n');
    const categoryList = input.categories.map((c) => `- ${c.id}: ${c.name}`).join('\n');
    return [
      'Kamu adalah asisten anggaran di aplikasi DompetKu. Kamu hanya membantu soal anggaran dan pengeluaran.',
      'Pertanyaan seputar uang — harga barang/jasa, tips hemat, saran anggaran, penjelasan konsep keuangan — boleh kamu jawab langsung dengan {"kind":"answer","text":"..."}. Topik lain (berita, hiburan, coding, cuaca, dan sebagainya) harus kamu tolak dengan {"kind":"refuse"}.',
      'Balas HANYA dengan satu objek JSON, tanpa teks lain. Bentuknya salah satu dari ini:',
      '{"kind":"log_expense","amount":45000,"walletId":"<id atau null>","categoryId":"<id>","note":"<catatan singkat>","when":"today"|"yesterday"}',
      '{"kind":"ask_spent","range":"today"|"yesterday"|"week"|"month","walletId":"<id atau null>"}',
      '{"kind":"ask_budget_left","walletId":"<id atau null>"}',
      '{"kind":"set_budget","walletId":"<id atau null>","amount":2000000}',
      '{"kind":"set_warn","walletId":"<id atau null>","percent":80}',
      '{"kind":"add_wallet","name":"<nama>"}',
      '{"kind":"list_wallets"}',
      '{"kind":"help"}',
      '{"kind":"answer","text":"<jawaban singkat, maksimal 2-3 kalimat, dalam Bahasa Indonesia>"}',
      '{"kind":"refuse"}',
      `Tanggal dan waktu sekarang: ${input.now.toLocaleString('id-ID')}.`,
      'Dompet yang ada:',
      walletList || '(belum ada dompet)',
      'Kategori yang ada:',
      categoryList,
      'Aturan: amount selalu bilangan bulat rupiah (45rb = 45000, 1,5jt = 1500000).',
      'Kalau dompet tidak disebut dan hanya ada satu dompet, pakai dompet itu. Kalau ada banyak dan tidak disebut, isi walletId null.',
      'Untuk answer: jawab dari pengetahuan umum saja. JANGAN mengarang data pengeluaran pengguna — kamu tidak punya riwayat transaksi. Kalau pertanyaannya soal pengeluaran pengguna sendiri, pakai intent ask_spent/ask_budget_left, bukan answer.',
      'Untuk note pada log_expense: HANYA nama barang/jasa, contoh: "sushi". JANGAN kalimat lengkap, JANGAN jumlah uang, JANGAN nama dompet.',
      'Kalau pesan tidak berhubungan dengan anggaran, jawab {"kind":"refuse"}.',
    ].join('\n');
  }

  private validateIntent(
    raw: unknown,
    input: LlmAskInput,
  ): ParsedIntent | { kind: 'refuse' } | { kind: 'answer'; text: string } | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.kind !== 'string' || !KNOWN_KINDS.has(obj.kind)) return null;
    const walletOk = (id: unknown): id is string | null =>
      id === null ||
      (typeof id === 'string' && input.wallets.some((w) => w.id === id));
    const categoryOk = (id: unknown): id is string =>
      typeof id === 'string' && input.categories.some((c) => c.id === id);
    switch (obj.kind) {
      case 'refuse':
      case 'list_wallets':
      case 'help':
        return { kind: obj.kind } as ParsedIntent | { kind: 'refuse' };
      case 'answer': {
        if (typeof obj.text !== 'string' || !obj.text.trim()) return null;
        return { kind: 'answer', text: obj.text.trim().slice(0, 600) };
      }
      case 'log_expense': {
        if (
          typeof obj.amount !== 'number' ||
          !Number.isFinite(obj.amount) ||
          obj.amount <= 0 ||
          !walletOk(obj.walletId) ||
          !categoryOk(obj.categoryId)
        ) {
          return null;
        }
        const when = obj.when === 'yesterday' ? 'yesterday' : 'today';
        const occurredAt =
          when === 'yesterday'
            ? new Date(input.now.getTime() - 24 * 60 * 60 * 1000).setHours(12, 0, 0, 0)
            : input.now.getTime();
        // The model sometimes echoes the whole sentence as the note, so the
        // same cleaning the local parser uses runs here too.
        const rawNote = typeof obj.note === 'string' ? obj.note : '';
        const note = cleanNote(
          stripAmount(rawNote, Math.round(obj.amount)),
          input.wallets,
        ).slice(0, 120);
        return {
          kind: 'log_expense',
          amount: Math.round(obj.amount),
          walletId: obj.walletId,
          categoryId: obj.categoryId,
          note: note || 'Pengeluaran',
          occurredAt,
          confidence: 'high',
        };
      }
      case 'ask_spent': {
        if (
          !['today', 'yesterday', 'week', 'month'].includes(String(obj.range)) ||
          !walletOk(obj.walletId)
        ) {
          return null;
        }
        return {
          kind: 'ask_spent',
          range: obj.range as 'today' | 'yesterday' | 'week' | 'month',
          walletId: obj.walletId,
        };
      }
      case 'ask_budget_left':
        if (!walletOk(obj.walletId)) return null;
        return { kind: 'ask_budget_left', walletId: obj.walletId };
      case 'set_budget': {
        if (
          typeof obj.amount !== 'number' ||
          !Number.isFinite(obj.amount) ||
          obj.amount <= 0 ||
          !walletOk(obj.walletId)
        ) {
          return null;
        }
        return {
          kind: 'set_budget',
          walletId: obj.walletId,
          amount: Math.round(obj.amount),
        };
      }
      case 'set_warn': {
        if (
          typeof obj.percent !== 'number' ||
          obj.percent < 1 ||
          obj.percent > 100 ||
          !walletOk(obj.walletId)
        ) {
          return null;
        }
        return {
          kind: 'set_warn',
          walletId: obj.walletId,
          percent: Math.round(obj.percent),
        };
      }
      case 'add_wallet': {
        if (typeof obj.name !== 'string' || !obj.name.trim()) return null;
        return { kind: 'add_wallet', name: obj.name.trim().slice(0, 40) };
      }
      default:
        return null;
    }
  }

  /**
   * Ask Gemini to interpret one message. Returns null on any failure that
   * carries no diagnosis (network error, bad JSON, invalid intent) so the
   * caller can fall back to guided help. Throws LlmQuotaError on HTTP 429
   * and LlmApiError on any other HTTP error, so the caller can say what
   * actually went wrong instead of a generic "cannot reach Gemini".
   */
  async ask(
    input: LlmAskInput,
  ): Promise<
    ParsedIntent | { kind: 'refuse' } | { kind: 'answer'; text: string } | null
  > {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.buildSystemPrompt(input) }] },
          contents: [{ role: 'user', parts: [{ text: input.message }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      });
      if (res.status === 429) throw new LlmQuotaError();
      if (!res.ok) throw new LlmApiError(res.status, this.model);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return null;
      }
      return this.validateIntent(parsed, input);
    } catch (error) {
      if (error instanceof LlmQuotaError) throw error;
      if (error instanceof LlmApiError) throw error;
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
