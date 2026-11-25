// DompetKu v1.0.4 — Google Drive backup section in Settings.
// Single sign-on: the app ships one shared OAuth client ID
// (DEFAULT_DRIVE_CLIENT_ID in lib/drive.ts), so users just tap Hubungkan
// and pick their Google account. A user can still paste their own Client ID;
// that override wins over the shared one. The backup file lives in the app's
// own Drive folder, and restore reads it back from there.
//
// The section shell (heading + collapse) lives in Settings; this component
// renders only the section body. Its own status and error render here, next
// to the buttons — never at the bottom of the page.

import { useState } from 'react';
import { DEFAULT_DRIVE_CLIENT_ID } from '../lib/drive';
import { validatePassphrase } from '../lib/backup';
import type { Settings } from '../lib/types';
import type { BackupProgress, InspectResult } from '../App';
import { Stepper, useStepper, type StepDef } from './Stepper';

const DRIVE_BACKUP_STEPS: StepDef[] = [
  { id: 'package', label: 'Mengemas cadangan' },
  { id: 'encrypt', label: 'Mengenkripsi' },
  { id: 'verify', label: 'Memverifikasi cadangan' },
  { id: 'upload', label: 'Mengunggah ke Drive' },
];

const DRIVE_FETCH_STEPS: StepDef[] = [
  { id: 'download', label: 'Mengunduh dari Drive' },
];

const DRIVE_DECRYPT_STEPS: StepDef[] = [
  { id: 'read', label: 'Membaca file' },
  { id: 'unpack', label: 'Membuka arsip' },
  { id: 'metadata', label: 'Memeriksa keterangan' },
  { id: 'decrypt', label: 'Membuka enkripsi' },
  { id: 'checksum', label: 'Memeriksa checksum' },
  { id: 'structure', label: 'Memeriksa isi' },
  { id: 'compare', label: 'Membandingkan data' },
];

export function DriveSection({
  settings,
  onSaveSettings,
  onDriveConnect,
  onDriveDisconnect,
  onDriveBackup,
  onDriveFetch,
  onDriveDecrypt,
  onInspected,
}: {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onDriveConnect: (clientId: string) => Promise<void>;
  onDriveDisconnect: () => Promise<void>;
  onDriveBackup: (
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<void>;
  onDriveFetch: (onProgress?: BackupProgress) => Promise<Uint8Array>;
  onDriveDecrypt: (
    bytes: Uint8Array,
    passphrase: string,
    onProgress?: BackupProgress,
  ) => Promise<InspectResult>;
  onInspected: (result: InspectResult, passphrase: string) => void;
}) {
  const hasDefault = DEFAULT_DRIVE_CLIENT_ID.trim().length > 0;
  const [clientId, setClientId] = useState(settings.driveClientId ?? '');
  const [showOwnId, setShowOwnId] = useState(
    !hasDefault || settings.driveClientId !== null,
  );
  const [busy, setBusy] = useState(false);
  // The Drive backup has its own passphrase fields, next to its buttons.
  // It used to borrow the file-export fields from the backup section, so
  // the "Kata sandi minimal 8 karakter." error pointed at fields in
  // another (folded) section with nothing to fill nearby. Same backup
  // passphrase concept — one password opens every backup — but entered
  // where the action is.
  const [drivePass, setDrivePass] = useState('');
  const [drivePassConfirm, setDrivePassConfirm] = useState('');
  const [driveStatus, setDriveStatus] = useState('');
  const [driveError, setDriveError] = useState('');
  // Bytes fetched by phase 1 of a restore, held until the passphrase is
  // entered and phase 2 decrypts them. Cleared once phase 2 runs, so a
  // later restore always fetches fresh from Drive.
  const [heldDriveBackup, setHeldDriveBackup] = useState<Uint8Array | null>(
    null,
  );
  const stepper = useStepper();

  const connected = settings.driveAccessToken !== null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  /** Run a Drive flow with visible steps. Returns false when it failed
   * (the error is shown on the failing step and in the form error). */
  async function runFlow(
    defs: StepDef[],
    fn: (advance: (id: string) => Promise<void>) => Promise<void>,
    okText: string,
  ): Promise<boolean> {
    stepper.start(defs);
    setBusy(true);
    try {
      await fn((id) => stepper.advance(id));
      await stepper.finish();
      setDriveStatus(okText);
      setDriveError('');
      return true;
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Operasi Drive gagal.');
      stepper.fail(err);
      setDriveError(err.message);
      setDriveStatus('');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>, okText: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      setDriveStatus(okText);
      setDriveError('');
    } catch (e) {
      setDriveError(e instanceof Error ? e.message : 'Operasi Drive gagal.');
      setDriveStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    const id = clientId.trim() || DEFAULT_DRIVE_CLIENT_ID.trim();
    if (!id) {
      setDriveError('Tempel Client ID Google dulu.');
      setDriveStatus('');
      return;
    }
    await run(async () => {
      await onDriveConnect(id);
    }, 'Google Drive terhubung.');
  }

  async function backup(): Promise<void> {
    const err = validatePassphrase(drivePass, drivePassConfirm);
    if (err) {
      setDriveError(err);
      setDriveStatus('');
      return;
    }
    const ok = await runFlow(
      DRIVE_BACKUP_STEPS,
      (advance) => onDriveBackup(drivePass, advance),
      'Cadangan tersimpan di Google Drive.',
    );
    // The Drive contents just changed, so a held restore is stale.
    if (ok) setHeldDriveBackup(null);
  }

  /**
   * Restore in two phases, on purpose: phase 1 fetches the backup from
   * Drive and holds it; the passphrase is only asked for afterwards, and
   * phase 2 decrypts it. When the passphrase is already filled, one tap
   * runs both phases. The backup and the restore share this section's own
   * passphrase field — the same password, entered where the buttons are.
   */
  async function restore(): Promise<void> {
    if (!heldDriveBackup) {
      let bytes: Uint8Array | null = null;
      const ok = await runFlow(
        DRIVE_FETCH_STEPS,
        async (advance) => {
          bytes = await onDriveFetch(advance);
        },
        'Cadangan dari Drive diunduh.',
      );
      if (!ok || !bytes) return;
      setHeldDriveBackup(bytes);
      if (!drivePass) {
        setDriveStatus(
          'Cadangan dari Drive ditemukan. Isi kata sandi di atas, lalu tekan Pulihkan dari Drive lagi.',
        );
        setDriveError('');
        return;
      }
      await decryptHeld(bytes);
      return;
    }
    await decryptHeld(heldDriveBackup);
  }

  async function decryptHeld(bytes: Uint8Array): Promise<void> {
    if (!drivePass) {
      setDriveError('Isi kata sandi cadangan dulu.');
      setDriveStatus('');
      return;
    }
    let result: InspectResult | null = null;
    const ok = await runFlow(
      DRIVE_DECRYPT_STEPS,
      async (advance) => {
        result = await onDriveDecrypt(bytes, drivePass, advance);
      },
      'Cadangan dari Drive diperiksa.',
    );
    setHeldDriveBackup(null);
    if (ok && result) onInspected(result, drivePass);
  }

  async function clearOverride(): Promise<void> {
    setClientId('');
    setShowOwnId(false);
    await onSaveSettings({ driveClientId: null });
  }

  return (
    <>
      <p>
        Status:{' '}
        <strong>{connected ? 'Terhubung' : 'Belum terhubung'}</strong>
        {settings.driveLastBackupAt
          ? ` · cadangan terakhir ${new Date(settings.driveLastBackupAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : ''}
      </p>
      {hasDefault ? (
        <p>
          Tekan Hubungkan, lalu pilih akun Google-mu. DompetKu sudah membawa
          Client ID-nya sendiri, jadi tidak ada yang perlu ditempel. Cadangan
          terenkripsi disimpan di folder aplikasi Google Drive-mu, dan aplikasi
          ini hanya bisa melihat folder itu, bukan file Drive-mu yang lain.
        </p>
      ) : (
        <p>
          Cadangan terenkripsi disimpan di folder aplikasi Google Drive-mu.
          Aplikasi ini hanya bisa melihat folder itu, bukan file Drive-mu yang
          lain.
        </p>
      )}
      {showOwnId ? (
        <div className="field">
          <label htmlFor="drive-client-id">
            {hasDefault
              ? 'Client ID Google sendiri (opsional)'
              : 'Client ID Google (OAuth)'}
          </label>
          <input
            id="drive-client-id"
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="xxx.apps.googleusercontent.com"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="drive-pass">Kata sandi cadangan</label>
        <input
          id="drive-pass"
          type="password"
          value={drivePass}
          onChange={(e) => setDrivePass(e.target.value)}
          placeholder="Minimal 8 karakter, huruf dan angka"
          autoComplete="new-password"
          aria-describedby="drive-pass-hint"
        />
      </div>
      <div className="field">
        <label htmlFor="drive-pass-confirm">
          Konfirmasi kata sandi cadangan
        </label>
        <input
          id="drive-pass-confirm"
          type="password"
          value={drivePassConfirm}
          onChange={(e) => setDrivePassConfirm(e.target.value)}
          placeholder="Tulis lagi kata sandinya"
          autoComplete="new-password"
          aria-describedby="drive-pass-hint"
        />
        <p className="hint" id="drive-pass-hint">
          Kata sandi yang sama dengan cadangan file, supaya satu kata sandi
          membuka semua cadanganmu.
        </p>
      </div>
      <div className="drive-actions">
        {connected ? null : (
          <button
            type="button"
            className="button-primary small"
            onClick={() => void connect()}
            disabled={busy}
          >
            Hubungkan Google Drive
          </button>
        )}
        <button
          type="button"
          className="button-primary small"
          onClick={() => void backup()}
          disabled={busy || !connected}
        >
          Cadangkan ke Drive
        </button>
        <button
          type="button"
          className="button-ghost small"
          onClick={() => void restore()}
          disabled={busy || !connected}
        >
          Pulihkan dari Drive
        </button>
        {connected ? (
          <button
            type="button"
            className="text-button danger"
            onClick={() =>
              void run(() => onDriveDisconnect(), 'Google Drive diputuskan.')
            }
            disabled={busy}
          >
            Putuskan
          </button>
        ) : null}
      </div>
      {driveStatus ? (
        <p className="form-status" role="status">
          {driveStatus}
        </p>
      ) : null}
      {driveError ? (
        <p className="form-error" role="alert">
          {driveError}
        </p>
      ) : null}
      {hasDefault ? (
        <div className="drive-actions">
          {showOwnId ? (
            <>
              <button
                type="button"
                className="button-ghost small"
                onClick={() => void onSaveSettings({ driveClientId: clientId.trim() || null })}
                disabled={busy}
              >
                Simpan Client ID saja
              </button>
              {settings.driveClientId ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void clearOverride()}
                  disabled={busy}
                >
                  Pakai bawaan aplikasi
                </button>
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowOwnId(false)}
                  disabled={busy}
                >
                  Sembunyikan
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setShowOwnId(true)}
              disabled={busy}
            >
              Pakai Client ID sendiri
            </button>
          )}
        </div>
      ) : (
        <>
          <h3>Cara mendapatkan Client ID</h3>
          <ol className="guide-steps">
            <li>
              Buka{' '}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                console.cloud.google.com/apis/credentials
              </a>{' '}
              dan masuk dengan akun Google.
            </li>
            <li>Buat proyek baru kalau belum ada, lalu aktifkan Google Drive API.</li>
            <li>
              Di layar persetujuan OAuth, pilih tipe External dan isi data
              aplikasinya.
            </li>
            <li>
              Buat kredensial OAuth Client ID tipe Web application, dan daftarkan
              alamat ini sebagai Authorized JavaScript origin:{' '}
              <code>{origin || '(alamat situs ini)'}</code>.
            </li>
            <li>Salin Client ID-nya, tempel di kolom di atas, lalu hubungkan.</li>
          </ol>
          <div className="drive-actions">
            <button
              type="button"
              className="button-ghost small"
              onClick={() => void onSaveSettings({ driveClientId: clientId.trim() || null })}
              disabled={busy}
            >
              Simpan Client ID saja
            </button>
          </div>
        </>
      )}
      <p className="hint">
        Client ID bukan rahasia, tapi token aksesnya hanya tersimpan di
        perangkat ini dan tidak pernah ikut dicadangkan. Tanpa kata sandi di
        atas, file di Drive tidak bisa dibuka. File cadangannya tersimpan di
        folder aplikasi Drive yang tersembunyi, jadi tidak tampil di
        drive.google.com — tanggal cadangan terakhir di atas adalah bukti
        cadangannya tersimpan.
      </p>
      {stepper.steps ? <Stepper steps={stepper.steps} /> : null}
    </>
  );
}
