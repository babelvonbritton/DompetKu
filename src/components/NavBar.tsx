// DompetKu v1.0.2 — floating pill navbar.
// Chat is the raised center button; Settings sits next to History.

import type { ReactElement } from 'react';
import type { TabId } from '../lib/types';

const TABS: {
  id: TabId;
  label: string;
  icon: ReactElement;
  center?: boolean;
}[] = [
  {
    id: 'home',
    label: 'Beranda',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'wallets',
    label: 'Dompet',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <rect
          x="3"
          y="6"
          width="18"
          height="14"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M3 10h18" stroke="currentColor" strokeWidth="2" />
        <circle cx="17" cy="15" r="1.3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    center: true,
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path
          d="M4 5h16v11H9l-5 4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'Riwayat',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M12 7v5l3.5 2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Pengaturan',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="3.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function NavBar({
  tab,
  onTab,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
}) {
  return (
    <nav className="tab-bar" aria-label="Navigasi utama">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.center ? 'tab tab-center' : 'tab'}
          aria-current={tab === t.id ? 'page' : undefined}
          aria-label={t.label}
          onClick={() => onTab(t.id)}
        >
          <span className="tab-icon" aria-hidden="true">
            {t.icon}
          </span>
          <span className="tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
