// DompetKu v1.0.2 — Google Drive backup section in Settings.
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

const DRIVE_RESTORE_STEPS: StepDef[] = [
  { id: 'download', label: 'Mengunduh dari Drive' },
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
  backupPassphrase,
  backupPassphraseConfirm,
  onSaveSettings,
  onDriveConnect,
  onDriveDisconnect,
  onDriveBackup,
  onDriveRestore,
  onInspected,
}: {
  settings: Settings;
  backupPassphrase: string;
  backupPassphraseConfirm: string;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
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
  onInspected: (result: InspectResult, passphrase: string) => void;
}) {
  const hasDefault = DEFAULT_DRIVE_CLIENT_ID.trim().length > 0;
  const [clientId, setClientId] = useState(settings.driveClientId ?? '');
  const [showOwnId, setShowOwnId] = useState(
    !hasDefault || settings.driveClientId !== null,
  );
  const [busy, setBusy] = useState(false);
  const [driveStatus, setDriveStatus] = useState('');
  const [driveError, setDriveError] = useState('');
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
    const err = validatePassphrase(
      backupPassphrase,
      backupPassphraseConfirm,
    );
    if (err) {
      setDriveError(err);
      setDriveStatus('');
      return;
    }
    await runFlow(
      DRIVE_BACKUP_STEPS,
      (advance) => onDriveBackup(backupPassphrase, advance),
      'Cadangan tersimpan di Google Drive.',
    );
  }

  async function restore(): Promise<void> {
    if (!backupPassphrase) {
      setDriveError('Isi kata sandi cadangan dulu.');
      setDriveStatus('');
      return;
    }
    let result: InspectResult | null = null;
    const ok = await runFlow(
      DRIVE_RESTORE_STEPS,
      async (advance) => {
        result = await onDriveRestore(backupPassphrase, advance);
      },
      'Cadangan dari Drive diperiksa.',
    );
    if (ok && result) onInspected(result, backupPassphrase);
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
            className="text-button"
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
        perangkat ini dan tidak pernah ikut dicadangkan. Cadangkan dan Pulihkan
        memakai kata sandi dari bagian Cadangkan &amp; pulihkan di atas
        (minimal 8 karakter, huruf dan angka). Tanpa kata sandi itu, file di
        Drive tidak bisa dibuka. File cadangannya tersimpan di folder aplikasi
        Drive yang tersembunyi, jadi tidak tampil di drive.google.com —
        tanggal cadangan terakhir di atas adalah bukti cadangannya tersimpan.
      </p>
      {stepper.steps ? <Stepper steps={stepper.steps} /> : null}
    </>
  );
}
