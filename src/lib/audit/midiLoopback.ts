/**
 * The MIDI audits' loopback (input alignment, combined, output timing): a virtual MIDI bus
 * (the macOS IAC Driver) whose output the page sends on and whose input the SDK's capture,
 * the SDK's MIDI Output instrument's receipts, and the page's own listener come back on.
 * Every note is scheduled ahead with `MIDIOutput.send(data, timestamp)`, so CoreMIDI
 * delivers it on time whatever the main thread is doing; the page's receipt stamps are
 * what the SDK's capture sees too.
 */
import { MidiData } from "@opendaw/lib-midi";
import { classifyMidiStatus } from "./midiOutputParams";

export interface PortLike {
  id: string;
  name: string | null;
}

export interface PickedPorts {
  inputId: string;
  outputId: string;
  name: string;
}

const SETUP_STEP = "enable the IAC Driver in Audio MIDI Setup (Window → Show MIDI Studio → IAC Driver → tick 'Device is online')";

/** One input and one output sharing a name that contains `substring` (case-insensitive). */
export function pickIacPorts(
  inputs: readonly PortLike[],
  outputs: readonly PortLike[],
  substring: string,
): PickedPorts | { error: string } {
  const needle = substring.toLowerCase();
  const matches = (port: PortLike): boolean => (port.name ?? "").toLowerCase().includes(needle);
  const pairs: PickedPorts[] = [];
  for (const input of inputs.filter(matches)) {
    for (const output of outputs.filter(matches)) {
      if (input.name !== null && input.name === output.name) pairs.push({ inputId: input.id, outputId: output.id, name: input.name });
    }
  }
  if (pairs.length === 1) return pairs[0];
  if (pairs.length === 0) {
    const seen = [...inputs, ...outputs].map((p) => p.name ?? "(unnamed)").join(", ") || "none";
    return { error: `no MIDI input/output pair named "*${substring}*" (ports seen: ${seen}) — ${SETUP_STEP}` };
  }
  return { error: `several MIDI buses match "*${substring}*": ${pairs.map((p) => p.name).join(", ")} — pick one with ?bus=<name>` };
}

export interface ScheduledNote {
  pitch: number;
  velocity: number;
  onPerfMs: number;
  offPerfMs: number;
}

export interface Receipt {
  kind: "on" | "off";
  pitch: number;
  velocity: number;
  timeStamp: number;
}

/** A receipt belongs to a note when it lies within this much of the note's scheduled time (the output audit widens it by the delay and the jank). */
export const RECEIPT_WINDOW_MS = 50;

/** Per scheduled note, in order: the earliest unused on-receipt of its pitch within `windowMs` of its time, then the earliest unused off after it within the window of its release. */
export function pairReceipts(
  scheduled: readonly ScheduledNote[],
  receipts: readonly Receipt[],
  windowMs: number = RECEIPT_WINDOW_MS,
): Array<{ onPerfMs: number | null; offPerfMs: number | null }> {
  return pairReceiptObjects(scheduled, receipts, windowMs).map(({ on, off }) => ({ onPerfMs: on?.timeStamp ?? null, offPerfMs: off?.timeStamp ?? null }));
}

/** The same pairing, returning the receipt OBJECTS, so a caller can tell a paired receipt from an identical duplicate. */
export function pairReceiptObjects(
  scheduled: readonly ScheduledNote[],
  receipts: readonly Receipt[],
  windowMs: number = RECEIPT_WINDOW_MS,
): Array<{ on: Receipt | null; off: Receipt | null }> {
  const sorted = [...receipts].sort((a, b) => a.timeStamp - b.timeStamp);
  const used = new Set<Receipt>();
  const take = (kind: Receipt["kind"], pitch: number, notBefore: number, notAfter: number): Receipt | null => {
    for (const receipt of sorted) {
      if (used.has(receipt) || receipt.kind !== kind || receipt.pitch !== pitch) continue;
      if (receipt.timeStamp < notBefore || receipt.timeStamp > notAfter) continue;
      used.add(receipt);
      return receipt;
    }
    return null;
  };
  return scheduled.map((note) => {
    const on = take("on", note.pitch, note.onPerfMs - windowMs, note.onPerfMs + windowMs);
    const off = on === null ? null : take("off", note.pitch, on.timeStamp, note.offPerfMs + windowMs);
    return { on, off };
  });
}

/** The first on-receipt of a pitch at or after `notBefore`, or null: how an unscheduled (count-in) note finds its receipt. */
export function firstReceiptFor(receipts: readonly Receipt[], pitch: number, notBefore: number): Receipt | null {
  return [...receipts]
    .sort((a, b) => a.timeStamp - b.timeStamp)
    .find((r) => r.kind === "on" && r.pitch === pitch && r.timeStamp >= notBefore) ?? null;
}

const ALL_NOTES_OFF = 123;

/** Raw bytes to a receipt (a note-on at velocity 0 is a release), the mark `"transport"` for Clock / Start / Stop / SongPosition, or null. */
export function receiptFrom(data: Uint8Array, timeStamp: number): Receipt | "transport" | null {
  if (data.length === 0) return null;
  if (MidiData.isNoteOn(data)) return { kind: "on", pitch: MidiData.readPitch(data), velocity: MidiData.readParam2(data), timeStamp };
  if (MidiData.isNoteOff(data)) return { kind: "off", pitch: MidiData.readPitch(data), velocity: 0, timeStamp };
  if (classifyMidiStatus(data[0]) === "transport") return "transport";
  return null;
}

export class MidiLoopbackSender {
  readonly #output: MIDIOutput;
  readonly #input: MIDIInput;
  readonly #channel: number;
  #receipts: Receipt[] = [];
  #transportCount = 0;

  constructor(output: MIDIOutput, input: MIDIInput, channel: number = 0) {
    this.#output = output;
    this.#input = input;
    this.#channel = channel;
    this.#input.onmidimessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (data === null) return;
      const receipt = receiptFrom(data, event.timeStamp);
      if (receipt === "transport") this.#transportCount++;
      else if (receipt !== null) this.#receipts.push(receipt);
    };
  }

  /** Clock / Start / Stop / SongPosition messages seen since the last `clear()`: counted, never paired. */
  transportCount(): number {
    return this.#transportCount;
  }

  schedule(notes: readonly ScheduledNote[]): void {
    for (const note of notes) {
      this.#output.send(MidiData.noteOn(this.#channel, note.pitch, note.velocity), note.onPerfMs);
      this.#output.send(MidiData.noteOff(this.#channel, note.pitch), note.offPerfMs);
    }
  }

  /** An unscheduled note, stamped by the bus at whatever time it goes out (count-in notes). */
  sendNow(note: Omit<ScheduledNote, "onPerfMs" | "offPerfMs">, holdMs: number): void {
    const now = performance.now();
    this.#output.send(MidiData.noteOn(this.#channel, note.pitch, note.velocity), now);
    this.#output.send(MidiData.noteOff(this.#channel, note.pitch), now + holdMs);
  }

  receipts(): readonly Receipt[] {
    return this.#receipts;
  }

  /** Drops what is still scheduled where the browser allows, releases every note, forgets the receipts. */
  clear(): void {
    if ("clear" in this.#output && typeof this.#output.clear === "function") this.#output.clear();
    this.#output.send(MidiData.control(this.#channel, ALL_NOTES_OFF, 0));
    this.#receipts = [];
    this.#transportCount = 0;
  }

  terminate(): void {
    this.#input.onmidimessage = null;
  }
}
