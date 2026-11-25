// DompetKu v1.0.2 — wallet list and editing.
// Budget, cycle start day and warn percent are set per wallet.

import { useState } from 'react';
import { budgetStatus, cycleRange, formatIDR, parseAmountId, sumSpent } from '../lib/money';
import type { Transaction, Wallet } from '../lib/types';
import { uid } from '../lib/types';
import { ProgressBar } from './ui';

interface FormState {
  name: string;
  budget: string;
  cycleDay: string;
  warnPercent: string;
}

function formFromWallet(w: Wallet): FormState {
  return {
    name: w.name,
    budget: w.budgetAmount === null ? '' : String(w.budgetAmount),
    cycleDay: String(w.cycleStartDay),
    warnPercent: String(w.warnPercent),
  };
}

const EMPTY_FORM: FormState = {
  name: '',
  budget: '',
  cycleDay: '1',
  warnPercent: '80',
};

export function Wallets({
  wallets,
  transactions,
  onUpsert,
  onDelete,
}: {
  wallets: Wallet[];
  transactions: Transaction[];
  onUpsert: (wallet: Wallet) => Promise<void>;
  onDelete: (walletId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const now = new Date();

  function startEdit(wallet: Wallet | null): void {
    setEditingId(wallet ? wallet.id : 'new');
    setForm(wallet ? formFromWallet(wallet) : EMPTY_FORM);
    setError('');
    setDeleteId(null);
  }

  async function save(): Promise<void> {
    const name = form.name.trim().slice(0, 40);
    if (!name) {
      setError('Beri nama dompetmu dulu.');
      return;
    }
    let budgetAmount: number | null = null;
    if (form.budget.trim()) {
      const parsed = parseAmountId(form.budget);
      if (parsed === null) {
        setError('Anggaran belum kebaca. Contoh: 2 juta atau 2000000.');
        return;
      }
      budgetAmount = parsed;
    }
    const warn = Number.parseInt(form.warnPercent, 10);
    const cycleDay = Number.parseInt(form.cycleDay, 10);
    const wallet: Wallet =
      editingId && editingId !== 'new'
        ? {
            ...(wallets.find((w) => w.id === editingId) as Wallet),
            name,
            budgetAmount,
            cycleStartDay: Number.isFinite(cycleDay) ? cycleDay : 1,
            warnPercent: Number.isFinite(warn) && warn >= 1 && warn <= 100 ? warn : 80,
          }
        : {
            id: uid(),
            name,
            currency: 'IDR',
            budgetAmount,
            cycleStartDay: Number.isFinite(cycleDay) ? cycleDay : 1,
            warnPercent: Number.isFinite(warn) && warn >= 1 && warn <= 100 ? warn : 80,
            createdAt: Date.now(),
          };
    await onUpsert(wallet);
    setEditingId(null);
    setError('');
  }

  return (
    <div className="screen-scroll">
      <header className="page-head">
        <h1>Dompet</h1>
        <p>
          Setiap dompet punya anggaran bulanan sendiri. Ketuk dompet untuk
          mengubahnya.
        </p>
      </header>

      <div className="wallet-list">
        {wallets.map((w) => {
          const cycle = cycleRange(now, w.cycleStartDay);
          const spent = sumSpent(transactions, w.id, cycle.start.getTime(), cycle.end.getTime());
          const status =
            w.budgetAmount !== null
              ? budgetStatus(spent, w.budgetAmount, w.warnPercent)
              : null;
          const isEditing = editingId === w.id;
          return (
            <article key={w.id} className="wallet-card static">
              <div className="card-row">
                <span className="wallet-name">{w.name}</span>
                <strong>
                  {status ? `${formatIDR(status.left)} lagi` : 'Belum ada anggaran'}
                </strong>
              </div>
              {status ? (
                <>
                  <ProgressBar
                    percent={status.usedPercent}
                    label={`Anggaran ${w.name} terpakai ${Math.round(status.usedPercent)} persen`}
                    tone={status.over ? 'red' : status.warned ? 'amber' : 'green'}
                  />
                  <p className="card-note">
                    {formatIDR(spent)} dari {formatIDR(w.budgetAmount ?? 0)} · periode{' '}
                    {cycle.start.getDate()}/{cycle.start.getMonth() + 1}–
                    {cycle.end.getDate()}/{cycle.end.getMonth() + 1} · ingatkan saat{' '}
                    {w.warnPercent}%
                  </p>
                </>
              ) : (
                <p className="card-note">
                  Belum ada anggaran, jadi belum ada pengingat.
                </p>
              )}
              <div className="card-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => startEdit(w)}
                >
                  Ubah
                </button>
                {deleteId === w.id ? (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => void onDelete(w.id)}
                  >
                    Yakin hapus? Semua catatan di dompet ini ikut terhapus.
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => setDeleteId(w.id)}
                    disabled={wallets.length <= 1}
                  >
                    Hapus
                  </button>
                )}
              </div>
              {isEditing ? (
                <WalletForm
                  form={form}
                  setForm={setForm}
                  error={error}
                  onSave={() => void save()}
                  onCancel={() => setEditingId(null)}
                  saveLabel="Simpan"
                />
              ) : null}
            </article>
          );
        })}
      </div>

      {editingId === 'new' ? (
        <div className="wallet-card static">
          <WalletForm
            form={form}
            setForm={setForm}
            error={error}
            onSave={() => void save()}
            onCancel={() => setEditingId(null)}
            saveLabel="Buat dompet"
          />
        </div>
      ) : (
        <button
          type="button"
          className="add-wallet"
          onClick={() => startEdit(null)}
        >
          + Tambah dompet
        </button>
      )}
    </div>
  );
}

function WalletForm({
  form,
  setForm,
  error,
  onSave,
  onCancel,
  saveLabel,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <form
      className="form compact"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="field">
        <label htmlFor={`wf-name-${saveLabel}`}>Nama dompet</label>
        <input
          id={`wf-name-${saveLabel}`}
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Contoh: Makan"
          maxLength={40}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor={`wf-budget-${saveLabel}`}>Anggaran per bulan (Rp)</label>
        <input
          id={`wf-budget-${saveLabel}`}
          type="text"
          inputMode="numeric"
          value={form.budget}
          onChange={(e) => setForm({ ...form, budget: e.target.value })}
          placeholder="Contoh: 2 juta (boleh kosong)"
          autoComplete="off"
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`wf-cycle-${saveLabel}`}>Bulan mulai tanggal</label>
          <select
            id={`wf-cycle-${saveLabel}`}
            name="cycleDay"
            value={form.cycleDay}
            onChange={(e) => setForm({ ...form, cycleDay: e.target.value })}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)}>
                {d}
              </option>
            ))}
          </select>
          <p className="hint">
            Kalau bulan itu lebih pendek, siklus mulai di tanggal terakhir
            bulan itu.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`wf-warn-${saveLabel}`}>Ingatkan saat</label>
          <select
            id={`wf-warn-${saveLabel}`}
            name="warnPercent"
            value={form.warnPercent}
            onChange={(e) => setForm({ ...form, warnPercent: e.target.value })}
          >
            <option value="50">50%</option>
            <option value="70">70%</option>
            <option value="80">80%</option>
            <option value="90">90%</option>
          </select>
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="button-primary small">
          {saveLabel}
        </button>
        <button type="button" className="button-ghost small" onClick={onCancel}>
          Batal
        </button>
      </div>
    </form>
  );
}
