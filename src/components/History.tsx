// DompetKu v1.0.0 — history tab.
// Grouped by day, filterable by wallet, deletable with a two-tap confirm.

import { useState } from 'react';
import { formatIDR } from '../lib/money';
import type { Category, Transaction, Wallet } from '../lib/types';
import { EmptyState } from './ui';

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hari ini';
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function History({
  wallets,
  categories,
  transactions,
  onDelete,
}: {
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const visible =
    filter === 'all'
      ? transactions
      : transactions.filter((t) => t.walletId === filter);
  const sorted = [...visible].sort((a, b) => b.occurredAt - a.occurredAt);

  const groups = new Map<string, Transaction[]>();
  for (const t of sorted) {
    const key = new Date(t.occurredAt).toDateString();
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  return (
    <div className="screen-scroll">
      <header className="page-head">
        <h1>Riwayat</h1>
        <p>Semua pengeluaranmu, dari yang terbaru.</p>
      </header>

      <div className="chips" aria-label="Saring berdasarkan dompet">
        <button
          type="button"
          className={filter === 'all' ? 'chip-active' : ''}
          onClick={() => setFilter('all')}
        >
          Semua
        </button>
        {wallets.map((w) => (
          <button
            key={w.id}
            type="button"
            className={filter === w.id ? 'chip-active' : ''}
            onClick={() => setFilter(w.id)}
          >
            {w.name}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="Belum ada catatan"
          text="Pengeluaran yang kamu catat lewat chat akan muncul di sini."
        />
      ) : (
        [...groups.entries()].map(([key, list]) => (
          <section key={key}>
            <h2 className="day-head">{dayLabel(list[0].occurredAt)}</h2>
            <ul className="activity">
              {list.map((t) => {
                const wallet = wallets.find((w) => w.id === t.walletId);
                const category = categories.find((c) => c.id === t.categoryId);
                return (
                  <li key={t.id}>
                    <span className="act-icon" aria-hidden="true">
                      {t.note.charAt(0).toUpperCase()}
                    </span>
                    <span className="act-text">
                      {t.note}
                      <small>
                        {category?.name ?? 'Lainnya'} · {wallet?.name ?? 'Dompet'} ·{' '}
                        {new Date(t.occurredAt).toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <strong>−{formatIDR(t.amount)}</strong>
                    {confirmId === t.id ? (
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => void onDelete(t.id)}
                      >
                        Yakin hapus?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-button danger"
                        aria-label={`Hapus ${t.note}`}
                        onClick={() => setConfirmId(t.id)}
                      >
                        Hapus
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
