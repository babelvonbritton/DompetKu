// DompetKu v1.0.0 — dashboard home (Option 2).
// Money first: what is left this month, warnings, wallets, recent activity.

import { budgetStatus, cycleRange, formatIDR, sumSpent } from '../lib/money';
import type { TabId, Transaction, Wallet } from '../lib/types';
import { ProgressBar, SectionHead } from './ui';

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function Dashboard({
  wallets,
  transactions,
  onTab,
}: {
  wallets: Wallet[];
  transactions: Transaction[];
  onTab: (tab: TabId) => void;
}) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const spentTodayAll = transactions
    .filter((t) => t.occurredAt >= todayStart.getTime() && t.occurredAt < tomorrowStart.getTime())
    .reduce((sum, t) => sum + t.amount, 0);

  let totalLeft: number | null = null;
  let totalBudget = 0;
  const walletStats = wallets.map((w) => {
    const cycle = cycleRange(now, w.cycleStartDay);
    const spent = sumSpent(transactions, w.id, cycle.start.getTime(), cycle.end.getTime());
    const status =
      w.budgetAmount !== null
        ? budgetStatus(spent, w.budgetAmount, w.warnPercent)
        : null;
    if (status) {
      totalLeft = (totalLeft ?? 0) + status.left;
      totalBudget += w.budgetAmount ?? 0;
    }
    return { wallet: w, spent, status, cycle };
  });

  const warned = walletStats.filter(
    (s) => s.status && (s.status.warned || s.status.over),
  );
  const noBudget = wallets.filter((w) => w.budgetAmount === null);
  const recent = [...transactions]
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, 5);

  return (
    <div className="screen-scroll">
      <header className="dash-head">
        <div>
          <p className="date">{dayLabel(now)}</p>
          <h1>{greeting(now)}</h1>
        </div>
      </header>

      <div className="balance-card">
        <p className="balance-label">Sisa bulan ini</p>
        <p className="balance-value">
          {totalLeft === null ? 'Belum ada anggaran' : formatIDR(totalLeft)}
        </p>
        <p className="balance-sub">
          Hari ini keluar <strong>{formatIDR(spentTodayAll)}</strong>
          {totalBudget > 0 ? ` dari anggaran ${formatIDR(totalBudget)}` : ''}
        </p>
      </div>

      {warned.length > 0 ? (
        <button
          type="button"
          className="warn-strip"
          onClick={() => onTab('wallets')}
          aria-label="Lihat dompet yang mendekati batas"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M12 3 22 20H2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M12 10v4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="17" r="1.2" fill="currentColor" />
          </svg>
          <span>
            {warned
              .map((s) =>
                s.status?.over
                  ? `Dompet ${s.wallet.name} sudah lewat anggaran`
                  : `Dompet ${s.wallet.name} sudah ${Math.round(s.status?.usedPercent ?? 0)}% terpakai`,
              )
              .join(' · ')}
          </span>
        </button>
      ) : null}

      {noBudget.length > 0 ? (
        <button
          type="button"
          className="nudge-card"
          onClick={() => onTab('wallets')}
        >
          <span>
            <strong>{noBudget.map((w) => w.name).join(', ')}</strong> belum punya
            anggaran. Atur supaya DompetKu bisa mengingatkanmu.
          </span>
          <span aria-hidden="true">›</span>
        </button>
      ) : null}

      <SectionHead
        title="Dompet"
        action={
          <button type="button" className="text-button" onClick={() => onTab('wallets')}>
            Lihat semua
          </button>
        }
      />
      <div className="wallet-list">
        {walletStats.map(({ wallet, spent, status }) => (
          <button
            key={wallet.id}
            type="button"
            className="wallet-card"
            onClick={() => onTab('wallets')}
          >
            <span className="card-row">
              <span className="wallet-name">{wallet.name}</span>
              <strong>
                {status ? `${formatIDR(status.left)} lagi` : 'Belum ada anggaran'}
              </strong>
            </span>
            {status ? (
              <>
                <ProgressBar
                  percent={status.usedPercent}
                  label={`Anggaran ${wallet.name} terpakai ${Math.round(status.usedPercent)} persen`}
                  tone={status.over ? 'red' : status.warned ? 'amber' : 'green'}
                />
                <span className="card-note">
                  {formatIDR(spent)} dari {formatIDR(wallet.budgetAmount ?? 0)}
                </span>
              </>
            ) : (
              <span className="card-note">Ketuk untuk mengatur anggaran.</span>
            )}
          </button>
        ))}
      </div>

      <SectionHead
        title="Terakhir dicatat"
        action={
          <button type="button" className="text-button" onClick={() => onTab('history')}>
            Lihat semua
          </button>
        }
      />
      {recent.length === 0 ? (
        <p className="muted-text">
          Belum ada yang dicatat. Coba tulis di chat: “Makan siang 45rb”.
        </p>
      ) : (
        <ul className="activity">
          {recent.map((t) => {
            const wallet = wallets.find((w) => w.id === t.walletId);
            return (
              <li key={t.id}>
                <span className="act-icon" aria-hidden="true">
                  {t.note.charAt(0).toUpperCase()}
                </span>
                <span className="act-text">
                  {t.note}
                  <small>{wallet?.name ?? 'Dompet'}</small>
                </span>
                <strong>−{formatIDR(t.amount)}</strong>
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="button-primary" onClick={() => onTab('chat')}>
        Catat di chat
      </button>
    </div>
  );
}
