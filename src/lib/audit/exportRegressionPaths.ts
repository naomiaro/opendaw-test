/**
 * One render of a row through its SDK export path, on a copy of its own. What differs between the paths is what the
 * harness tests, so each goes through the SDK's own calls, never a helper of this repo that stands in for them. The stems
 * step the renderer for an exact range instead of the `start` or `renderSection` the studio's stem dialog calls, since
 * `stems-sum-to-mix` needs the mix's frames; the bounce runs `AudioBounce.bounce`'s exported pieces.
 *
 * The step paths use the order `src/demos/export/CLAUDE.md` documents (setPosition, play, waitForLoading, step).
 * `renderSection` and the bounce wait for loading once more before the setPosition. The worker renders nothing before
 * the first step and a step awaits every pending resource, so that wait is inert today; the bounce mirrors it, the step
 * paths do not, and a difference would surface as a finding between them.
 */
import { DefaultObservableValue, Option, UUID } from "@opendaw/lib-std";
import { PPQN, type AudioData } from "@opendaw/lib-dsp";
import { AudioBounce, MixdownSection, OfflineEngineRenderer, type Project } from "@opendaw/studio-core";
import { RegionEditing, type ExportConfiguration } from "@opendaw/studio-adapters";
import { getAllAudioRegions } from "@/lib/adapterUtils";
import { withDeadline } from "@/lib/deadline";
import { applyRow, type HarnessProject } from "./exportRegressionProject";
import { LOOP_ON_COPY_SECONDS, SET_POSITION_SECONDS, setPositionStart, type ExportRow, type PathId } from "./exportRegressionRows";
import { CHUNK_FRAMES } from "./sectionRenderGap";

export const RENDER_DEADLINE_MS = 60_000;

const ODD_CHUNK_FRAMES = 1000;

type Render = {
  copy: Project;
  harness: HarnessProject;
  row: ExportRow;
  pageRate: number;
  /** Aborts when the row is over, however it ended: this is what releases the renderers. */
  finished: AbortSignal;
};

type SectionPathId = Extract<PathId, `section-${string}`>;
type StemsPathId = Extract<PathId, `stems-${string}`>;
type BouncePathId = Extract<PathId, `bounce-${string}`>;

export const chunkSizes = (totalFrames: number, chunk: number): number[] => {
  if (!Number.isInteger(totalFrames) || totalFrames < 0) throw new Error(`${totalFrames} is not a count of frames`);
  if (!Number.isInteger(chunk) || chunk <= 0) throw new Error(`a chunk of ${chunk} never covers a total`);
  const sizes: number[] = [];
  for (let left = totalFrames; left > 0; left -= chunk) sizes.push(Math.min(left, chunk));
  return sizes;
};

const ppqnAt = (seconds: number, bpm: number): number => Math.round(PPQN.secondsToPulses(seconds, bpm));

/** Cleanup must not mask the row's own error or skip the cleanup after it. */
const attempt = (label: string, action: () => void): void => {
  try {
    action();
  } catch (cause) {
    console.error(`${label} failed: ${String(cause)}`);
  }
};

/** `create` is given the signal, so a deadline during it takes the worker down; one that lands just after it does here. */
const openRenderer = async (
  { copy, pageRate, finished }: Render, config: Option<ExportConfiguration>,
): Promise<OfflineEngineRenderer> => {
  const renderer = await OfflineEngineRenderer.create(copy, config, pageRate, finished);
  const close = (): void => {
    attempt("renderer.stop()", () => renderer.stop());
    attempt("renderer.terminate()", () => renderer.terminate());
  };
  if (finished.aborted) close();
  else finished.addEventListener("abort", close, { once: true });
  return renderer;
};

const startTransport = async (renderer: OfflineEngineRenderer, position: number): Promise<void> => {
  renderer.setPosition(position);
  await renderer.play();
  await renderer.waitForLoading();
};

const joinChunks = (chunks: readonly Float32Array[][]): Float32Array[] => {
  const [first] = chunks;
  if (first === undefined) return [];
  return first.map((_, channel) => {
    const joined = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk[channel].length, 0));
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk[channel], at);
      at += chunk[channel].length;
    }
    return joined;
  });
};

const renderSteps = async (
  render: Render, config: Option<ExportConfiguration>, position: number, sizes: readonly number[],
): Promise<Float32Array[]> => {
  const renderer = await openRenderer(render, config);
  await startTransport(renderer, position);
  const chunks: Float32Array[][] = [];
  for (const size of sizes) chunks.push(await renderer.step(size));
  return joinChunks(chunks);
};

const renderReset = async (render: Render, frames: number): Promise<Float32Array[]> => {
  const renderer = await openRenderer(render, Option.None);
  await startTransport(renderer, 0);
  await renderer.step(frames);
  renderer.stop();
  await startTransport(renderer, 0);
  return renderer.step(frames);
};

/** AudioData sits on a SharedArrayBuffer and a step's channels do not: every path hands back the same kind of memory. */
const ownedChannels = ({ frames }: AudioData): Float32Array[] => frames.map((frame) => frame.slice());

const writeLoopArea = ({ copy }: Render, from: number, to: number): void => {
  const { loopArea } = copy.timelineBox;
  copy.editing.modify(() => {
    loopArea.from.setValue(from);
    loopArea.to.setValue(to);
    loopArea.enabled.setValue(true);
  });
};

const SECTIONS: Record<SectionPathId, Pick<MixdownSection, "type" | "passes">> = {
  "section-entire": { type: "song", passes: 1 },
  "section-loop-once": { type: "loop", passes: 1 },
  "section-loop-twice": { type: "loop", passes: 2 },
  "section-marker": { type: "marker", passes: 1 },
  "section-marker-last": { type: "marker", passes: 1 },
};

const renderSectionPath = async (render: Render, path: SectionPathId): Promise<Float32Array[]> => {
  const { copy, row, pageRate, finished } = render;
  const start = ppqnAt(row.rangeStartSeconds, row.bpm);
  const { type, passes } = SECTIONS[path];
  if (type === "loop") writeLoopArea(render, start, ppqnAt(row.rangeStartSeconds + row.rangeSeconds, row.bpm));
  const sections = MixdownSection.collect(copy);
  const section = sections.find((candidate) =>
    candidate.type === type && candidate.passes === passes && (type !== "marker" || candidate.start === start));
  if (section === undefined) {
    const found = sections.map((candidate) => `${candidate.type}/${candidate.passes} at ${candidate.start}`).join(", ");
    throw new Error(`${row.id}: no ${type} section of ${passes} pass(es) at ${start}; collect returned ${found}`);
  }
  // The deadline has only this to take a section's worker down with: the renderer stays inside the SDK.
  const audio = await OfflineEngineRenderer.renderSection(
    copy, Option.None, section, new DefaultObservableValue(0), finished, pageRate,
  );
  return ownedChannels(audio);
};

/** The source's stem comes first and object keys keep their insertion order, so channels 0 and 1 are the source. */
const stemsConfiguration = ({ harness: { units } }: Render, path: StemsPathId): ExportConfiguration => {
  const options = {
    includeAudioEffects: path !== "stems-dry",
    includeSends: path === "stems-sends",
    useInstrumentOutput: false,
  };
  return {
    stems: {
      [UUID.toString(units.source.address.uuid)]: { ...options, fileName: "Source" },
      [UUID.toString(units.bed.address.uuid)]: { ...options, fileName: "Bed" },
    },
    ...(path === "stems-metronome" ? { metronome: { stem: { fileName: "Metronome" } } } : {}),
  };
};

const BOUNCES: Record<BouncePathId, Partial<AudioBounce.Options>> = {
  "bounce-pre-fx": { tap: "pre-fx" },
  "bounce-pre-fader": { tap: "pre-fader" },
  "bounce-post-fader": { tap: "post-fader" },
  "bounce-merge": { merge: true },
  "bounce-loop": { loop: true },
  "bounce-tail": { tail: true },
};

/** The second region of a merge; `true` consolidates as the studio's cut does unless shift is held. */
const cutSourceRegion = ({ copy, row }: Render): void => {
  const regions = getAllAudioRegions(copy);
  const [region] = regions;
  if (regions.length !== 1) throw new Error(`${row.id}: ${regions.length} regions to cut, one expected`);
  const second = copy.editing
    .modify(() => RegionEditing.cut(region, ppqnAt(row.seconds / 2, row.bpm), true))
    .unwrap(`${row.id}: the cut's transaction returned nothing`);
  if (second.isEmpty()) throw new Error(`${row.id}: the cut left one region`);
};

/** `AudioBounce.bounce` returns nothing and edits the project, so its exported pieces run here in its order. */
const renderBounce = async (render: Render, path: BouncePathId): Promise<Float32Array[]> => {
  const { copy, row, pageRate } = render;
  const options = { ...AudioBounce.DefaultOptions, ...BOUNCES[path] };
  if (options.merge) cutSourceRegion(render);
  const jobs = AudioBounce.collectJobs(getAllAudioRegions(copy), options.merge, options.loop);
  const [job] = jobs;
  if (jobs.length !== 1) throw new Error(`${row.id}: ${jobs.length} bounce jobs, one expected`);
  if (options.merge && job.regions.length !== 2) {
    throw new Error(`${row.id}: the merge job holds ${job.regions.length} regions, two expected`);
  }
  AudioBounce.prepareCopy(copy, job);
  const span = AudioBounce.renderSpan(copy, job, options.tail, pageRate);
  const renderer = await openRenderer(render, Option.wrap(AudioBounce.exportConfiguration(job, options.tap)));
  await renderer.waitForLoading();
  await startTransport(renderer, job.start);
  const audio = await AudioBounce.renderFrames((count) => renderer.step(count), span, pageRate);
  return ownedChannels(audio);
};

/** The position comes from the rule the row's own range was computed with: the two may not drift apart. */
const setPositionPpqn = ({ row, pageRate }: Render, onQuantum: boolean): number => {
  const { ppqn } = setPositionStart(SET_POSITION_SECONDS, row.bpm, pageRate, onQuantum);
  const seconds = PPQN.pulsesToSeconds(ppqn, row.bpm);
  if (Math.abs(seconds - row.rangeStartSeconds) > 1e-9) {
    throw new Error(`${row.id}: the row starts at ${row.rangeStartSeconds} s, ppqn ${ppqn} is at ${seconds} s`);
  }
  return ppqn;
};

const renderRow = async (render: Render): Promise<Float32Array[]> => {
  const { copy, harness, row, pageRate, finished } = render;
  await applyRow(copy, harness, row);
  const frames = Math.round(row.rangeSeconds * pageRate);
  const { path } = row;
  switch (path) {
    case "step-one":
      return renderSteps(render, Option.None, 0, [frames]);
    case "step-chunked-whole":
      return renderSteps(render, Option.None, 0, chunkSizes(frames, CHUNK_FRAMES));
    case "step-chunked-odd":
      return renderSteps(render, Option.None, 0, chunkSizes(frames, ODD_CHUNK_FRAMES));
    case "step-reset":
      return renderReset(render, frames);
    case "start": {
      // The signal, not `undefined`: without it nothing could take this path's worker down on a deadline.
      const audio = await OfflineEngineRenderer.start(copy, Option.None, new DefaultObservableValue(0), finished, pageRate);
      return ownedChannels(audio);
    }
    case "section-entire":
    case "section-loop-once":
    case "section-loop-twice":
    case "section-marker":
    case "section-marker-last":
      return renderSectionPath(render, path);
    case "stems-fx":
    case "stems-dry":
    case "stems-sends":
    case "stems-metronome":
      return renderSteps(render, Option.wrap(stemsConfiguration(render, path)), 0, [frames]);
    case "bounce-pre-fx":
    case "bounce-pre-fader":
    case "bounce-post-fader":
    case "bounce-merge":
    case "bounce-loop":
    case "bounce-tail":
      return renderBounce(render, path);
    case "setposition-on-quantum":
    case "setposition-off-quantum":
      return renderSteps(render, Option.None, setPositionPpqn(render, path === "setposition-on-quantum"), [frames]);
    case "loop-on-copy":
      writeLoopArea(render, 0, ppqnAt(LOOP_ON_COPY_SECONDS, row.bpm));
      return renderSteps(render, Option.None, 0, [frames]);
  }
};

/** Empty output from a wedged worker must not reach a verdict as a render. A short one does: that is the verdict's to read. */
const assertRendered = (row: ExportRow, channels: readonly Float32Array[]): void => {
  if (channels.length === 0) throw new Error(`${row.id}: the render returned no channels`);
  const empty = channels.findIndex((channel) => channel.length === 0);
  if (empty !== -1) throw new Error(`${row.id}: channel ${empty} of ${channels.length} has 0 frames`);
};

/** A failed or wedged row must not wedge the next: everything it opened closes here, whatever became of the render. */
export const renderPath = async (harness: HarnessProject, row: ExportRow, pageRate: number): Promise<Float32Array[]> => {
  const copy = harness.project.copy();
  const finished = new AbortController();
  try {
    const channels = await withDeadline(
      renderRow({ copy, harness, row, pageRate, finished: finished.signal }),
      RENDER_DEADLINE_MS,
      `${row.id}: ${row.path}`,
    );
    assertRendered(row, channels);
    return channels;
  } finally {
    finished.abort();
    attempt("copy.terminate()", () => copy.terminate());
  }
};
