// DompetKu v1.0.2 — starter categories and keyword inference for the
// local rules parser. Category names are native Indonesian, known terms.

import type { Category } from './types';

export const STARTER_CATEGORIES: Category[] = [
  { id: 'makan', name: 'Makan', builtin: true },
  { id: 'transportasi', name: 'Transportasi', builtin: true },
  { id: 'hiburan', name: 'Hiburan', builtin: true },
  { id: 'tagihan', name: 'Tagihan', builtin: true },
  { id: 'lainnya', name: 'Lainnya', builtin: true },
];

/** Lowercase keywords (word or phrase) that hint at a category. */
const KEYWORDS: Record<string, string[]> = {
  makan: [
    'makan',
    'sarapan',
    'lunch',
    'dinner',
    'kopi',
    'coffee',
    'ngopi',
    'jajan',
    'snack',
    'camilan',
    'resto',
    'restoran',
    'warteg',
    'boba',
    'teh',
    'minum',
    'roti',
    'nasi',
    'mie',
    'bakso',
    'soto',
    'ayam',
    'burger',
    'pizza',
    'gofood',
    'grabfood',
    'belanja', // groceries land in Makan only when no better match below
  ],
  transportasi: [
    'transport',
    'transportasi',
    'bensin',
    'bbm',
    'ojek',
    'ojol',
    'grab',
    'gojek',
    'gocar',
    'bus',
    'kereta',
    'krl',
    'mrt',
    'tol',
    'parkir',
    'tiket',
    'bahan bakar',
  ],
  hiburan: [
    'hiburan',
    'nonton',
    'bioskop',
    'film',
    'game',
    'spotify',
    'netflix',
    'konser',
    'main',
    'karaoke',
    'futsal',
    'gym',
    'langganan film',
  ],
  tagihan: [
    'tagihan',
    'listrik',
    'air',
    'internet',
    'wifi',
    'pulsa',
    'langganan',
    'sewa',
    'kos',
    'kost',
    'iuran',
    'bpjs',
    'asuransi',
  ],
};

/**
 * Guess a category from free text. Returns null when nothing matches, so the
 * caller can fall back to 'lainnya' or ask the user.
 */
export function inferCategory(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  let best: { id: string; score: number } | null = null;
  for (const [id, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const word of words) {
      if (lower.includes(word)) score += word.includes(' ') ? 2 : 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { id, score };
    }
  }
  return best ? best.id : null;
}
