// DompetKu v1.0.2 — app shell.
// Loads the local store, gates first-run setup, switches tabs, owns the
// floating navbar. No router: one tab state, static-export friendly.
// Tab switches run through the View Transitions API when the browser has it
// (plain state change otherwise), and focus moves to the new view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, ensureSeed } from './lib/db';
import { createStores, type DataStores } from './lib/stores';
import {
  BackupService,
  diffBackup,
  downloadBlob,
  fingerprintOf,
  type BackupDiff,
  type BackupPayload,
} from './lib/backup';
import { ChatEngine } from './lib/chat';
import { DEFAULT_DRIVE_CLIENT_ID, DriveAuthError, DriveService, resolveDriveClientId } from './lib/drive';
import type {
  Category,
  ChatMessage,
  Settings,
  TabId,
  Transaction,
  Wallet,
} from './lib/types';
import { uid } from './lib/types';
import { Setup } from './components/Setup';
import { Dashboard } from './components/Dashboard';
import { Wallets } from './components/Wallets';
import { Chat } from './components/Chat';
import { History } from './components/History';
import { Settings as SettingsTab } from './components/Settings';
import { Privacy } from './components/Privacy';
import { NavBar } from './components/NavBar';

export interface PendingRestore {
  data: BackupPayload;
  diff: BackupDiff;
  fingerprint: string;
}

/** What inspecting a backup finds: identical (nothing to do) or different
 * (the user decides in the review dialog whether it applies). */
export type InspectResult =
  | { status: 'identical' }
  | { status: 'differs'; pending: PendingRestore };

/** A step id reported by a backup/restore flow, for the progress UI. */
export type BackupProgress = (
  step: string,
  detail?: string,
) => void | Promise<void>;

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tab, setTab] = useState<TabId>('home');
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  /** A short-lived banner above the navbar (role="status"), e.g. when a
   * restore finds the data already up to date. */
  function showToast(text: string): void {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4000);
  }

  const stores: DataStores = useMemo(() => createStores(db), []);
  const engine = useMemo(() => new ChatEngine(stores), [stores]);
  const backupService = useMemo(() => new BackupService(), []);
  const driveService = useMemo(() => new DriveService(), []);

  const bootedRef = useRef(false);

  const loadAll = useCallback(async () => {
    await ensureSeed();
    const [s, w, t, c, m] = await Promise.all([
      stores.settings.get(),
      stores.wallets.list(),
      stores.transactions.listAll(),
      stores.categories.list(),
      stores.chat.list(),
    ]);
    setSettings(s);
    setWallets(w);
    setTransactions(t);
    setCategories(c);
    setMessages(m);
    // The launch tab applies only on boot. A later reload (e.g. after a
    // restore) must not yank the user out of the tab they are on.
    if (!bootedRef.current) {
      bootedRef.current = true;
      setTab(s.launchTab);
    }
    setReady(true);
  }, [stores]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refreshData = useCallback(async () => {
    const [w, t, c, m] = await Promise.all([
      stores.wallets.list(),
      stores.transactions.listAll(),
      stores.categories.list(),
      stores.chat.list(),
    ]);
    setWallets(w);
    setTransactions(t);
    setCategories(c);
    setMessages(m);
  }, [stores]);

  function goTab(next: TabId): void {
    if (next === tab) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !document.startViewTransition) {
      setTab(next);
      return;
    }
    const transition = document.startViewTransition(() => setTab(next));
    transition.finished.finally(() => {
      mainRef.current?.focus();
    });
  }

  async function handleSetupDone(
    wallet: Wallet,
    patch: Partial<Settings>,
  ): Promise<void> {
    await stores.wallets.add(wallet);
    const s = await stores.settings.save(patch);
    setSettings(s);
    await refreshData();
    setTab(s.launchTab);
  }

  async function upsertWallet(wallet: Wallet): Promise<void> {
    await stores.wallets.put(wallet);
    setWallets((prev) => {
      const found = prev.some((w) => w.id === wallet.id);
      return found
        ? prev.map((w) => (w.id === wallet.id ? wallet : w))
        : [...prev, wallet];
    });
  }

  async function deleteWallet(walletId: string): Promise<void> {
    await stores.transactions.deleteByWallet(walletId);
    await stores.wallets.delete(walletId);
    setWallets((prev) => prev.filter((w) => w.id !== walletId));
    setTransactions((prev) => prev.filter((t) => t.walletId !== walletId));
  }

  async function deleteTransaction(id: string): Promise<void> {
    await stores.transactions.delete(id);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  async function addCategory(name: string): Promise<void> {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const category: Category = { id: uid(), name: clean, builtin: false };
    await stores.categories.put(category);
    setCategories((prev) => [...prev, category]);
  }

  async function renameCategory(id: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 40);
    if (!clean) return;
    const found = categories.find((c) => c.id === id);
    if (!found) return;
    const next = { ...found, name: clean };
    await stores.categories.put(next);
    setCategories((prev) => prev.map((c) => (c.id === id ? next : c)));
  }

  async function deleteCategory(id: string): Promise<void> {
    // Lainnya is the fallback for uncategorized spending: it stays.
    if (id === 'lainnya') return;
    await db.transaction(
      'rw',
      [db.transactions, db.categories],
      async () => {
        await stores.transactions.reassignCategory(id, 'lainnya');
        await stores.categories.delete(id);
      },
    );
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setTransactions((prev) =>
      prev.map((t) =>
        t.categoryId === id ? { ...t, categoryId: 'lainnya' } : t,
      ),
    );
  }

  async function appendMessages(msgs: ChatMessage[]): Promise<void> {
    await stores.chat.bulkAdd(msgs);
    setMessages((prev) => [...prev, ...msgs]);
  }

  async function handleClearChat(): Promise<void> {
    await stores.chat.clear();
    setMessages([]);
  }

  async function handleSaveSettings(patch: Partial<Settings>): Promise<void> {
    const s = await stores.settings.save(patch);
    setSettings(s);
  }

  function buildPayload(): BackupPayload {
    if (!settings) throw new Error('Pengaturan belum dimuat.');
    const { geminiApiKey: _key, driveAccessToken: _token, ...rest } = settings;
    void _key;
    void _token;
    return {
      version: 3,
      exportedAt: Date.now(),
      wallets,
      transactions,
      categories,
      settings: rest,
    };
  }

  /** Compare a parsed backup with the current data. Identical data shows
   * a toast and returns nothing to apply; different data returns the
   * pending restore for the review dialog. */
  async function inspectParsed(
    data: BackupPayload,
  ): Promise<InspectResult> {
    const current = buildPayload();
    const diff = diffBackup(current, data);
    if (diff.identical) {
      showToast('Datamu sudah sama dengan cadangan — tidak ada yang dipulihkan.');
      return { status: 'identical' };
    }
    return {
      status: 'differs',
      pending: {
        data,
        diff,
        fingerprint: await fingerprintOf(current),
      },
    };
  }

  async function handleExport(
    passphrase: string,
    onProgress?: BackupProgress,
  ): Promise<void> {
    const bytes = await backupService.build(
      buildPayload(),
      passphrase,
      'backup',
      onProgress,
    );
    await onProgress?.('save');
    downloadBlob(
      BackupService.fileName('backup'),
      bytes,
      'application/octet-stream',
    );
  }

  async function restorePayload(data: BackupPayload): Promise<void> {
    const current = await stores.settings.get();
    await db.transaction(
      'rw',
      [db.wallets, db.transactions, db.categories, db.settings],
      async () => {
        await stores.wallets.clear();
        await stores.transactions.clear();
        await stores.categories.clear();
        await stores.settings.save({
          ...data.settings,
          id: 'main',
          geminiApiKey: current.geminiApiKey,
          driveAccessToken: current.driveAccessToken,
          driveTokenExpiresAt: current.driveTokenExpiresAt,
        });
        await stores.wallets.bulkAdd(data.wallets);
        await stores.transactions.bulkAdd(data.transactions);
        await stores.categories.bulkAdd(data.categories);
      },
    );
  }

  async function handleImport(
    file: File,
    passphrase: string,
    onProgress?: BackupProgress,
  ): Promise<InspectResult> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { data } = await backupService.parse(bytes, passphrase, onProgress);
    await onProgress?.('compare');
    return inspectParsed(data);
  }

  /**
   * Apply a reviewed restore: refuse when the data changed since the
   * comparison, optionally download a safety backup of the current data
   * first, write the backup in one transaction, then verify the counts
   * and roll back to the pre-restore snapshot when verification fails.
   */
  async function applyRestore(
    pending: PendingRestore,
    safety: boolean,
    passphrase: string,
    onProgress?: BackupProgress,
  ): Promise<void> {
    await onProgress?.('snapshot');
    const before = buildPayload();
    if ((await fingerprintOf(before)) !== pending.fingerprint) {
      throw new Error(
        'Datamu berubah sejak perbandingan — mulai lagi dari awal.',
      );
    }
    if (safety) {
      await onProgress?.('safety');
      const safetyBytes = await backupService.build(
        before,
        passphrase,
        'safety',
      );
      downloadBlob(
        BackupService.fileName('safety'),
        safetyBytes,
        'application/octet-stream',
      );
    }
    await onProgress?.('apply');
    try {
      await restorePayload(pending.data);
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : 'Pemulihan gagal.',
      );
    }
    await onProgress?.('verify');
    const [walletsNow, transactionsNow, categoriesNow] = await Promise.all([
      stores.wallets.list(),
      stores.transactions.listAll(),
      stores.categories.list(),
    ]);
    if (
      walletsNow.length !== pending.data.wallets.length ||
      transactionsNow.length !== pending.data.transactions.length ||
      categoriesNow.length !== pending.data.categories.length
    ) {
      try {
        await restorePayload(before);
      } catch {
        throw new Error(
          'Pemulihan gagal diverifikasi dan data lama tidak bisa dikembalikan — pulihkan cadangan pengamanmu.',
        );
      }
      throw new Error(
        'Pemulihan gagal diverifikasi — data lama dikembalikan.',
      );
    }
    await onProgress?.('refresh');
    await loadAll();
  }

  /** A usable Drive token: the stored one, or a silent refresh. */
  async function driveToken(): Promise<string | null> {
    const current = await stores.settings.get();
    const clientId = resolveDriveClientId(current.driveClientId);
    if (!clientId) return null;
    if (
      current.driveAccessToken &&
      current.driveTokenExpiresAt &&
      current.driveTokenExpiresAt > Date.now()
    ) {
      return current.driveAccessToken;
    }
    const refreshed = await driveService.refresh(clientId);
    if (!refreshed) return null;
    await handleSaveSettings({
      driveAccessToken: refreshed.accessToken,
      driveTokenExpiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  }

  async function handleDriveConnect(clientId: string): Promise<void> {
    const token = await driveService.connect(clientId);
    await handleSaveSettings({
      // A sign-in through the shared default leaves no override behind;
      // only a genuinely different Client ID is stored as one.
      driveClientId:
        clientId === DEFAULT_DRIVE_CLIENT_ID ? null : clientId,
      driveAccessToken: token.accessToken,
      driveTokenExpiresAt: token.expiresAt,
    });
  }

  async function handleDriveDisconnect(): Promise<void> {
    await handleSaveSettings({
      driveAccessToken: null,
      driveTokenExpiresAt: null,
    });
  }

  async function handleDriveBackup(
    passphrase: string,
    onProgress?: BackupProgress,
  ): Promise<void> {
    const token = await driveToken();
    if (!token) throw new DriveAuthError();
    const bytes = await backupService.build(
      buildPayload(),
      passphrase,
      'backup',
      onProgress,
    );
    await onProgress?.('upload');
    const existing = await driveService.listBackups(token);
    await driveService.uploadBackup(token, bytes, existing[0]?.id ?? null);
    await handleSaveSettings({ driveLastBackupAt: Date.now() });
  }

  async function handleDriveRestore(
    passphrase: string,
    onProgress?: BackupProgress,
  ): Promise<InspectResult> {
    const token = await driveToken();
    if (!token) throw new DriveAuthError();
    const existing = await driveService.listBackups(token);
    if (existing.length === 0) {
      throw new Error('Belum ada cadangan di Google Drive.');
    }
    await onProgress?.('download');
    const bytes = await driveService.downloadBackup(token, existing[0].id);
    const { data } = await backupService.parse(bytes, passphrase, onProgress);
    await onProgress?.('compare');
    return inspectParsed(data);
  }

  if (!ready || !settings) {
    return (
      <div className="app">
        <div className="loading">
          <p>Memuat DompetKu…</p>
        </div>
      </div>
    );
  }

  if (!settings.setupDone) {
    return (
      <div className="app">
        <main className="app-main">
          <Setup onDone={handleSetupDone} />
        </main>
      </div>
    );
  }

  if (showPrivacy) {
    return (
      <div className="app">
        <main className="app-main">
          <Privacy onBack={() => setShowPrivacy(false)} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <main className="app-main" ref={mainRef} tabIndex={-1}>
        {tab === 'home' ? (
          <Dashboard wallets={wallets} transactions={transactions} onTab={goTab} />
        ) : null}
        {tab === 'wallets' ? (
          <Wallets
            wallets={wallets}
            transactions={transactions}
            onUpsert={upsertWallet}
            onDelete={deleteWallet}
          />
        ) : null}
        {tab === 'chat' ? (
          <Chat
            engine={engine}
            wallets={wallets}
            settings={settings}
            messages={messages}
            categories={categories}
            transactions={transactions}
            onMessages={appendMessages}
            onDataChanged={refreshData}
            onSaveSettings={handleSaveSettings}
            onOpenSettings={() => goTab('settings')}
            onAddCategory={addCategory}
            onRenameCategory={renameCategory}
            onDeleteCategory={deleteCategory}
            onClearChat={handleClearChat}
          />
        ) : null}
        {tab === 'history' ? (
          <History
            wallets={wallets}
            categories={categories}
            transactions={transactions}
            onDelete={deleteTransaction}
          />
        ) : null}
        {tab === 'settings' ? (
          <SettingsTab
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onExport={handleExport}
            onImport={handleImport}
            onApplyRestore={applyRestore}
            onDriveConnect={handleDriveConnect}
            onDriveDisconnect={handleDriveDisconnect}
            onDriveBackup={handleDriveBackup}
            onDriveRestore={handleDriveRestore}
            onOpenPrivacy={() => setShowPrivacy(true)}
          />
        ) : null}
      </main>
      {toast ? (
        <p className="toast" role="status">
          {toast}
        </p>
      ) : null}
      <NavBar tab={tab} onTab={goTab} />
    </div>
  );
}
