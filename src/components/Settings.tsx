// DompetKu v1.0.2 — settings tab.
// Gemini BYOK key + in-app guide, launch tab, encrypted backup (file and
// Google Drive), privacy. Categories and chat history live in the chat
// settings sheet (gear button in the chat header), not here.

import { useRef, useState, type ReactNode } from 'react';
import { DEFAULT_MODEL } from '../lib/db';
import { validatePassphrase } from '../lib/backup';
import { APP_VERSION } from '../lib/version';
import type { Settings } from '../lib/types';
import type {
  BackupProgress,
  InspectResult,
  PendingRestore,
} from '../App';
import { DriveSection } from './DriveSection';
import { RestoreReview } from './RestoreReview';
import { Stepper, useStepper, type StepDef } from './Stepper';

const EXPORT_STEPS: StepDef[] = [
  { id: 'package', label: 'Mengemas cadangan' },
  { id: 'encrypt', label: 'Mengenkripsi' },
  { id: 'verify', label: 'Memverifikasi cadangan' },
  { id: 'save', label: 'Mengunduh file' },
];

const IMPORT_STEPS: StepDef[] = [
  { id: 'read', label: 'Membaca file' },
  { id: 'unpack', label: 'Membuka arsip' },
  { id: 'metadata', label: 'Memeriksa keterangan' },
  { id: 'decrypt', label: 'Membuka enkripsi' },
  { id: 'checksum', label: 'Memeriksa checksum' },
  { id: 'structure', label: 'Memeriksa isi' },
  { id: 'compare', label: 'Membandingkan data' },
];

const APPLY_STEPS: StepDef[] = [
  { id: 'snapshot', label: 'Menyimpan keadaan saat ini' },
  { id: 'safety', label: 'Cadangan pengaman' },
  { id: 'apply', label: 'Memulihkan data' },
  { id: 'verify', label: 'Memverifikasi hasil' },
  { id: 'refresh', label: 'Memuat ulang' },
];

/**
 * One collapsible Settings section. The heading is the toggle; the body
 * stays mounted when collapsed (hidden), so a stepper or form state inside
 * never resets when the user folds a section away. All sections start
 * folded, so the page reads as a short list of headings.
 */
function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="settings-section-head">
        <button
          type="button"
          className="settings-section-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span>{title}</span>
          <span className="settings-section-chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
      </h2>
      <div id={`${id}-body`} className="settings-section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function Settings({
  settings,
  onSaveSettings,
  onExport,
  onImport,
  onApplyRestore,
  onDriveConnect,
  onDriveDisconnect,
  onDriveBackup,
  onDriveRestore,
  onOpenPrivacy,
}: {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onExport: (passphrase: string, onProgress?: BackupProgress) => Promise<void>;
  onImport: (
    file: File,
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<InspectResult>;
  onApplyRestore: (
    pending: PendingRestore,
    safety: boolean,
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<void>;
  onDriveConnect: (clientId: string) => Promise<void>;
  onDriveDisconnect: () => Promise<void>;
  onDriveBackup: (
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<void>;
  onDriveRestore: (
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<InspectResult>;
  onOpenPrivacy: () => void;
}) {
  const [apiKey, setApiKey] = useState(settings.geminiApiKey ?? '');
  const [model, setModel] = useState(settings.geminiModel);
  const [parserFallback, setParserFallback] = useState(
    settings.localParserFallback ?? true,
  );
  const [exportPass, setExportPass] = useState('');
  const [exportPassConfirm, setExportPassConfirm] = useState('');
  const [importPass, setImportPass] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [keyStatus, setKeyStatus] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    {},
  );
  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => openSections[id] ?? false;
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{
    pending: PendingRestore;
    passphrase: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepper = useStepper();

  /** Run a backup flow with visible steps. Returns the flow's value, or
   * null when it failed (the error is shown on the failing step and in
   * the form error — never silent). */
  async function runFlow<T>(
    defs: StepDef[],
    fn: (advance: (id: string) => Promise<void>) => Promise<T>,
  ): Promise<T | null> {
    stepper.start(defs);
    setBusy(true);
    try {
      const value = await fn((id) => stepper.advance(id));
      await stepper.finish();
      return value;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Proses gagal.');
      stepper.fail(err);
      setError(err.message);
      setStatus('');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(): Promise<void> {
    const key = apiKey.trim();
    await onSaveSettings({
      geminiApiKey: key || null,
      geminiModel: model.trim() || DEFAULT_MODEL,
      keyReminderDismissedAt: null,
    });
    setKeyStatus(
      key
        ? 'Kunci API tersimpan di perangkat ini.'
        : 'Kunci API dihapus. DompetKu tetap bekerja dengan aturan lokal.',
    );
  }

  async function doExport(): Promise<void> {
    const err = validatePassphrase(exportPass, exportPassConfirm);
    if (err) {
      setError(err);
      setStatus('');
      return;
    }
    const ok = await runFlow(EXPORT_STEPS, (advance) =>
      onExport(exportPass, advance),
    );
    if (ok !== null) {
      setStatus('Cadangan terenkripsi diunduh. Simpan kata sandinya baik-baik.');
      setError('');
      setExportPass('');
      setExportPassConfirm('');
    }
  }

  async function doImport(file: File | undefined): Promise<void> {
    if (!file) {
      setError('Pilih file cadangan dulu.');
      return;
    }
    if (!importPass) {
      setError('Masukkan kata sandi cadangan.');
      return;
    }
    const result = await runFlow(IMPORT_STEPS, (advance) =>
      onImport(file, importPass, advance),
    );
    if (fileRef.current) fileRef.current.value = '';
    if (result?.status === 'differs') {
      // Keep the passphrase: the review dialog needs it for the safety
      // backup when the user applies the restore.
      setPendingRestore({ pending: result.pending, passphrase: importPass });
    }
  }

  async function doApply(safety: boolean): Promise<void> {
    if (!pendingRestore) return;
    const { pending, passphrase } = pendingRestore;
    setPendingRestore(null);
    const ok = await runFlow(APPLY_STEPS, (advance) =>
      onApplyRestore(pending, safety, passphrase, advance),
    );
    if (ok !== null) {
      setStatus('Cadangan dipulihkan. Data lama diganti dengan isi cadangan.');
      setError('');
      setImportPass('');
    }
  }

  /** A Drive restore hands its inspected result here so the same review
   * dialog decides whether it applies. */
  function onInspected(result: InspectResult, passphrase: string): void {
    if (result.status === 'differs') {
      setPendingRestore({ pending: result.pending, passphrase });
    }
  }

  return (
    <div className="screen-scroll">
      <header className="page-head">
        <h1>Pengaturan</h1>
      </header>

      <Section
        id="key"
        title="Kunci API Gemini"
        open={isOpen('key')}
        onToggle={() => toggleSection('key')}
      >
        <p>
          Status:{' '}
          <strong>
            {settings.geminiApiKey ? 'Sudah diatur' : 'Belum diatur'}
          </strong>{' '}
          — tanpa kunci, DompetKu tetap bekerja penuh dengan aturan lokal.
        </p>
        <div className="field">
          <label htmlFor="api-key">Kunci API</label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Tempel kunci API di sini"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="api-model">Model</label>
          <input
            id="api-model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <p className="hint">
            Bawaan: gemini-3.5-flash-lite (paket gratis).
          </p>
        </div>
        <button type="button" className="button-primary small" onClick={() => void saveKey()}>
          Simpan kunci
        </button>
        {keyStatus ? (
          <p className="form-status" role="status">
            {keyStatus}
          </p>
        ) : null}
        <div className="field">
          <label className="setting-row">
            <span className="setting-row-text">
              <span className="setting-row-title">
                Parser lokal sebagai cadangan
              </span>
              <span className="setting-row-hint">
                {settings.geminiApiKey
                  ? 'Gemini menjawab dulu. Kalau Gemini tidak bisa menjawab (gangguan jaringan atau kuota habis), aturan lokal di perangkatmu yang mengambil alih.'
                  : 'Parser lokal tidak bisa dimatikan sebelum kunci API Gemini diatur — tanpanya, tidak ada yang memahami chatmu.'}
              </span>
            </span>
            <input
              id="parser-fallback"
              type="checkbox"
              role="switch"
              {...({ switch: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
              checked={settings.geminiApiKey ? parserFallback : true}
              disabled={!settings.geminiApiKey}
              onChange={(e) => {
                setParserFallback(e.target.checked);
                void onSaveSettings({
                  localParserFallback: e.target.checked,
                });
              }}
            />
          </label>
        </div>
        <h3>Cara mendapatkan kunci (gratis)</h3>
        <ol className="guide-steps">
          <li>
            Buka{' '}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
            >
              aistudio.google.com/apikey
            </a>{' '}
            dan masuk dengan akun Google.
          </li>
          <li>Setujui ketentuannya — proyek dan kunci dibuat otomatis.</li>
          <li>Salin kunci API yang tampil di halaman itu.</li>
          <li>
            Batasi kunci itu: di Google Cloud Console → Credentials → klik
            kunci ini, lalu atur API restrictions ke Generative Language
            API saja, dan Application restrictions ke HTTP referrers dengan
            alamat situs DompetKu (diisi setelah aplikasi dipublikasikan).
          </li>
          <li>Tempel di kolom di atas, lalu simpan.</li>
        </ol>
        <p className="hint">
          Tidak perlu kartu kredit. Kunci hanya tersimpan di perangkat ini,
          dan kalau kunci terpasang, pesanmu dikirim ke Google untuk dipahami
          Gemini — paling banyak satu balasan terakhir sebagai konteks.
          Kunci yang tidak dibatasi bisa dipakai siapa saja dari mana saja;
          dibatasi, kunci itu hanya berguna dari situs ini.
        </p>
      </Section>

      <Section
        id="launch"
        title="Tampilan awal"
        open={isOpen('launch')}
        onToggle={() => toggleSection('launch')}
      >
        <p>Pilih tab yang terbuka saat aplikasi diluncurkan.</p>
        <div className="radio-row" role="radiogroup" aria-label="Tampilan awal">
          {(
            [
              { value: 'home', label: 'Beranda' },
              { value: 'chat', label: 'Chat' },
            ] as const
          ).map((option) => (
            <label key={option.value} className="radio-pill">
              <input
                type="radio"
                name="launch-tab"
                value={option.value}
                checked={settings.launchTab === option.value}
                onChange={() =>
                  void onSaveSettings({ launchTab: option.value })
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </Section>

      <Section
        id="backup"
        title="Cadangkan & pulihkan"
        open={isOpen('backup')}
        onToggle={() => toggleSection('backup')}
      >
        <p>
          Cadangan berupa arsip ZIP berisi data dalam format NDJSON, tiap
          file dienkripsi dengan kata sandi dan dilengkapi checksum — jadi
          cadangan yang rusak ketahuan sebelum dipulihkan, bukan sesudah.
          Kunci API dan token Drive tidak ikut dicadangkan — kalau kamu
          pulihkan di perangkat baru, atur keduanya lagi.
        </p>
        <div className="field">
          <label htmlFor="export-pass">Kata sandi cadangan</label>
          <input
            id="export-pass"
            type="password"
            value={exportPass}
            onChange={(e) => setExportPass(e.target.value)}
            placeholder="Minimal 8 karakter, huruf dan angka"
            autoComplete="new-password"
            aria-describedby="export-pass-hint"
          />
        </div>
        <div className="field">
          <label htmlFor="export-pass-confirm">
            Konfirmasi kata sandi cadangan
          </label>
          <input
            id="export-pass-confirm"
            type="password"
            value={exportPassConfirm}
            onChange={(e) => setExportPassConfirm(e.target.value)}
            placeholder="Tulis lagi kata sandinya"
            autoComplete="new-password"
            aria-describedby="export-pass-hint"
          />
          <p className="hint" id="export-pass-hint">
            Minimal 8 karakter, huruf dan angka saja. Kata sandi ini tidak
            bisa dipulihkan kalau hilang — cadangan tidak bisa dibuka
            tanpanya.
          </p>
        </div>
        <button
          type="button"
          className="button-primary small"
          onClick={() => void doExport()}
          disabled={busy}
        >
          Unduh cadangan
        </button>
        <div className="field">
          <label htmlFor="import-file">File cadangan (.dompetku)</label>
          <input
            id="import-file"
            ref={fileRef}
            type="file"
            accept=".dompetku,.json,application/octet-stream,application/json"
            disabled={busy}
            onChange={(e) => void doImport(e.target.files?.[0])}
          />
          <p className="hint">
            File .json dari versi lama masih bisa dipulihkan. Cadangan lama
            tetap bisa dibuka walau kata sandinya pendek — aturan 8 karakter
            hanya berlaku saat membuat cadangan baru.
          </p>
        </div>
        <div className="field">
          <label htmlFor="import-pass">Kata sandi cadangan (impor)</label>
          <input
            id="import-pass"
            type="password"
            value={importPass}
            onChange={(e) => setImportPass(e.target.value)}
            placeholder="Kata sandi saat mengekspor"
            autoComplete="current-password"
          />
          <p className="hint">
            Pilih file di atas, lalu isi kata sandinya — pemulihan berjalan
            begitu file dipilih. Datamu tidak berubah sampai kamu setuju di
            layar perbandingan.
          </p>
        </div>
        {stepper.steps ? <Stepper steps={stepper.steps} /> : null}
        {status ? (
          <p className="form-status" role="status">
            {status}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </Section>

      <Section
        id="drive"
        title="Google Drive"
        open={isOpen('drive')}
        onToggle={() => toggleSection('drive')}
      >
        <DriveSection
          settings={settings}
          backupPassphrase={exportPass}
          backupPassphraseConfirm={exportPassConfirm}
          onSaveSettings={onSaveSettings}
          onDriveConnect={onDriveConnect}
          onDriveDisconnect={onDriveDisconnect}
          onDriveBackup={onDriveBackup}
          onDriveRestore={onDriveRestore}
          onInspected={onInspected}
        />
      </Section>

      {pendingRestore ? (
        <RestoreReview
          open={pendingRestore !== null}
          pending={pendingRestore.pending}
          onClose={() => {
            setPendingRestore(null);
            setImportPass('');
          }}
          onApply={(safety) => void doApply(safety)}
        />
      ) : null}

      <Section
        id="privacy"
        title="Privasi"
        open={isOpen('privacy')}
        onToggle={() => toggleSection('privacy')}
      >
        <p>
          DompetKu tidak punya server. Data tersimpan di perangkat ini; kalau
          kunci API Gemini terpasang, pesan chat dikirim ke Google untuk
          dipahami.
        </p>
        <button type="button" className="button-ghost small" onClick={onOpenPrivacy}>
          Baca kebijakan privasi
        </button>
      </Section>

      <Section
        id="about"
        title="Tentang"
        open={isOpen('about')}
        onToggle={() => toggleSection('about')}
      >
        <p>
          DompetKu {APP_VERSION} — pelacak anggaran lewat chat. Dibuat untuk
          dipakai sendiri, tanpa akun.
        </p>
        <p className="copyright">
          © {new Date().getFullYear()} Alzam A. Hak cipta dilindungi.
        </p>
      </Section>
    </div>
  );
}
