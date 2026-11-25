// DompetKu v1.0.2 — step-by-step progress for backup and restore,
// after Repo/Olaseena's Stepper. Each step stays visible at least 260 ms
// so the progress is readable, the first failure stops the run and is
// shown on the step where it happened, and the dialog cannot be closed
// mid-run (the buttons stay disabled until the run finishes).

import { useRef, useState } from 'react';

export interface StepDef {
  id: string;
  label: string;
}

export interface StepState extends StepDef {
  state: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
}

const MIN_STEP_MS = 260;

export function useStepper() {
  const [steps, setSteps] = useState<StepState[] | null>(null);
  const startedAt = useRef(0);
  const currentId = useRef<string | null>(null);

  function start(defs: StepDef[]): void {
    setSteps(defs.map((d) => ({ ...d, state: 'pending' })));
    currentId.current = null;
  }

  /** Move to a step, waiting out the previous step's minimum display
   * time first. Callers await this, so the flow itself is paced. */
  async function advance(id: string, detail?: string): Promise<void> {
    const elapsed = Date.now() - startedAt.current;
    if (currentId.current !== null && elapsed < MIN_STEP_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_STEP_MS - elapsed),
      );
    }
    startedAt.current = Date.now();
    currentId.current = id;
    setSteps((prev) =>
      prev?.map((s) => {
        if (s.id === id) {
          return { ...s, state: 'running', detail: detail ?? s.detail };
        }
        if (s.state === 'running') return { ...s, state: 'done' };
        return s;
      }) ?? null,
    );
  }

  async function finish(): Promise<void> {
    const elapsed = Date.now() - startedAt.current;
    if (currentId.current !== null && elapsed < MIN_STEP_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_STEP_MS - elapsed),
      );
    }
    setSteps(
      (prev) =>
        prev?.map((s) =>
          s.state === 'running' ? { ...s, state: 'done' } : s,
        ) ?? null,
    );
    currentId.current = null;
  }

  function fail(error: Error): void {
    setSteps(
      (prev) =>
        prev?.map((s) =>
          s.state === 'running'
            ? { ...s, state: 'error', detail: error.message }
            : s,
        ) ?? null,
    );
    currentId.current = null;
  }

  function reset(): void {
    setSteps(null);
    currentId.current = null;
  }

  return { steps, start, advance, finish, fail, reset };
}

function iconFor(state: StepState['state']): string {
  switch (state) {
    case 'done':
      return '✓';
    case 'error':
      return '✕';
    case 'skipped':
      return '–';
    case 'running':
      return '◌';
    default:
      return '○';
  }
}

export function Stepper({ steps }: { steps: StepState[] }) {
  const done = steps.filter(
    (s) => s.state === 'done' || s.state === 'skipped',
  ).length;
  const total = steps.length;
  const failed = steps.find((s) => s.state === 'error');
  return (
    <div className="stepper" aria-label="Proses cadangan">
      <div
        className="stepper-bar"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} dari ${total} langkah selesai`}
      >
        <div
          className="stepper-fill"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <p className="stepper-count" role="status">
        {failed
          ? 'Proses berhenti di langkah yang gagal.'
          : `${done} dari ${total} langkah selesai`}
      </p>
      <ol className="step-list">
        {steps.map((s) => (
          <li key={s.id} className={`step step-${s.state}`}>
            <span className="step-icon" aria-hidden="true">
              {iconFor(s.state)}
            </span>
            <span className="step-text">
              <span className="step-label">{s.label}</span>
              {s.detail ? (
                <span className="step-detail">{s.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
