// DompetKu v1.0.3 — encrypted backup round-trip tests.
// Format 3: ZIP holding a plaintext manifest.json plus one file per table,
// each encrypted with its own IV under one PBKDF2 key (310,000
// iterations). The manifest carries per-store counts and SHA-256
// checksums, so a tampered backup fails before anything is restored.
// Format 2 (DMPT envelope, 100k iterations) and v0.1 JSON envelopes
// still import.

import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  BackupService,
  diffBackup,
  validatePassphrase,
  type BackupPayload,
} from './backup';

const service = new BackupService();

const sample: BackupPayload = {
  version: 3,
  exportedAt: 1_764_000_000_000,
  wallets: [
    {
      id: 'w1',
      name: 'Makan',
      currency: 'IDR',
      budgetAmount: 2_000_000,
      cycleStartDay: 1,
      warnPercent: 80,
      createdAt: 1_764_000_000_000,
    },
  ],
  transactions: [
    {
      id: 't1',
      walletId: 'w1',
      type: 'expense',
      amount: 45_000,
      categoryId: 'makan',
      note: 'Makan siang',
      currency: 'IDR',
      occurredAt: 1_764_000_000_000,
      createdAt: 1_764_000_000_000,
      source: 'chat-rules',
    },
  ],
  categories: [{ id: 'makan', name: 'Makan', builtin: true }],
  settings: {
    id: 'main',
    geminiModel: 'gemini-2.5-flash-lite',
    localParserFallback: false,
    launchTab: 'home',
    setupDone: true,
    keyReminderDismissedAt: null,
    driveClientId: 'test-client.apps.googleusercontent.com',
    driveTokenExpiresAt: null,
    driveLastBackupAt: null,
  },
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Build a v0.1-format envelope with the old layout, to prove compat. */
async function buildV1Envelope(
  passphrase: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, 100_000);
  const plain = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      exportedAt: sample.exportedAt,
      wallets: sample.wallets,
      transactions: sample.transactions,
      categories: sample.categories,
      settings: {
        id: 'main',
        geminiModel: 'gemini-2.5-flash-lite',
        launchTab: 'home',
        setupDone: true,
        keyReminderDismissedAt: null,
      },
    }),
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain),
  );
  const envelope = {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(cipher),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/** Build a format-2 DMPT envelope (the v0.2.x layout) with its old
 * 100,000-iteration KDF, to prove old backups still import. */
async function buildV2Envelope(
  passphrase: string,
): Promise<Uint8Array> {
  const toNdjson = (rows: unknown[]): Uint8Array =>
    strToU8(rows.map((r) => JSON.stringify(r)).join('\n'));
  const zip = zipSync({
    'wallets.ndjson': toNdjson(sample.wallets),
    'transactions.ndjson': toNdjson(sample.transactions),
    'categories.ndjson': toNdjson(sample.categories),
    'settings.json': strToU8(JSON.stringify(sample.settings, null, 2)),
    'meta.json': strToU8(
      JSON.stringify({
        app: 'DompetKu',
        format: 2,
        exportedAt: sample.exportedAt,
        counts: { wallets: 1, transactions: 1, categories: 1 },
      }),
    ),
  });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, 100_000);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zip),
  );
  const out = new Uint8Array(5 + 16 + 12 + cipher.length);
  out.set(strToU8('DMPT'), 0);
  out[4] = 2;
  out.set(salt, 5);
  out.set(iv, 21);
  out.set(cipher, 33);
  return out;
}

describe('backup v3', () => {
  it('round-trips through build and parse', async () => {
    const bytes = await service.build(sample, 'rahasia123');
    const { manifest, data: restored } = await service.parse(
      bytes,
      'rahasia123',
    );
    expect(restored.version).toBe(3);
    expect(restored.exportedAt).toBe(sample.exportedAt);
    expect(restored.wallets).toEqual(sample.wallets);
    expect(restored.transactions).toEqual(sample.transactions);
    expect(restored.categories).toEqual(sample.categories);
    expect(restored.settings.driveClientId).toBe(
      'test-client.apps.googleusercontent.com',
    );
    expect(restored.settings.localParserFallback).toBe(false);
    // Secrets never enter a backup: the keys are absent, not just empty.
    expect('geminiApiKey' in restored.settings).toBe(false);
    expect('driveAccessToken' in restored.settings).toBe(false);
    // The manifest is plaintext and carries the checksums.
    expect(manifest?.format).toBe('dompetku-backup');
    expect(manifest?.formatVersion).toBe(3);
    expect(manifest?.encryption.iterations).toBe(310_000);
    expect(manifest?.stores.wallets.count).toBe(1);
    expect(manifest?.stores.transactions.count).toBe(1);
    expect(manifest?.stores.categories.count).toBe(1);
  });

  it('defaults the parser fallback to on for backups without the field', async () => {
    const old = JSON.parse(JSON.stringify(sample)) as BackupPayload;
    delete (old.settings as Partial<typeof old.settings>).localParserFallback;
    const bytes = await service.build(old, 'rahasia123');
    const { data: restored } = await service.parse(bytes, 'rahasia123');
    expect(restored.settings.localParserFallback).toBe(true);
  });

  it('writes a plain ZIP whose manifest is readable without the key', async () => {
    const bytes = await service.build(sample, 'rahasia123');
    expect(strFromU8(bytes.subarray(0, 2))).toBe('PK');
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      'categories.ndjson',
      'manifest.json',
      'settings.json',
      'transactions.ndjson',
      'wallets.ndjson',
    ]);
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      format: string;
      formatVersion: number;
    };
    expect(manifest.format).toBe('dompetku-backup');
    expect(manifest.formatVersion).toBe(3);
  });

  it('rejects a wrong passphrase', async () => {
    const bytes = await service.build(sample, 'rahasia123');
    await expect(service.parse(bytes, 'salah123')).rejects.toThrow(
      'Kata sandi salah',
    );
  });

  it('rejects unreadable files', async () => {
    const bytes = new TextEncoder().encode('bukan cadangan');
    await expect(service.parse(bytes, 'rahasia123')).rejects.toThrow(
      'tidak dikenal',
    );
  });

  it('rejects a backup whose manifest checksum was tampered with', async () => {
    const bytes = await service.build(sample, 'rahasia123');
    const files = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      stores: { wallets: { sha256: string } };
    };
    manifest.stores.wallets.sha256 = '0'.repeat(64);
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    await expect(service.parse(zipSync(files), 'rahasia123')).rejects.toThrow(
      'checksum tidak cocok',
    );
  });

  it('rejects a backup whose manifest count was tampered with', async () => {
    const bytes = await service.build(sample, 'rahasia123');
    const files = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(files['manifest.json'])) as {
      stores: { wallets: { count: number } };
    };
    manifest.stores.wallets.count = 99;
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    await expect(service.parse(zipSync(files), 'rahasia123')).rejects.toThrow(
      'jumlah catatan tidak cocok',
    );
  });

  it('still imports a format-2 DMPT backup', async () => {
    const v2 = await buildV2Envelope('rahasia123');
    const { manifest, data: restored } = await service.parse(v2, 'rahasia123');
    expect(manifest).toBeNull();
    expect(restored.version).toBe(2);
    expect(restored.wallets).toEqual(sample.wallets);
    expect(restored.transactions).toEqual(sample.transactions);
    expect(restored.categories).toEqual(sample.categories);
  });

  it('still imports a v0.1 JSON-envelope backup', async () => {
    const v1 = await buildV1Envelope('rahasia123');
    const { data: restored } = await service.parse(v1, 'rahasia123');
    expect(restored.version).toBe(2);
    expect(restored.wallets).toEqual(sample.wallets);
    expect(restored.transactions).toEqual(sample.transactions);
    expect(restored.categories).toEqual(sample.categories);
  });
});

describe('validatePassphrase', () => {
  it('requires at least 8 characters', () => {
    expect(validatePassphrase('abc123')).toBe('Kata sandi minimal 8 karakter.');
  });

  it('allows only letters and numbers', () => {
    expect(validatePassphrase('abcd1234!')).toBe(
      'Kata sandi hanya boleh huruf dan angka.',
    );
    expect(validatePassphrase('abcd 1234')).toBe(
      'Kata sandi hanya boleh huruf dan angka.',
    );
  });

  it('requires the confirmation to match', () => {
    expect(validatePassphrase('abcd1234', 'abcd1235')).toBe(
      'Konfirmasi kata sandi tidak cocok.',
    );
    expect(validatePassphrase('abcd1234', 'abcd1234')).toBeNull();
  });

  it('accepts a valid passphrase without confirmation', () => {
    expect(validatePassphrase('abcd1234')).toBeNull();
  });
});

describe('diffBackup', () => {
  it('reports identical data', () => {
    const diff = diffBackup(sample, sample);
    expect(diff.identical).toBe(true);
    expect(diff.changes).toEqual([]);
    expect(diff.counts.backup.transactions).toBe(1);
  });

  it('lists what differs', () => {
    const other = JSON.parse(JSON.stringify(sample)) as BackupPayload;
    other.transactions.push({
      id: 't2',
      walletId: 'w1',
      type: 'expense',
      amount: 20_000,
      categoryId: 'makan',
      note: 'Kopi',
      currency: 'IDR',
      occurredAt: 1_764_000_000_000,
      createdAt: 1_764_000_000_000,
      source: 'chat-rules',
    });
    other.wallets[0] = { ...other.wallets[0], budgetAmount: 3_000_000 };
    const diff = diffBackup(sample, other);
    expect(diff.identical).toBe(false);
    expect(diff.changes).toContain('1 pengeluaran baru di cadangan');
    expect(diff.changes).toContain('1 dompet berbeda');
    expect(diff.counts.backup.transactions).toBe(2);
  });

  it('ignores volatile Drive metadata in settings', () => {
    // A Drive backup updates driveLastBackupAt and a token refresh updates
    // driveTokenExpiresAt — neither is a setting the user changed, so a
    // restore after either must still find the data up to date.
    const other = JSON.parse(JSON.stringify(sample)) as BackupPayload;
    other.settings.driveLastBackupAt = 1_765_000_000_000;
    other.settings.driveTokenExpiresAt = 1_765_000_100_000;
    const diff = diffBackup(sample, other);
    expect(diff.identical).toBe(true);
    expect(diff.changes).toEqual([]);
  });

  it('still reports a real settings change', () => {
    const other = JSON.parse(JSON.stringify(sample)) as BackupPayload;
    other.settings.launchTab = 'chat';
    const diff = diffBackup(sample, other);
    expect(diff.identical).toBe(false);
    expect(diff.changes).toContain('Pengaturan berbeda');
  });
});
