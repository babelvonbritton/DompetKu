// DompetKu v1.0.2 — chat settings sheet.
// A native <dialog> bottom sheet opened from the gear button in the chat
// header. Everything chat-related lives here, not in the Settings tab:
// category customization and clearing the chat history.
//
// The sheet opens with showModal(), so the browser provides the top layer,
// focus containment, Esc/back-gesture dismissal and focus return — no
// manual focus trap, no role="dialog", no aria-modal. closedby="any" adds
// light dismiss (tap outside); Safari does not support closedby yet, so
// both dialogs carry the pointer-position fallback from the dialog guide
// (press and release must both land outside).
//
// Clearing the chat confirms in a second, centered modal dialog — the
// inline two-step button was too easy to miss. The confirm dialog opens
// above the sheet (top layer), Esc closes it first and reveals the sheet
// again, and autofocus sits on the safe action (Batal).

import { useEffect, useRef } from 'react';
import { CategorySection } from './CategorySection';
import type { Category, Transaction } from '../lib/types';

/** Light dismiss for browsers without closedby (Safari): press and release
 * must both land outside the dialog, so a text-selection drag that ends on
 * the backdrop does not dismiss it. */
function lightDismissFallback(dialog: HTMLDialogElement): () => void {
  dialog.setAttribute('closedby', 'any');
  if ('closedBy' in HTMLDialogElement.prototype) return () => undefined;
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
}

export function ChatSettingsSheet({
  open,
  onClose,
  categories,
  transactions,
  messageCount,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onClearChat,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  transactions: Transaction[];
  messageCount: number;
  onAddCategory: (name: string) => Promise<void>;
  onRenameCategory: (id: string, name: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onClearChat: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return lightDismissFallback(dialog);
  }, []);

  useEffect(() => {
    const dialog = confirmRef.current;
    if (!dialog) return;
    return lightDismissFallback(dialog);
  }, []);

  async function clearChat(): Promise<void> {
    await onClearChat();
    onClose();
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className="chat-sheet"
        aria-labelledby="chat-settings-title"
        onClose={() => onClose()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-head">
          <h1 id="chat-settings-title">Pengaturan chat</h1>
          <button
            type="button"
            className="icon-button"
            aria-label="Tutup pengaturan chat"
            onClick={() => dialogRef.current?.close()}
            autoFocus
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
        <div className="sheet-body">
          <CategorySection
            categories={categories}
            transactions={transactions}
            onAddCategory={onAddCategory}
            onRenameCategory={onRenameCategory}
            onDeleteCategory={onDeleteCategory}
          />
          <section
            className="settings-section"
            aria-labelledby="clear-chat-heading"
          >
            <h2 id="clear-chat-heading">Riwayat chat</h2>
            <p>
              Hapus semua pesan di chat ini. Pengeluaran, dompet, dan
              anggaranmu tidak ikut terhapus.
            </p>
            <button
              type="button"
              className="button-ghost danger"
              disabled={messageCount === 0}
              onClick={() => confirmRef.current?.showModal()}
            >
              Hapus riwayat chat
            </button>
          </section>
        </div>
      </dialog>

      <dialog
        ref={confirmRef}
        className="confirm-dialog"
        aria-labelledby="clear-chat-title"
        onClose={() => {
          const value = confirmRef.current?.returnValue ?? '';
          if (confirmRef.current) confirmRef.current.returnValue = '';
          if (value === 'delete') void clearChat();
        }}
      >
        <h1 id="clear-chat-title">Hapus semua pesan?</h1>
        <p>
          Semua pesan di chat ini akan dihapus. Pengeluaran, dompet, dan
          anggaranmu tidak ikut terhapus.
        </p>
        <form method="dialog" className="dialog-actions">
          <button type="submit" className="button-ghost" value="cancel" autoFocus>
            Batal
          </button>
          <button
            type="submit"
            className="button-primary danger"
            value="delete"
          >
            Hapus semua
          </button>
        </form>
      </dialog>
    </>
  );
}
