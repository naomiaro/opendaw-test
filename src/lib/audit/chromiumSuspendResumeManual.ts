/**
 * The manual mode of the Chromium 560233271 probe (`&manual=1`): one real click per cycle, as
 * on the tracker's repro page. The probe waits on `nextAction()`; the page's "Suspend / resume"
 * and "Finish" buttons call `press()` and render the rows the probe adds.
 */

export type ManualAction = "cycle" | "finish";

/** One cycle's line in the page's live table. */
export interface ManualRow {
  cycle: number;
  graphPurityDb: number;
  micPurityDb: number | null;
  micClicks: number | null;
  clockRatio: number;
}

export interface ManualState {
  /** A manual run is on: the page shows its buttons and table. */
  active: boolean;
  /** The probe waits for a press: the buttons are live. */
  awaiting: boolean;
  rows: ManualRow[];
}

export class ManualSession {
  #state: ManualState = { active: false, awaiting: false, rows: [] };
  readonly #listeners = new Set<(state: ManualState) => void>();
  #pending: ((action: ManualAction) => void) | null = null;

  subscribe(listener: (state: ManualState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #set(next: ManualState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }

  start(): void {
    this.#pending = null;
    this.#set({ active: true, awaiting: false, rows: [] });
  }

  /** Resolves with the next press. */
  nextAction(): Promise<ManualAction> {
    return new Promise((resolve) => {
      this.#pending = resolve;
      this.#set({ ...this.#state, awaiting: true });
    });
  }

  /** A button's click; ignored while no cycle waits for one. */
  press(action: ManualAction): void {
    const pending = this.#pending;
    if (pending === null) return;
    this.#pending = null;
    this.#set({ ...this.#state, awaiting: false });
    pending(action);
  }

  addRow(row: ManualRow): void {
    this.#set({ ...this.#state, rows: [...this.#state.rows, row] });
  }

  end(): void {
    this.#pending = null;
    this.#set({ ...this.#state, active: false, awaiting: false });
  }
}

/** The one session the probe and the page share. */
export const manualSession = new ManualSession();
