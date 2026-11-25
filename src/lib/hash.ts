// DompetKu v1.0.3 — SHA-256 helpers (WebCrypto).
// Used for backup checksums (manifest) and for fingerprinting the current
// data before a restore, so a restore can tell whether the data changed
// while the user was reviewing the backup.

export async function sha256Hex(
  data: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
