// DompetKu v1.0.2 — quick first-run setup.
// One wallet + budget first; the API key comes later (the chat reminds).

import { useState } from 'react';
import { parseAmountId } from '../lib/money';
import type { Settings, Wallet } from '../lib/types';
import { uid } from '../lib/types';

export function Setup({
  onDone,
}: {
  onDone: (wallet: Wallet, settings: Partial<Settings>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [cycleDay, setCycleDay] = useState('1');
  const [warnPercent, setWarnPercent] = useState('80');
  const [error, setError] = useState('');

  async function submit(withBudget: boolean): Promise<void> {
    const cleanName = name.trim().slice(0, 40);
    if (!cleanName) {
      setError('Beri nama dompetmu dulu, contoh: Makan.');
      return;
    }
    let budgetAmount: number | null = null;
    if (withBudget) {
      const parsed = parseAmountId(budget);
      if (parsed === null) {
        setError('Anggaran belum kebaca. Contoh: 2 juta atau 2000000.');
        return;
      }
      budgetAmount = parsed;
    }
    const warn = Number.parseInt(warnPercent, 10);
    const wallet: Wallet = {
      id: uid(),
      name: cleanName,
      currency: 'IDR',
      budgetAmount,
      cycleStartDay: Number.parseInt(cycleDay, 10) || 1,
      warnPercent: Number.isFinite(warn) && warn >= 1 && warn <= 100 ? warn : 80,
      createdAt: Date.now(),
    };
    await onDone(wallet, { setupDone: true });
  }

  return (
    <div className="setup">
      <p className="setup-kicker">Selamat datang di DompetKu</p>
      <h1>Buat dompet pertamamu</h1>
      <p className="setup-intro">
        Dompet adalah wadah anggaranmu — contohnya Makan, Transportasi, atau
        Jajan. Kamu mencatat pengeluaran lewat chat, dan DompetKu yang
        menghitung sisanya.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
      >
        <div className="field">
          <label htmlFor="setup-name">Nama dompet</label>
          <input
            id="setup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Makan"
            autoComplete="off"
            maxLength={40}
            enterKeyHint="next"
          />
        </div>
        <div className="field">
          <label htmlFor="setup-budget">Anggaran per bulan (Rp)</label>
          <input
            id="setup-budget"
            type="text"
            inputMode="numeric"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Contoh: 2 juta"
            autoComplete="off"
            enterKeyHint="next"
          />
          <p className="hint">Boleh dikosongkan — nanti bisa diatur di tab Dompet.</p>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="setup-cycle">Bulan mulai tanggal</label>
            <select
              id="setup-cycle"
              name="cycleDay"
              value={cycleDay}
              onChange={(e) => setCycleDay(e.target.value)}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
            <p className="hint">
              Sesuaikan dengan tanggal gajianmu. Kalau bulan itu lebih
              pendek, siklus mulai di tanggal terakhir bulan itu.
            </p>
          </div>
          <div className="field">
            <label htmlFor="setup-warn">Ingatkan saat</label>
            <select
              id="setup-warn"
              name="warnPercent"
              value={warnPercent}
              onChange={(e) => setWarnPercent(e.target.value)}
            >
              <option value="50">50%</option>
              <option value="70">70%</option>
              <option value="80">80%</option>
              <option value="90">90%</option>
            </select>
            <p className="hint">Persen anggaran terpakai.</p>
          </div>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button-primary">
          Buat dompet
        </button>
        <button
          type="button"
          className="button-ghost"
          onClick={() => void submit(false)}
        >
          Lewati anggaran dulu
        </button>
      </form>
      <p className="setup-privacy">
        Semua data tersimpan di perangkat ini. Tidak ada akun, tidak ada server.
      </p>
    </div>
  );
}
