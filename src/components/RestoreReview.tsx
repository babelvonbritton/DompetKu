// DompetKu v1.0.0 — restore review dialog.
// After a backup is verified, the user sees what differs (counts on both
// sides, the short list of changes) and decides: apply the backup, or
// keep the current data. Nothing is written before the user chooses.
// A safety backup of the current data can be downloaded first (on by
// default, same passphrase as the restore).

import { useEffect, useRef, useState } from 'react';
import type { PendingRestore } from '../App';

export function RestoreReview({
  open,
  pending,
  onClose,
  onApply,
}: {
  open: boolean;
  pending: PendingRestore;
  onClose: () => void;
  onApply: (safety: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [safety, setSafety] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute('closedby', 'any');
    if ('closedBy' in HTMLDialogElement.prototype) return;
    const outside = (e: PointerEvent): boolean => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent): void => {
      pressedOutside = outside(e);
    };
    const onUp = (e: PointerEvent): void => {
      if (pressedOutside && outside(e)) dialog.close();
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  const { diff } = pending;
  const date = new Date(pending.data.exportedAt).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog restore-review"
      aria-labelledby="restore-review-title"
      onClose={() => {
        const value = dialogRef.current?.returnValue ?? '';
        if (dialogRef.current) dialogRef.current.returnValue = '';
        if (value === 'apply') onApply(safety);
        else onClose();
      }}
    >
      <h1 id="restore-review-title">Pulihkan cadangan?</h1>
      <p>
        Cadangan dari {date}. Data saat ini akan diganti dengan isi cadangan.
      </p>
      <table className="diff-table">
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Saat ini</th>
            <th scope="col">Cadangan</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Dompet</th>
            <td>{diff.counts.current.wallets}</td>
            <td>{diff.counts.backup.wallets}</td>
          </tr>
          <tr>
            <th scope="row">Pengeluaran</th>
            <td>{diff.counts.current.transactions}</td>
            <td>{diff.counts.backup.transactions}</td>
          </tr>
          <tr>
            <th scope="row">Kategori</th>
            <td>{diff.counts.current.categories}</td>
            <td>{diff.counts.backup.categories}</td>
          </tr>
        </tbody>
      </table>
      <ul className="diff-changes">
        {diff.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      <label className="safety-check">
        <input
          type="checkbox"
          checked={safety}
          onChange={(e) => setSafety(e.target.checked)}
        />
        <span>
          Simpan cadangan pengaman dari data saat ini dulu (file diunduh
          dengan kata sandi yang sama)
        </span>
      </label>
      <form method="dialog" className="dialog-actions">
        <button type="submit" className="button-ghost" value="cancel" autoFocus>
          Batal
        </button>
        <button type="submit" className="button-primary danger" value="apply">
          Pulihkan cadangan
        </button>
      </form>
    </dialog>
  );
}
