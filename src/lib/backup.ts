// DompetKu v1.0.3 — passphrase-encrypted backup (WebCrypto AES-GCM).
//
// Format 3 (current, after Repo/Olaseena): a ZIP holding a plaintext
// manifest.json plus one file per table, each encrypted with its own IV
// under one PBKDF2-derived key (310,000 iterations). The manifest carries
// per-store counts and SHA-256 checksums, so a backup that decrypts but
// is truncated or swapped fails loudly instead of restoring silently.
// The ZIP itself is never trusted blindly: entry allowlist, archive and
// entry size caps, and record-level validation run before anything is
// written. Format 2 (DMPT envelope, 100k iterations) and format 1 (JSON
// envelope) still import — their old iteration count is kept per version,
// so old backups stay readable.
//
// The passphrase is never stored. The API key and Drive token never go
// into a backup.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DEFAULT_MODEL, migrateModel } from './db';
import { sha256Hex } from './hash';
import { APP_VERSION } from './version';
import type { Category, Settings, Transaction, Wallet } from './types';

export interface BackupPayload {
  version: 2 | 3;
  exportedAt: number;
  wallets: Wallet[];
  transactions: Transaction[];
  categories: Category[];
  settings: Omit<Settings, 'geminiApiKey' | 'driveAccessToken'>;
}

export type BackupKind = 'backup' | 'safety';

export interface BackupManifest {
  format: 'dompetku-backup';
  formatVersion: 3;
  schemaVersion: 1;
  kind: BackupKind;
  app: { name: 'DompetKu'; version: string };
  createdAt: string;
  createdAtMs: number;
  stores: Record<TableName, { count: number; sha256: string }>;
  files: { name: string; bytes: number; sha256: string; iv: string }[];
  encryption: {
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
  };
}

export type TableName =
  | 'wallets'
  | 'transactions'
  | 'categories'
  | 'settings';

export interface TableCounts {
  wallets: number;
  transactions: number;
  categories: number;
}

export interface BackupDiff {
  identical: boolean;
  counts: { current: TableCounts; backup: TableCounts };
  changes: string[];
}

const TABLE_FOR_FILE: Record<string, TableName> = {
  'wallets.ndjson': 'wallets',
  'transactions.ndjson': 'transactions',
  'categories.ndjson': 'categories',
  'settings.json': 'settings',
};

const MAGIC = 'DMPT';
const FORMAT_VERSION = 3;
const LEGACY_FORMAT_VERSION = 2;
const SCHEMA_VERSION = 1;
const KDF_ITERATIONS_V3 = 310_000;
const KDF_ITERATIONS_V2 = 100_000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_INFLATED_BYTES = 100 * 1024 * 1024;

const CONTENT_FILES = [
  'wallets.ndjson',
  'transactions.ndjson',
  'categories.ndjson',
  'settings.json',
] as const;

const TABLE_NAMES: TableName[] = [
  'wallets',
  'transactions',
  'categories',
  'settings',
];

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(text: string): Uint8Array {
  if (!/^[0-9a-f]+$/.test(text) || text.length % 2 !== 0) {
    throw new Error('Isi cadangan rusak (manifest).');
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

async function encryptWithKey(
  key: CryptoKey,
  plain: Uint8Array,
): Promise<{ cipher: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plain as BufferSource,
    ),
  );
  return { cipher, iv };
}

async function decryptWithKey(
  key: CryptoKey,
  cipher: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        cipher as BufferSource,
      ),
    );
  } catch {
    throw new Error('Kata sandi salah atau file rusak.');
  }
}

/** The backup passphrase rule: at least 8 characters, letters and
 * numbers only. Returns the Indonesian error, or null when it passes.
 * `confirm` is only checked when given (creation); restoring an old
 * backup never enforces the format, so backups made before this rule
 * stay readable. */
export function validatePassphrase(
  passphrase: string,
  confirm?: string,
): string | null {
  if (passphrase.length < 8) return 'Kata sandi minimal 8 karakter.';
  if (!/^[A-Za-z0-9]+$/.test(passphrase)) {
    return 'Kata sandi hanya boleh huruf dan angka.';
  }
  if (confirm !== undefined && passphrase !== confirm) {
    return 'Konfirmasi kata sandi tidak cocok.';
  }
  return null;
}

function toNdjson(rows: unknown[]): Uint8Array {
  return strToU8(rows.map((r) => JSON.stringify(r)).join('\n'));
}

function countsOf(payload: BackupPayload): TableCounts {
  return {
    wallets: payload.wallets.length,
    transactions: payload.transactions.length,
    categories: payload.categories.length,
  };
}

/** SHA-256 fingerprint of the current data, for the stale check: a restore
 * refuses to write when the data changed between the comparison and the
 * apply. The arrays are sorted by id so the order does not matter. */
export async function fingerprintOf(payload: BackupPayload): Promise<string> {
  const sorted = {
    wallets: [...payload.wallets].sort((a, b) => a.id.localeCompare(b.id)),
    transactions: [...payload.transactions].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    categories: [...payload.categories].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    settings: payload.settings,
  };
  return sha256Hex(JSON.stringify(sorted));
}

function tableDiff<T extends { id: string }>(
  label: string,
  current: T[],
  backup: T[],
  changes: string[],
): void {
  const cur = new Map(current.map((r) => [r.id, r]));
  const bak = new Map(backup.map((r) => [r.id, r]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [id, row] of bak) {
    const other = cur.get(id);
    if (!other) added++;
    else if (JSON.stringify(other) !== JSON.stringify(row)) changed++;
  }
  for (const id of cur.keys()) {
    if (!bak.has(id)) removed++;
  }
  if (added > 0) changes.push(`${added} ${label} baru di cadangan`);
  if (removed > 0) changes.push(`${removed} ${label} hanya ada di data saat ini`);
  if (changed > 0) changes.push(`${changed} ${label} berbeda`);
}

/** Compare the current data with a backup: identical, the counts on both
 * sides, and a short list of what differs, in plain Indonesian. */
/**
 * Settings minus the volatile Drive metadata. driveLastBackupAt changes on
 * every Drive backup and driveTokenExpiresAt on every token refresh, and
 * neither is a setting the user chose — counting them would make every
 * restore after a Drive backup or a refresh report "Pengaturan berbeda"
 * even when nothing the user set has changed.
 */
function comparableSettings(settings: BackupPayload['settings']) {
  const { driveLastBackupAt, driveTokenExpiresAt, ...rest } = settings;
  void driveLastBackupAt;
  void driveTokenExpiresAt;
  return rest;
}

export function diffBackup(
  current: BackupPayload,
  backup: BackupPayload,
): BackupDiff {
  const changes: string[] = [];
  tableDiff('dompet', current.wallets, backup.wallets, changes);
  tableDiff('pengeluaran', current.transactions, backup.transactions, changes);
  tableDiff('kategori', current.categories, backup.categories, changes);
  if (
    JSON.stringify(comparableSettings(current.settings)) !==
    JSON.stringify(comparableSettings(backup.settings))
  ) {
    changes.push('Pengaturan berbeda');
  }
  return {
    identical: changes.length === 0,
    counts: { current: countsOf(current), backup: countsOf(backup) },
    changes,
  };
}

// ------------------------------------------------------------------ v3

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Record-level validation for one NDJSON file: every line must parse,
 * be an object, and pass the table's checks. Failures name the file and
 * the line, so a corrupt backup says exactly where it broke. */
function validateRows<T>(
  bytes: Uint8Array,
  file: string,
  check: (row: Record<string, unknown>, line: number) => T,
): T[] {
  const text = strFromU8(bytes).trim();
  if (!text) return [];
  const lines = text.split('\n');
  const seen = new Set<string>();
  const rows: T[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Isi cadangan rusak (${file} baris ${i + 1}).`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`Isi cadangan rusak (${file} baris ${i + 1}).`);
    }
    const row = check(parsed, i + 1);
    const id = (row as { id: string }).id;
    if (seen.has(id)) {
      throw new Error(`Isi cadangan rusak (${file} baris ${i + 1}: id ganda).`);
    }
    seen.add(id);
    rows.push(row);
  }
  return rows;
}

function checkWallet(row: Record<string, unknown>, line: number): Wallet {
  const file = 'dompet';
  const fail = (why: string): never => {
    throw new Error(`Isi cadangan rusak (${file} baris ${line}: ${why}).`);
  };
  if (!isNonEmptyString(row.id)) fail('id kosong');
  if (!isNonEmptyString(row.name)) fail('nama kosong');
  if (
    row.budgetAmount !== null &&
    (!isFiniteNumber(row.budgetAmount) || row.budgetAmount < 0)
  ) {
    fail('anggaran tidak valid');
  }
  if (
    !isFiniteNumber(row.cycleStartDay) ||
    row.cycleStartDay < 1 ||
    row.cycleStartDay > 31
  ) {
    fail('awal siklus tidak valid');
  }
  if (
    !isFiniteNumber(row.warnPercent) ||
    row.warnPercent < 0 ||
    row.warnPercent > 100
  ) {
    fail('peringatan tidak valid');
  }
  if (!isFiniteNumber(row.createdAt)) fail('tanggal tidak valid');
  return row as unknown as Wallet;
}

function checkCategory(row: Record<string, unknown>, line: number): Category {
  if (!isNonEmptyString(row.id)) {
    throw new Error(`Isi cadangan rusak (kategori baris ${line}: id kosong).`);
  }
  if (!isNonEmptyString(row.name)) {
    throw new Error(
      `Isi cadangan rusak (kategori baris ${line}: nama kosong).`,
    );
  }
  return row as unknown as Category;
}

function checkTransaction(
  row: Record<string, unknown>,
  line: number,
  walletIds: Set<string>,
  categoryIds: Set<string>,
): Transaction {
  const fail = (why: string): never => {
    throw new Error(
      `Isi cadangan rusak (transaksi baris ${line}: ${why}).`,
    );
  };
  if (!isNonEmptyString(row.id)) fail('id kosong');
  if (!isNonEmptyString(row.walletId) || !walletIds.has(row.walletId as string)) {
    fail('dompet tidak dikenal');
  }
  if (
    !isNonEmptyString(row.categoryId) ||
    !categoryIds.has(row.categoryId as string)
  ) {
    fail('kategori tidak dikenal');
  }
  if (row.type !== 'expense' && row.type !== 'income') fail('jenis tidak valid');
  if (!isFiniteNumber(row.amount) || row.amount < 0) fail('jumlah tidak valid');
  if (!isFiniteNumber(row.occurredAt) || !isFiniteNumber(row.createdAt)) {
    fail('tanggal tidak valid');
  }
  return row as unknown as Transaction;
}

function parseSettings(raw: unknown): BackupPayload['settings'] {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Isi cadangan tidak lengkap.');
  }
  const s = raw as Record<string, unknown>;
  return {
    id: 'main',
    geminiModel:
      typeof s.geminiModel === 'string'
        ? migrateModel(s.geminiModel)
        : DEFAULT_MODEL,
    localParserFallback: s.localParserFallback !== false,
    launchTab: s.launchTab === 'chat' ? 'chat' : 'home',
    setupDone: s.setupDone === true,
    keyReminderDismissedAt:
      typeof s.keyReminderDismissedAt === 'number'
        ? s.keyReminderDismissedAt
        : null,
    driveClientId: typeof s.driveClientId === 'string' ? s.driveClientId : null,
    driveTokenExpiresAt: null,
    driveLastBackupAt:
      typeof s.driveLastBackupAt === 'number' ? s.driveLastBackupAt : null,
  };
}

/** Walk the ZIP local file headers and read each entry's sizes before
 * inflating anything, so an oversized or booby-trapped archive is refused
 * before it can allocate. */
function zipEntrySizes(bytes: Uint8Array): {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}[] {
  const entries: {
    name: string;
    compressedSize: number;
    uncompressedSize: number;
  }[] = [];
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) {
      throw new Error('File cadangan tidak bisa dibaca.');
    }
    const name = strFromU8(bytes.subarray(nameStart, nameEnd));
    entries.push({ name, compressedSize, uncompressedSize });
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries;
}

function validateManifest(raw: unknown): BackupManifest {
  const bad = (): Error => new Error('Isi cadangan rusak (manifest).');
  if (!isRecord(raw)) throw bad();
  if (raw.format !== 'dompetku-backup') throw bad();
  if (raw.formatVersion !== FORMAT_VERSION) {
    if (typeof raw.formatVersion === 'number' && raw.formatVersion > FORMAT_VERSION) {
      throw new Error(
        'Cadangan ini dari versi DompetKu yang lebih baru. Perbarui aplikasinya dulu.',
      );
    }
    throw bad();
  }
  if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      'Cadangan ini dari versi DompetKu yang lebih baru. Perbarui aplikasinya dulu.',
    );
  }
  if (raw.kind !== 'backup' && raw.kind !== 'safety') throw bad();
  if (!isRecord(raw.app) || raw.app.name !== 'DompetKu') throw bad();
  if (!isRecord(raw.encryption)) throw bad();
  if (
    raw.encryption.kdf !== 'PBKDF2-SHA256' ||
    raw.encryption.iterations !== KDF_ITERATIONS_V3 ||
    typeof raw.encryption.salt !== 'string'
  ) {
    throw bad();
  }
  if (!isRecord(raw.stores)) throw bad();
  const isSha = (v: unknown): v is string =>
    typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  for (const name of TABLE_NAMES) {
    const store = (raw.stores as Record<string, unknown>)[name];
    if (!isRecord(store)) throw bad();
    if (!isFiniteNumber(store.count) || store.count < 0) throw bad();
    if (!isSha(store.sha256)) throw bad();
  }
  if (!Array.isArray(raw.files)) throw bad();
  for (const file of raw.files as unknown[]) {
    if (!isRecord(file)) throw bad();
    if (
      !isNonEmptyString(file.name) ||
      !isFiniteNumber(file.bytes) ||
      file.bytes < 0 ||
      !isSha(file.sha256) ||
      typeof file.iv !== 'string' ||
      !/^[0-9a-f]{24}$/.test(file.iv)
    ) {
      throw bad();
    }
  }
  return raw as unknown as BackupManifest;
}

export type ParseProgressStep =
  | 'read'
  | 'unpack'
  | 'metadata'
  | 'decrypt'
  | 'checksum'
  | 'structure';

export type BuildProgressStep = 'package' | 'encrypt' | 'verify';

export class BackupService {
  static fileName(kind: BackupKind, date = new Date()): string {
    const stamp = date.toISOString().slice(0, 10);
    return kind === 'safety'
      ? `dompetku-cadangan-pengaman-${stamp}.dompetku`
      : `dompetku-cadangan-${stamp}.dompetku`;
  }

  /** Build the encrypted backup bytes for the given data (format 3).
   * The finished archive is re-verified (decrypt + checksums) before it
   * is returned, so a broken export never reaches the user as a file. */
  async build(
    payload: BackupPayload,
    passphrase: string,
    kind: BackupKind = 'backup',
    onProgress?: (step: BuildProgressStep) => void | Promise<void>,
  ): Promise<Uint8Array> {
    await onProgress?.('package');
    const plain: Record<string, Uint8Array> = {
      'wallets.ndjson': toNdjson(payload.wallets),
      'transactions.ndjson': toNdjson(payload.transactions),
      'categories.ndjson': toNdjson(payload.categories),
      'settings.json': strToU8(JSON.stringify(payload.settings, null, 2)),
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt, KDF_ITERATIONS_V3);
    await onProgress?.('encrypt');
    const stores = {} as BackupManifest['stores'];
    const files: BackupManifest['files'] = [];
    const encrypted: Record<string, Uint8Array> = {};
    for (const name of CONTENT_FILES) {
      const bytes = plain[name];
      const { cipher, iv } = await encryptWithKey(key, bytes);
      encrypted[name] = cipher;
      files.push({
        name,
        bytes: bytes.length,
        sha256: await sha256Hex(bytes),
        iv: hex(iv),
      });
    }
    const tableForFile: Record<string, TableName> = TABLE_FOR_FILE;
    for (const file of files) {
      const table = tableForFile[file.name];
      stores[table] = {
        count:
          table === 'settings'
            ? 1
            : table === 'wallets'
              ? payload.wallets.length
              : table === 'transactions'
                ? payload.transactions.length
                : payload.categories.length,
        sha256: file.sha256,
      };
    }
    const manifest: BackupManifest = {
      format: 'dompetku-backup',
      formatVersion: FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      kind,
      app: { name: 'DompetKu', version: APP_VERSION },
      createdAt: new Date(payload.exportedAt).toISOString(),
      createdAtMs: payload.exportedAt,
      stores,
      files,
      encryption: {
        kdf: 'PBKDF2-SHA256',
        iterations: KDF_ITERATIONS_V3,
        salt: hex(salt),
      },
    };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
      ...encrypted,
    });
    await onProgress?.('verify');
    const checked = await this.parse(zip, passphrase);
    const expected = countsOf(payload);
    const got = countsOf(checked.data);
    if (
      expected.wallets !== got.wallets ||
      expected.transactions !== got.transactions ||
      expected.categories !== got.categories
    ) {
      throw new Error('Cadangan gagal dibuat (verifikasi gagal).');
    }
    return zip;
  }

  /** Read backup bytes (v3 ZIP, v2 DMPT envelope, or v0.1 JSON envelope)
   * and verify them fully. Nothing is written by this method. */
  async parse(
    bytes: Uint8Array,
    passphrase: string,
    onProgress?: (step: ParseProgressStep) => void | Promise<void>,
  ): Promise<{ manifest: BackupManifest | null; data: BackupPayload }> {
    await onProgress?.('read');
    if (bytes.length >= 4 && strFromU8(bytes.subarray(0, 4)) === MAGIC) {
      return { manifest: null, data: await this.parseV2(bytes, passphrase) };
    }
    if (bytes.length > 0 && bytes[0] === 0x7b) {
      return { manifest: null, data: await this.parseV1(bytes, passphrase) };
    }
    return this.parseV3(bytes, passphrase, onProgress);
  }

  private async parseV3(
    bytes: Uint8Array,
    passphrase: string,
    onProgress?: (step: ParseProgressStep) => void | Promise<void>,
  ): Promise<{ manifest: BackupManifest; data: BackupPayload }> {
    if (bytes.length > MAX_ARCHIVE_BYTES) {
      throw new Error('File cadangan terlalu besar (maksimal 25 MB).');
    }
    await onProgress?.('unpack');
    let entries: ReturnType<typeof zipEntrySizes>;
    try {
      entries = zipEntrySizes(bytes);
    } catch {
      throw new Error('File cadangan tidak bisa dibaca.');
    }
    if (entries.length === 0) {
      throw new Error('File cadangan tidak dikenal.');
    }
    const names = entries.map((e) => e.name);
    const allowed = new Set(['manifest.json', ...CONTENT_FILES]);
    for (const name of names) {
      if (!allowed.has(name)) {
        throw new Error('Isi cadangan tidak dikenal.');
      }
    }
    if (new Set(names).size !== names.length) {
      throw new Error('Isi cadangan rusak (entri ganda).');
    }
    if (!names.includes('manifest.json')) {
      throw new Error('Isi cadangan tidak lengkap.');
    }
    let totalInflated = 0;
    for (const entry of entries) {
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error('File cadangan terlalu besar.');
      }
      totalInflated += entry.uncompressedSize;
    }
    if (totalInflated > MAX_TOTAL_INFLATED_BYTES) {
      throw new Error('File cadangan terlalu besar.');
    }
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      throw new Error('Isi cadangan rusak.');
    }
    await onProgress?.('metadata');
    let manifestRaw: unknown;
    try {
      manifestRaw = JSON.parse(strFromU8(files['manifest.json']));
    } catch {
      throw new Error('Isi cadangan rusak (manifest).');
    }
    const manifest = validateManifest(manifestRaw);
    for (const name of CONTENT_FILES) {
      if (!files[name]) throw new Error('Isi cadangan tidak lengkap.');
    }
    await onProgress?.('decrypt');
    const key = await deriveKey(
      passphrase,
      fromHex(manifest.encryption.salt),
      manifest.encryption.iterations,
    );
    const plain: Record<string, Uint8Array> = {};
    for (const entry of manifest.files) {
      const cipher = files[entry.name];
      if (!cipher) throw new Error('Isi cadangan tidak lengkap.');
      plain[entry.name] = await decryptWithKey(
        key,
        cipher,
        fromHex(entry.iv),
      );
    }
    await onProgress?.('checksum');
    for (const entry of manifest.files) {
      const bytes = plain[entry.name];
      if (bytes.length !== entry.bytes) {
        throw new Error('Cadangan rusak (ukuran file tidak cocok).');
      }
      const hash = await sha256Hex(bytes);
      if (hash !== entry.sha256) {
        throw new Error('Cadangan rusak (checksum tidak cocok).');
      }
      // The store record must agree with its file: tampering with either
      // side is caught here, not at restore time.
      if (manifest.stores[TABLE_FOR_FILE[entry.name]].sha256 !== hash) {
        throw new Error('Cadangan rusak (checksum tidak cocok).');
      }
    }
    await onProgress?.('structure');
    const wallets = validateRows<Wallet>(
      plain['wallets.ndjson'],
      'dompet',
      checkWallet,
    );
    const categories = validateRows<Category>(
      plain['categories.ndjson'],
      'kategori',
      checkCategory,
    );
    const walletIds = new Set(wallets.map((w) => w.id));
    const categoryIds = new Set(categories.map((c) => c.id));
    const transactions = validateRows<Transaction>(
      plain['transactions.ndjson'],
      'transaksi',
      (row, line) => checkTransaction(row, line, walletIds, categoryIds),
    );
    for (const name of TABLE_NAMES) {
      const store = manifest.stores[name];
      const count =
        name === 'settings'
          ? 1
          : name === 'wallets'
            ? wallets.length
            : name === 'transactions'
              ? transactions.length
              : categories.length;
      if (store.count !== count) {
        throw new Error('Cadangan rusak (jumlah catatan tidak cocok).');
      }
    }
    let settingsRaw: unknown;
    try {
      settingsRaw = JSON.parse(strFromU8(plain['settings.json']));
    } catch {
      throw new Error('Isi cadangan rusak (pengaturan).');
    }
    return {
      manifest,
      data: {
        version: 3,
        exportedAt: manifest.createdAtMs,
        wallets,
        transactions,
        categories,
        settings: parseSettings(settingsRaw),
      },
    };
  }

  private async parseV2(
    bytes: Uint8Array,
    passphrase: string,
  ): Promise<BackupPayload> {
    if (bytes.length < 33 || bytes[4] !== LEGACY_FORMAT_VERSION) {
      throw new Error('File cadangan tidak dikenal.');
    }
    const salt = bytes.subarray(5, 21);
    const iv = bytes.subarray(21, 33);
    const cipher = bytes.subarray(33);
    const key = await deriveKey(passphrase, salt, KDF_ITERATIONS_V2);
    let zip: Uint8Array;
    try {
      zip = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          key,
          cipher as BufferSource,
        ),
      );
    } catch {
      throw new Error('Kata sandi salah atau file rusak.');
    }
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(zip);
    } catch {
      throw new Error('Isi cadangan rusak.');
    }
    const required = [
      'wallets.ndjson',
      'transactions.ndjson',
      'categories.ndjson',
      'settings.json',
    ];
    for (const name of required) {
      if (!files[name]) throw new Error('Isi cadangan tidak lengkap.');
    }
    let settingsRaw: unknown;
    try {
      settingsRaw = JSON.parse(strFromU8(files['settings.json']));
    } catch {
      throw new Error('Isi cadangan rusak (pengaturan).');
    }
    let exportedAt = Date.now();
    if (files['meta.json']) {
      try {
        const meta = JSON.parse(strFromU8(files['meta.json'])) as {
          exportedAt?: unknown;
        };
        if (typeof meta.exportedAt === 'number') exportedAt = meta.exportedAt;
      } catch {
        // meta is advisory; the data files are what matter.
      }
    }
    return {
      version: 2,
      exportedAt,
      wallets: fromNdjson<Wallet>(files['wallets.ndjson'], 'dompet'),
      transactions: fromNdjson<Transaction>(
        files['transactions.ndjson'],
        'transaksi',
      ),
      categories: fromNdjson<Category>(files['categories.ndjson'], 'kategori'),
      settings: parseSettings(settingsRaw),
    };
  }

  private async parseV1(
    bytes: Uint8Array,
    passphrase: string,
  ): Promise<BackupPayload> {
    let envelope: {
      v?: unknown;
      salt?: unknown;
      iv?: unknown;
      data?: unknown;
    };
    try {
      envelope = JSON.parse(strFromU8(bytes)) as typeof envelope;
    } catch {
      throw new Error('File cadangan tidak bisa dibaca.');
    }
    if (
      envelope.v !== 1 ||
      typeof envelope.salt !== 'string' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.data !== 'string'
    ) {
      throw new Error('File cadangan tidak dikenal.');
    }
    const key = await deriveKey(
      passphrase,
      fromBase64(envelope.salt),
      KDF_ITERATIONS_V2,
    );
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
        key,
        fromBase64(envelope.data) as BufferSource,
      );
    } catch {
      throw new Error('Kata sandi salah atau file rusak.');
    }
    let data: {
      version?: unknown;
      wallets?: unknown;
      transactions?: unknown;
      categories?: unknown;
      settings?: unknown;
    };
    try {
      data = JSON.parse(new TextDecoder().decode(plain)) as typeof data;
    } catch {
      throw new Error('Isi cadangan rusak.');
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.wallets) ||
      !Array.isArray(data.transactions) ||
      !Array.isArray(data.categories)
    ) {
      throw new Error('Isi cadangan tidak lengkap.');
    }
    return {
      version: 2,
      exportedAt: Date.now(),
      wallets: data.wallets as Wallet[],
      transactions: data.transactions as Transaction[],
      categories: data.categories as Category[],
      settings: parseSettings(data.settings),
    };
  }
}

function fromNdjson<T>(bytes: Uint8Array, label: string): T[] {
  const text = strFromU8(bytes).trim();
  if (!text) return [];
  try {
    return text.split('\n').map((line) => JSON.parse(line) as T);
  } catch {
    throw new Error(`Isi cadangan rusak (${label}).`);
  }
}

export function downloadBlob(
  filename: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
