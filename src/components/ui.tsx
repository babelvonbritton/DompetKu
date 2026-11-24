// DompetKu v1.0.0 — small shared UI pieces.
// General, functional comments only. Porto green theme, solid colors.

import type { ReactNode } from 'react';
import { formatIDR } from '../lib/money';

export function ProgressBar({
  percent,
  label,
  tone = 'green',
}: {
  percent: number;
  label: string;
  tone?: 'green' | 'amber' | 'red';
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span
        className={`progress-fill progress-${tone}`}
        style={{ transform: `scaleX(${clamped / 100})` }}
      />
    </div>
  );
}

export function Money({
  amount,
  className,
}: {
  amount: number;
  className?: string;
}) {
  return <span className={className}>{formatIDR(amount)}</span>;
}

export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-text">{text}</p>
      {action}
    </div>
  );
}
