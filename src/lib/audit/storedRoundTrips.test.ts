import { describe, expect, it } from "vitest";
import { assertNoStoredRoundTrip, ROUND_TRIPS_KEY, storedRoundTripRefusal } from "./storedRoundTrips";

const entry = {
  output: "Default - MacBook Pro Speakers (Built-in)", input: "MediaStreamAudioDestinationNode",
  sampleRate: 48000, seconds: 0.05, measuredAt: 0,
};
const storageWith = (value: string | null) => ({ getItem: (key: string) => (key === ROUND_TRIPS_KEY ? value : null) });

describe("storedRoundTripRefusal", () => {
  it("lets a run go on when nothing usable is stored", () => {
    expect(storedRoundTripRefusal(null)).toBeNull();
    expect(storedRoundTripRefusal("[]")).toBeNull();
    expect(storedRoundTripRefusal("not json")).toBeNull();
    expect(storedRoundTripRefusal(JSON.stringify([{ output: "x" }]))).toBeNull();
    expect(() => assertNoStoredRoundTrip(storageWith(null))).not.toThrow();
  });

  it("refuses on any stored entry, naming its figure and its devices", () => {
    const refusal = storedRoundTripRefusal(JSON.stringify([entry]));
    expect(refusal).toContain('50.00 ms for output "Default - MacBook Pro Speakers (Built-in)", input "MediaStreamAudioDestinationNode", 48000 Hz');
    expect(refusal).toContain(`localStorage.removeItem("${ROUND_TRIPS_KEY}")`);
    expect(() => assertNoStoredRoundTrip(storageWith(JSON.stringify([entry])))).toThrow(/forgetRoundTrip/);
  });
});
