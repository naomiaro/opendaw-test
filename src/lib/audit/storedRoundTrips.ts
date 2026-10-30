/**
 * A measured round trip stored in this browser (`CaptureAudio.measureRoundTrip`, kept per output
 * device, input label and sample rate) replaces BOTH reported latencies on every Tape whose own
 * `captureBox.inputLatency` is Inherit. The recording audits leave their Tapes on Inherit and set
 * the engine preference to 0, so an entry for a run's devices moves every take by the difference
 * and reads as an SDK change (measured: a 50 ms entry against a 23 ms `outputLatency` put a
 * loopback take at −25.85 ms netted instead of +1.15). They refuse to run while ANY entry is
 * stored: which entry applies is known only once the SDK has opened the stream inside
 * `prepareRecording`, after the last moment a page can refuse.
 */

/** `BrowserRoundTrips`' localStorage key in studio-core (not exported). */
export const ROUND_TRIPS_KEY = "opendaw:round-trips";

type StoredEntry = { output: string; input: string; sampleRate: number; seconds: number };

function isEntry(value: unknown): value is StoredEntry {
  if (typeof value !== "object" || value === null) return false;
  const { output, input, sampleRate, seconds } = value as Record<string, unknown>;
  return typeof output === "string" && typeof input === "string" && typeof sampleRate === "number"
    && typeof seconds === "number" && Number.isFinite(seconds);
}

/** Why a run must not go on, naming every stored entry; null when none is stored (or the value is
 *  unreadable, which the SDK reads as none too). */
export function storedRoundTripRefusal(raw: string | null): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "[]");
  } catch {
    return null;
  }
  const entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  if (entries.length === 0) return null;
  const list = entries
    .map((e) => `${(e.seconds * 1000).toFixed(2)} ms for output "${e.output}", input "${e.input}", ${e.sampleRate} Hz`)
    .join("; ");
  return `a measured round trip is stored in this browser (${list}); it replaces the reported ` +
    "latencies on a Tape left on Inherit, as this page's are. Drop it first: capture.forgetRoundTrip() " +
    `where it was measured, or localStorage.removeItem("${ROUND_TRIPS_KEY}") in DevTools`;
}

export function assertNoStoredRoundTrip(storage: Pick<Storage, "getItem"> = localStorage): void {
  const refusal = storedRoundTripRefusal(storage.getItem(ROUND_TRIPS_KEY));
  if (refusal !== null) throw new Error(refusal);
}
