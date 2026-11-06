/**
 * Bars for the "as emitted" lane, built by sampling the engine's held-note set once per frame.
 * The set says which pitches are sounding now and nothing else: a pitch newly on opens a bar at the
 * sampled position, newly off closes it; a position that fell below the previous one (a loop wrap or
 * a seek back) drops every bar first. The position passed is region-local (the page subtracts the
 * region start), so it falls on every wrap. Velocity is not in the set, a note shorter than a frame can be
 * missed, and two hits of one pitch less than a frame apart can read as one bar (a pushed Zeitgeist off-beat ending just before the next
 * downbeat), so the lane is for Arpeggio steps and Pitch moves, not for Velocity or fine timing.
 * Closed bars older than `horizon` pulses behind the position are dropped. A `Bar` is structurally a
 * `LaneNote` without velocity, which is how the lane draws it without this file importing a component.
 */
import { PATTERN_PPQN } from "./patterns";

export interface Bar {
  readonly pitch: number;
  /** ppqn */
  readonly from: number;
  /** ppqn; null while the pitch is still sounding */
  readonly to: number | null;
}

type OpenBar = { -readonly [K in keyof Bar]: Bar[K] };

export class EmittedBars {
  readonly #open = new Map<number, OpenBar>();
  #bars: OpenBar[] = [];
  #lastPosition = -Infinity;

  constructor(private readonly horizon: number = PATTERN_PPQN) {}

  get bars(): readonly Bar[] {
    return this.#bars;
  }

  /** Call once per frame with the current held-note predicate and transport position. */
  sample(isOn: (pitch: number) => boolean, position: number): void {
    if (position < this.#lastPosition) this.reset();
    this.#lastPosition = position;
    for (let pitch = 0; pitch < 128; pitch++) {
      const open = this.#open.get(pitch);
      if (isOn(pitch)) {
        if (open === undefined) {
          const bar: OpenBar = { pitch, from: position, to: null };
          this.#open.set(pitch, bar);
          this.#bars.push(bar);
        }
      } else if (open !== undefined) {
        open.to = position;
        this.#open.delete(pitch);
      }
    }
    const oldest = position - this.horizon;
    this.#bars = this.#bars.filter((bar) => bar.to === null || bar.to >= oldest);
  }

  /** Drop every bar, open ones included. */
  reset(): void {
    this.#open.clear();
    this.#bars = [];
    this.#lastPosition = -Infinity;
  }
}
