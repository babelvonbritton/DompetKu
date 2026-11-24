// DompetKu v1.0.0 — Gemini client error mapping tests.
// The HTTP status is what tells the user what to fix (404 = the key cannot
// reach this model, 400 = bad key, 403 = API not enabled), so it must
// survive the client instead of collapsing to null.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiClient, LlmApiError, LlmQuotaError } from './llm';

const input = {
  message: 'aku pengen makan sushi',
  wallets: [],
  categories: [],
  now: new Date(),
};

function stubWindow(): void {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
}

function stubFetch(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiClient.ask answers', () => {
  function stubAnswer(text: string): void {
    stubFetch(200, {
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ kind: 'answer', text }) }] } },
      ],
    });
  }

  it('passes a direct finance answer through', async () => {
    stubWindow();
    stubAnswer(
      'Rata-rata harga sushi sekitar Rp30rb–Rp80rb per porsi, tergantung restorannya.',
    );
    const client = new GeminiClient('AIzaFake', 'gemini-3.5-flash-lite');
    const result = await client.ask(input);
    expect(result).toMatchObject({ kind: 'answer' });
    if (result && result.kind === 'answer') {
      expect(result.text).toContain('Rp30rb');
    }
  });

  it('cleans an echoed sentence down to the item name', async () => {
    stubWindow();
    const llmInput = {
      message: 'masukan jajan sushi 50k ke dompet mingguan',
      wallets: [
        {
          id: 'w1',
          name: 'Mingguan',
          currency: 'IDR' as const,
          budgetAmount: null,
          cycleStartDay: 1,
          warnPercent: 80,
          createdAt: 0,
        },
      ],
      categories: [{ id: 'makan', name: 'Makan', builtin: true }],
      now: new Date(),
    };
    stubFetch(200, {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  kind: 'log_expense',
                  amount: 50000,
                  walletId: 'w1',
                  categoryId: 'makan',
                  note: 'masukan jajan sushi 50k ke dompet mingguan',
                  when: 'today',
                }),
              },
            ],
          },
        },
      ],
    });
    const client = new GeminiClient('AIzaFake', 'gemini-3.5-flash-lite');
    await expect(client.ask(llmInput)).resolves.toMatchObject({
      kind: 'log_expense',
      note: 'sushi',
    });
  });
});

describe('GeminiClient.ask request security', () => {
  it('sends the key in a header, never in the URL', async () => {
    stubWindow();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new GeminiClient('AIzaSecretKey', 'gemini-3.5-flash-lite');
    await client.ask(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('AIzaSecretKey');
    expect(url).not.toContain('key=');
    expect(options.headers).toMatchObject({
      'x-goog-api-key': 'AIzaSecretKey',
    });
  });

  it('sends wallet and category names but no budget amounts', async () => {
    stubWindow();
    let body = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        body = String(options.body);
        return Promise.resolve(
          new Response(JSON.stringify({ candidates: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    const client = new GeminiClient('AIzaFake', 'gemini-3.5-flash-lite');
    await client.ask({
      message: 'sisa dompet Mingguan berapa?',
      wallets: [
        {
          id: 'w1',
          name: 'Mingguan',
          currency: 'IDR' as const,
          budgetAmount: 1234567,
          cycleStartDay: 1,
          warnPercent: 80,
          createdAt: 0,
        },
      ],
      categories: [{ id: 'makan', name: 'Makan', builtin: true }],
      now: new Date(),
    });
    const parsed = JSON.parse(body) as {
      systemInstruction: { parts: { text: string }[] };
    };
    const prompt = parsed.systemInstruction.parts[0].text;
    expect(prompt).toContain('Mingguan');
    expect(prompt).toContain('Makan');
    expect(prompt).not.toContain('1234567');
  });
});

describe('GeminiClient.ask errors', () => {
  it('throws LlmApiError(404) when the model cannot be reached', async () => {
    stubWindow();
    stubFetch(404, {
      error: {
        code: 404,
        message: 'models/gemini-2.5-flash-lite is not found',
        status: 'NOT_FOUND',
      },
    });
    const client = new GeminiClient('AIzaFake', 'gemini-2.5-flash-lite');
    await expect(client.ask(input)).rejects.toBeInstanceOf(LlmApiError);
    await expect(client.ask(input)).rejects.toMatchObject({
      status: 404,
      model: 'gemini-2.5-flash-lite',
    });
  });

  it('throws LlmQuotaError on 429', async () => {
    stubWindow();
    stubFetch(429);
    const client = new GeminiClient('AIzaFake', 'gemini-3.5-flash-lite');
    await expect(client.ask(input)).rejects.toBeInstanceOf(LlmQuotaError);
  });

  it('returns null on a network failure', async () => {
    stubWindow();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const client = new GeminiClient('AIzaFake', 'gemini-3.5-flash-lite');
    await expect(client.ask(input)).resolves.toBeNull();
  });
});
