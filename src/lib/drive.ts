// DompetKu v1.0.0 — Google Drive cloud backup.
// The backup file lives in the app's own Drive folder (appDataFolder), so
// the app can only see its own backup, never the user's other Drive files.
// Auth is Google Identity Services (token client, no server). Sign-in is
// single sign-on: the app ships one shared OAuth client ID (set once by the
// app owner in DEFAULT_DRIVE_CLIENT_ID below), so users just tap Hubungkan
// and pick their Google account. A user can still paste their own Client ID
// in Settings; that override wins over the shared one. The access token
// stays on this device and is never included in a backup.

import type { DriveBackupInfo } from './types';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DRIVE_BACKUP_FILENAME = 'dompetku-backup.dompetku';

/**
 * Shared OAuth client ID for the app's single sign-on. A Client ID is a
 * public identifier, not a secret — it ships in the bundle, and Google only
 * issues tokens to the JavaScript origins registered for it in the Cloud
 * console. Empty until the app owner creates the client once and pastes the
 * ID here; with no shared ID the app falls back to asking each user for
 * their own Client ID.
 */
export const DEFAULT_DRIVE_CLIENT_ID =
  '177272517320-v8ofunq4ngd04mc57rh3vnpiss4ig7dq.apps.googleusercontent.com';

/**
 * The Client ID a sign-in actually uses: the user's own override when one
 * is saved, otherwise the shared default, otherwise null (no sign-in is
 * possible until a Client ID is provided one way or the other).
 */
export function resolveDriveClientId(
  override: string | null,
  shared: string = DEFAULT_DRIVE_CLIENT_ID,
): string | null {
  const own = override?.trim();
  if (own) return own;
  const fallback = shared.trim();
  return fallback ? fallback : null;
}

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

export class DriveAuthError extends Error {
  constructor(message = 'Sesi Google Drive berakhir. Hubungkan ulang di Pengaturan.') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface TokenClient {
  requestAccessToken: (opts: { prompt?: string }) => void;
}

interface GisOauth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (res: TokenResponse) => void;
    error_callback?: (err: unknown) => void;
  }) => TokenClient;
}

interface GisLike {
  accounts: { oauth2: GisOauth2 };
}

type GisLoader = () => Promise<GisLike>;

let gisPromise: Promise<GisLike> | null = null;

function defaultGisLoader(): Promise<GisLike> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GisLike>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${GIS_SCRIPT}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if ((window as unknown as { google?: GisLike }).google?.accounts?.oauth2) {
        resolve((window as unknown as { google: GisLike }).google);
        return;
      }
      existing.addEventListener('load', () => resolveGis(resolve, reject));
      existing.addEventListener('error', () =>
        reject(new Error('Pustaka Google gagal dimuat.')),
      );
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolveGis(resolve, reject);
    script.onerror = () => reject(new Error('Pustaka Google gagal dimuat.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

function resolveGis(
  resolve: (gis: GisLike) => void,
  reject: (err: Error) => void,
): void {
  const google = (window as unknown as { google?: GisLike }).google;
  if (google?.accounts?.oauth2) resolve(google);
  else reject(new Error('Pustaka Google gagal dimuat.'));
}

export interface DriveToken {
  accessToken: string;
  expiresAt: number;
}

export class DriveService {
  private loadGis: GisLoader;
  private fetchFn: typeof fetch;

  constructor(
    loadGis: GisLoader = defaultGisLoader,
    fetchFn: typeof fetch = fetch,
  ) {
    this.loadGis = loadGis;
    this.fetchFn = fetchFn;
  }

  private async requestToken(
    clientId: string,
    prompt: '' | 'consent',
  ): Promise<DriveToken> {
    const gis = await this.loadGis();
    return new Promise<DriveToken>((resolve, reject) => {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (res) => {
          if (!res.access_token) {
            reject(new Error('Google tidak memberikan token.'));
            return;
          }
          // One minute of skew margin so the token never dies mid-upload.
          const expiresAt = Date.now() + res.expires_in * 1000 - 60_000;
          resolve({ accessToken: res.access_token, expiresAt });
        },
        error_callback: () => {
          reject(new Error('Izin Google Drive ditolak.'));
        },
      });
      client.requestAccessToken({ prompt });
    });
  }

  /** First connect: shows the Google consent screen. */
  connect(clientId: string): Promise<DriveToken> {
    return this.requestToken(clientId, 'consent');
  }

  /** Silent refresh while the grant is still valid; null when it is not. */
  async refresh(clientId: string): Promise<DriveToken | null> {
    try {
      return await this.requestToken(clientId, '');
    } catch {
      return null;
    }
  }

  private async authorized(
    token: string,
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const res = await this.fetchFn(path, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401 || res.status === 403) throw new DriveAuthError();
    return res;
  }

  /** The backup file in the app folder, newest first. */
  async listBackups(token: string): Promise<DriveBackupInfo[]> {
    const q = encodeURIComponent(
      `name='${DRIVE_BACKUP_FILENAME}' and 'appDataFolder' in parents and trashed=false`,
    );
    const res = await this.authorized(
      token,
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`,
      { method: 'GET' },
    );
    if (!res.ok) throw new Error('Gagal membaca daftar cadangan Drive.');
    const data = (await res.json()) as { files?: DriveBackupInfo[] };
    return data.files ?? [];
  }

  /**
   * Upload the encrypted backup bytes. Updates the existing file when one
   * is already there, so the folder never fills with duplicates.
   */
  async uploadBackup(
    token: string,
    bytes: Uint8Array,
    existingId: string | null,
  ): Promise<{ id: string; modifiedTime: string }> {
    const boundary = `dompetku-${Date.now().toString(36)}`;
    const metadata = JSON.stringify({
      name: DRIVE_BACKUP_FILENAME,
      parents: existingId ? undefined : ['appDataFolder'],
    });
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob(
      [head, bytes as BlobPart, tail],
      { type: `multipart/related; boundary=${boundary}` },
    );
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await this.authorized(token, url, {
      method: existingId ? 'PATCH' : 'POST',
      body,
    });
    if (!res.ok) throw new Error('Gagal mengunggah cadangan ke Drive.');
    const data = (await res.json()) as { id: string; modifiedTime: string };
    return { id: data.id, modifiedTime: data.modifiedTime };
  }

  /** Download the encrypted backup bytes of one file. */
  async downloadBackup(token: string, fileId: string): Promise<Uint8Array> {
    const res = await this.authorized(
      token,
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { method: 'GET' },
    );
    if (!res.ok) throw new Error('Gagal mengunduh cadangan dari Drive.');
    return new Uint8Array(await res.arrayBuffer());
  }
}
