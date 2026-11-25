// DompetKu v1.0.2 — Drive service tests (stubbed GIS + mocked fetch).
// No real Google account is touched.

import { describe, expect, it, vi } from 'vitest';
import {
  DriveAuthError,
  DriveService,
  DRIVE_BACKUP_FILENAME,
  resolveDriveClientId,
} from './drive';

describe('resolveDriveClientId', () => {
  it('prefers the user’s own Client ID over the shared default', () => {
    expect(
      resolveDriveClientId('own.apps.googleusercontent.com', 'shared.apps.googleusercontent.com'),
    ).toBe('own.apps.googleusercontent.com');
  });

  it('falls back to the shared default when no override is saved', () => {
    expect(
      resolveDriveClientId(null, 'shared.apps.googleusercontent.com'),
    ).toBe('shared.apps.googleusercontent.com');
  });

  it('returns null when neither an override nor a default exists', () => {
    expect(resolveDriveClientId(null, '')).toBeNull();
    expect(resolveDriveClientId('   ', '')).toBeNull();
  });
});

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

function stubGis() {
  return {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (res: { access_token: string; expires_in: number }) => void;
          error_callback?: (err: unknown) => void;
        }) => ({
          requestAccessToken: (_opts: { prompt?: string }) => {
            config.callback({ access_token: 'tok-123', expires_in: 3600 });
          },
        }),
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DriveService', () => {
  it('connects and returns a token with an expiry', async () => {
    const service = new DriveService(() => Promise.resolve(stubGis()));
    const before = Date.now();
    const token = await service.connect(CLIENT_ID);
    expect(token.accessToken).toBe('tok-123');
    expect(token.expiresAt).toBeGreaterThan(before + 3_500_000);
    expect(token.expiresAt).toBeLessThanOrEqual(before + 3_600_000);
  });

  it('lists backups in the app folder', async () => {
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          files: [
            {
              id: 'f1',
              name: DRIVE_BACKUP_FILENAME,
              modifiedTime: '2026-11-24T00:00:00Z',
              size: 1234,
            },
          ],
        }),
    );
    const service = new DriveService(() => Promise.resolve(stubGis()), fetchFn);
    const files = await service.listBackups('tok-123');
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe('f1');
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain('spaces=appDataFolder');
    expect(url).toContain(encodeURIComponent(DRIVE_BACKUP_FILENAME));
  });

  it('creates a new backup file when none exists', async () => {
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ id: 'f2', modifiedTime: '2026-11-24T01:00:00Z' }),
    );
    const service = new DriveService(() => Promise.resolve(stubGis()), fetchFn);
    const result = await service.uploadBackup(
      'tok-123',
      new Uint8Array([1, 2, 3]),
      null,
    );
    expect(result.id).toBe('f2');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    );
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(Blob);
  });

  it('updates the existing file instead of duplicating it', async () => {
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ id: 'f1', modifiedTime: '2026-11-24T02:00:00Z' }),
    );
    const service = new DriveService(() => Promise.resolve(stubGis()), fetchFn);
    await service.uploadBackup('tok-123', new Uint8Array([1, 2, 3]), 'f1');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://www.googleapis.com/upload/drive/v3/files/f1?uploadType=multipart',
    );
    expect(init.method).toBe('PATCH');
  });

  it('downloads backup bytes', async () => {
    const bytes = new Uint8Array([68, 77, 80, 84, 2]);
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(bytes, { status: 200 }),
    );
    const service = new DriveService(() => Promise.resolve(stubGis()), fetchFn);
    const out = await service.downloadBackup('tok-123', 'f1');
    expect(out).toEqual(bytes);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/drive/v3/files/f1?alt=media');
  });

  it('turns a 401 into a DriveAuthError', async () => {
    const fetchFn = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('', { status: 401 }),
    );
    const service = new DriveService(() => Promise.resolve(stubGis()), fetchFn);
    await expect(service.listBackups('expired')).rejects.toBeInstanceOf(
      DriveAuthError,
    );
  });

  it('calls fetch bare, not as a method of the service', async () => {
    // Browsers reject fetch when it runs with a non-Window receiver
    // ("Illegal invocation"). A mock that enforces that rule catches the
    // bug: before the fix, uploadBackup threw before any request left.
    const strictFetch = function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(
        jsonResponse({ id: 'f2', modifiedTime: '2026-11-25T01:00:00Z' }),
      );
    };
    const service = new DriveService(
      () => Promise.resolve(stubGis()),
      strictFetch as unknown as typeof fetch,
    );
    const result = await service.uploadBackup(
      'tok-123',
      new Uint8Array([1, 2, 3]),
      null,
    );
    expect(result.id).toBe('f2');
  });
});
