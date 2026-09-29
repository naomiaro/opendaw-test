import { describe, it, expect } from "vitest";
import { UUID } from "@opendaw/lib-std";
import { AudioFileBox, type NanoDeviceBox } from "@opendaw/studio-boxes";
import type { SampleLoader, SampleLoaderManager, SampleLoaderState } from "@opendaw/studio-adapters";
import { referSampleFile, watchSampleLoad } from "./sampleFiles";
import { graphWithSamplers, transact } from "./testing/boxGraphFixtures";

const referredUUID = (sampler: NanoDeviceBox): string | null =>
  sampler.file.targetVertex.match({
    none: () => null,
    some: ({ box }) => UUID.toString(box.address.uuid),
  });

describe("referSampleFile", () => {
  it("creates the file box and refers an empty pointer to it", () => {
    const { boxGraph, samplers: [sampler] } = graphWithSamplers(1);
    const uuid = UUID.generate();

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, uuid, "Pluck", 1.5));

    expect(deleted).toBeNull();
    expect(referredUUID(sampler)).toBe(UUID.toString(uuid));
    const file = boxGraph.findBox<AudioFileBox>(uuid).unwrap();
    expect(file.fileName.getValue()).toBe("Pluck");
    expect(file.endInSeconds.getValue()).toBeCloseTo(1.5, 6);
  });

  it("deletes the previous file box when this pointer was its only reference, and returns its uuid", () => {
    const { boxGraph, samplers: [sampler] } = graphWithSamplers(1);
    const first = UUID.generate();
    const second = UUID.generate();
    transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, first, "First", 1));

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, second, "Second", 2));

    expect(deleted).toBe(UUID.toString(first));
    expect(boxGraph.findBox(first).isEmpty()).toBe(true);
    expect(referredUUID(sampler)).toBe(UUID.toString(second));
  });

  it("keeps the previous file box when something else still refers to it", () => {
    const { boxGraph, samplers: [sampler, other] } = graphWithSamplers(2);
    const shared = UUID.generate();
    const replacement = UUID.generate();
    transact(boxGraph, () => {
      referSampleFile({ boxGraph }, sampler.file, shared, "Shared", 1);
      referSampleFile({ boxGraph }, other.file, shared, "Shared", 1);
    });

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, replacement, "New", 2));

    expect(deleted).toBeNull();
    expect(boxGraph.findBox(shared).nonEmpty()).toBe(true);
    expect(referredUUID(other)).toBe(UUID.toString(shared));
    expect(referredUUID(sampler)).toBe(UUID.toString(replacement));
  });

  it("does nothing when the pointer already refers to that file", () => {
    const { boxGraph, samplers: [sampler] } = graphWithSamplers(1);
    const uuid = UUID.generate();
    transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, uuid, "Pluck", 1.5));

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, uuid, "Pluck", 1.5));

    expect(deleted).toBeNull();
    expect(boxGraph.findBox(uuid).nonEmpty()).toBe(true);
    expect(referredUUID(sampler)).toBe(UUID.toString(uuid));
  });

  it("reuses a file box that already exists under the uuid, leaving its name and length alone", () => {
    const { boxGraph, samplers: [sampler, other] } = graphWithSamplers(2);
    const uuid = UUID.generate();
    transact(boxGraph, () => {
      const existing = AudioFileBox.create(boxGraph, uuid, box => {
        box.fileName.setValue("Original");
        box.endInSeconds.setValue(3);
      });
      other.file.refer(existing);
    });

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, uuid, "Renamed", 9));

    expect(deleted).toBeNull();
    expect(referredUUID(sampler)).toBe(UUID.toString(uuid));
    const file = boxGraph.findBox<AudioFileBox>(uuid).unwrap();
    expect(file.fileName.getValue()).toBe("Original");
    expect(file.endInSeconds.getValue()).toBeCloseTo(3, 6);
  });

  it("returns a sample to a pointer after its file box was deleted by an earlier swap", () => {
    const { boxGraph, samplers: [sampler] } = graphWithSamplers(1);
    const pluck = UUID.generate();
    const pad = UUID.generate();
    transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, pluck, "Pluck", 1.5));
    transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, pad, "Pad", 2));
    expect(boxGraph.findBox(pluck).isEmpty()).toBe(true);

    const deleted = transact(boxGraph, () => referSampleFile({ boxGraph }, sampler.file, pluck, "Pluck", 1.5));

    expect(deleted).toBe(UUID.toString(pad));
    expect(referredUUID(sampler)).toBe(UUID.toString(pluck));
    expect(boxGraph.findBox<AudioFileBox>(pluck).unwrap().fileName.getValue()).toBe("Pluck");
  });
});

// --- A stand-in sample loader. The real one needs workers and a fetch. ---

class FakeLoader {
  state: SampleLoaderState;
  readonly observers = new Set<(state: SampleLoaderState) => void>();
  subscribeCalls = 0;

  constructor(state: SampleLoaderState) {
    this.state = state;
  }

  subscribe(observer: (state: SampleLoaderState) => void): { terminate: () => void } {
    this.subscribeCalls++;
    this.observers.add(observer);
    // Like the SDK's loader: a terminal state is reported at once, during subscribe().
    if (this.state.type === "loaded" || this.state.type === "error") observer(this.state);
    return { terminate: () => this.observers.delete(observer) };
  }

  emit(state: SampleLoaderState): void {
    this.state = state;
    for (const observer of [...this.observers]) observer(state);
  }
}

function projectWith(loader: FakeLoader): { sampleManager: SampleLoaderManager; asked: UUID.Bytes[] } {
  const asked: UUID.Bytes[] = [];
  const sampleManager = {
    getOrCreate: (uuid: UUID.Bytes) => {
      asked.push(uuid);
      return loader as unknown as SampleLoader;
    },
  } as unknown as SampleLoaderManager;
  return { asked, sampleManager };
}

function recorder(): { events: string[]; handlers: { onLoaded: () => void; onError: (reason: string) => void } } {
  const events: string[] = [];
  return {
    events,
    handlers: {
      onLoaded: () => events.push("loaded"),
      onError: (reason: string) => events.push("error: " + reason),
    },
  };
}

describe("watchSampleLoad", () => {
  it("asks the sample manager for the loader of the given uuid", () => {
    const loader = new FakeLoader({ type: "idle" });
    const project = projectWith(loader);
    const uuid = UUID.generate();

    watchSampleLoad(project, uuid, {});

    expect(project.asked.map(UUID.toString)).toEqual([UUID.toString(uuid)]);
  });

  it("reports a sample that is already loaded, once, without subscribing", () => {
    const loader = new FakeLoader({ type: "loaded" });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);

    expect(events).toEqual(["loaded"]);
    expect(loader.subscribeCalls).toBe(0);
  });

  it("reports a sample that has already failed, with its reason, without subscribing", () => {
    const loader = new FakeLoader({ type: "error", reason: "decode failed" });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);

    expect(events).toEqual(["error: decode failed"]);
    expect(loader.subscribeCalls).toBe(0);
  });

  it("reports nothing while the sample is still loading", () => {
    const loader = new FakeLoader({ type: "idle" });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);
    loader.emit({ type: "progress", progress: 0.2 });
    loader.emit({ type: "progress", progress: 0.9 });

    expect(events).toEqual([]);
    expect(loader.observers.size).toBe(1);
  });

  it("reports the load when it finishes, then stops listening", () => {
    const loader = new FakeLoader({ type: "progress", progress: 0.5 });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);
    loader.emit({ type: "loaded" });

    expect(events).toEqual(["loaded"]);
    expect(loader.observers.size).toBe(0);
  });

  it("reports a failure when it happens, then stops listening", () => {
    const loader = new FakeLoader({ type: "idle" });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);
    loader.emit({ type: "error", reason: "network" });

    expect(events).toEqual(["error: network"]);
    expect(loader.observers.size).toBe(0);
  });

  it("reports one outcome only, even if the loader changes state again", () => {
    const loader = new FakeLoader({ type: "idle" });
    const { events, handlers } = recorder();

    watchSampleLoad(projectWith(loader), UUID.generate(), handlers);
    loader.emit({ type: "loaded" });
    loader.emit({ type: "error", reason: "late" });
    loader.emit({ type: "loaded" });

    expect(events).toEqual(["loaded"]);
  });

  it("reports nothing after the watch is terminated, and stops listening", () => {
    const loader = new FakeLoader({ type: "idle" });
    const { events, handlers } = recorder();

    const watch = watchSampleLoad(projectWith(loader), UUID.generate(), handlers);
    watch.terminate();
    loader.emit({ type: "loaded" });

    expect(events).toEqual([]);
    expect(loader.observers.size).toBe(0);
  });

  it("can be terminated after it has already reported", () => {
    const loader = new FakeLoader({ type: "loaded" });
    const { handlers } = recorder();

    const watch = watchSampleLoad(projectWith(loader), UUID.generate(), handlers);

    expect(() => watch.terminate()).not.toThrow();
  });

  it.each<[string, SampleLoaderState]>([
    ["loaded", { type: "loaded" }],
    ["failed", { type: "error", reason: "x" }],
  ])("accepts a watcher with no handlers when the sample has %s", (_label, state) => {
    const pending = new FakeLoader({ type: "idle" });
    expect(() => watchSampleLoad(projectWith(new FakeLoader(state)), UUID.generate(), {})).not.toThrow();
    watchSampleLoad(projectWith(pending), UUID.generate(), {});
    expect(() => pending.emit(state)).not.toThrow();
  });
});
