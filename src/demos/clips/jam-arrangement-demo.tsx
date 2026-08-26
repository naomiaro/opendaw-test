// Final assembly: clip launcher on top, arrangement timeline below. Boots a
// jam session (4 Dark Ride stems, 3 launcher clips each), lets clips play
// freely while parked past any arrangement content, and turns whatever's
// playing into timeline regions on Commit.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllAudioRegions } from "@/lib/adapterUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { AudioAttribution } from "@/components/AudioAttribution";
import { BackLink } from "@/components/BackLink";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { BPM, SECTION_BARS, SECTION_PPQN, JAM_PARK_POSITION, nextFreeSectionStart } from "./arrangement";
import { createJamSession, type JamTrack } from "./jamSetup";
import { useClipStates } from "./useClipStates";
import { ClipGrid, CLIP_GRID_STYLES } from "./ClipGrid";
import { ArrangementPanel } from "./ArrangementPanel";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Text, Flex, Card, Callout, Badge, Button } from "@radix-ui/themes";

type Mode = "idle" | "jam" | "arrangement";
type LastCommit = { section: number; bars: string };

const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tracks, setTracks] = useState<JamTrack[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [lastCommit, setLastCommit] = useState<LastCommit | null>(null);
  const [regionCount, setRegionCount] = useState(0);

  const clipStates = useClipStates(project);
  // Set on every launch, consumed by the jam-idle effect below — guards the
  // one render where mode has flipped to "jam" but the launch's "waiting"
  // notification hasn't landed in clipStates yet (see enterJam / that effect).
  const launchingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    let localProject: Project | null = null;
    let localAudioContext: AudioContext | null = null;

    (async () => {
      try {
        const buffers = new Map<string, AudioBuffer>();
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers: buffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });
        localProject = newProject;
        localAudioContext = newAudioContext;
        if (!mounted) return;

        setStatus("Loading stems...");
        const jamTracks = await createJamSession(newProject, newAudioContext, buffers);
        if (!mounted) return;

        setProject(newProject);
        setTracks(jamTracks);
        setStatus("Ready");
      } catch (error) {
        console.error(
          "Init error: " + String(error) +
          (error instanceof Error && error.stack ? "\n" + error.stack : ""),
        );
        if (mounted) setInitError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      mounted = false;
      if (localProject) localProject.engine.stop(true);
      if (localAudioContext && localAudioContext.state !== "closed") {
        localAudioContext.close();
      }
    };
  }, []);

  // Region count is a structural fact of the box graph — resync from an
  // editing subscription rather than polling every frame.
  useEffect(() => {
    if (project === null) return undefined;
    const sync = () => setRegionCount(getAllAudioRegions(project).length);
    sync();
    const sub = project.editing.subscribe(sync);
    return () => sub.terminate();
  }, [project]);

  // Only parks the transport when coming from a cold stop. Launching a clip while
  // the arrangement is already playing must NOT reset position — that would kill
  // linear playback on every other track, not just take over the clicked track's.
  const enterJam = useCallback(() => {
    if (project === null) return;
    launchingRef.current = true;
    if (mode === "idle") {
      project.engine.setPosition(JAM_PARK_POSITION);
      setMode("jam");
    }
  }, [project, mode]);

  // Auto-return to idle once jamming fully drains, covering both the "Stop
  // clips" button and a clip naturally reaching a non-looping end. Counts
  // BOTH "waiting" and "playing" as active: a clip armed for the next bar
  // hasn't reached "playing" yet, but the jam is still very much live —
  // checking "playing" alone would stop the transport during that arm
  // window. Clip stops are quantized, so clipStates only empties once the
  // musical stop actually completes — this effect firing then is correct,
  // not a race.
  useEffect(() => {
    if (project === null || mode !== "jam") return;
    const hasActiveClip = tracks.some(track =>
      track.clips.some(clip => clipStates.get(clip.uuidString) !== undefined),
    );
    if (hasActiveClip) {
      // A real active clip clears the guard — it must only ever suppress the
      // one transient render right after a launch, never a later genuine
      // drain (a stale `true` left over from an earlier launch would
      // otherwise swallow this jam's actual stop-all transition).
      launchingRef.current = false;
      return;
    }
    if (launchingRef.current) {
      // enterJam() and the launch's "waiting" notification land in the same
      // click handler and batch into one render, so this shouldn't actually
      // fire empty — skip once as a safety net rather than stopping a
      // transport that's about to have a clip on it.
      launchingRef.current = false;
      return;
    }
    project.engine.stop(true);
    setMode("idle");
  }, [project, mode, tracks, clipStates]);

  const commit = useCallback(() => {
    if (project === null) return;
    const active = tracks.flatMap(track => {
      const clip = track.clips.find(c => clipStates.get(c.uuidString) === "playing");
      return clip ? [{ track, clip }] : [];
    });
    if (active.length === 0) return;

    const regionEnds = getAllAudioRegions(project).map(r => r.complete);
    const start = nextFreeSectionStart(regionEnds);
    project.editing.modify(() => {
      active.forEach(({ track, clip }) => {
        const eventsBox = ValueEventCollectionBox.create(project.boxGraph, UUID.generate());
        AudioRegionBox.create(project.boxGraph, UUID.generate(), box => {
          box.regions.refer(track.trackBox.regions);
          box.file.refer(track.fileBox);
          box.events.refer(eventsBox.owners);
          box.position.setValue(start);            // section boundary — already integer
          box.duration.setValue(SECTION_PPQN);      // region spans the 4-bar section
          box.loopOffset.setValue(0);
          box.loopDuration.setValue(clip.bars * PPQN.Bar); // loops tile the section
          box.waveformOffset.setValue(track.contentStartSeconds); // skip lead-in, matches the clip
          box.label.setValue(`${track.name} · ${clip.bars} bar`);
          box.mute.setValue(false);
        });
      });
    });
    setLastCommit({
      section: start / SECTION_PPQN + 1,
      bars: `${start / PPQN.Bar + 1}–${start / PPQN.Bar + SECTION_BARS}`,
    });
  }, [project, tracks, clipStates]);

  const playArrangement = useCallback(() => {
    if (project === null) return;
    // reset=true — a bare stop() is pause-only while transporting and leaves
    // the clip sequencer's "playing" state intact, so launched clips would
    // resume and keep owning their tracks instead of the committed regions.
    project.engine.stop(true); // resets the clip sequencer — all clips stop
    project.engine.setPosition(0);
    project.engine.play(); // facade resumes the AudioContext
    setMode("arrangement");
  }, [project]);

  const stopTransport = useCallback(() => {
    if (project === null) return;
    project.engine.stop(true);
    setMode("idle");
  }, [project]);

  const clearArrangement = useCallback(() => {
    if (project === null) return;
    if (mode === "arrangement") project.engine.stop(true);
    project.editing.modify(() => {
      getAllAudioRegions(project).forEach(r => r.box.delete());
    });
    setLastCommit(null);
    // Recompute fresh (not the outer hasPlayingClip, which callbacks below
    // this one haven't captured yet) — clearing during a jam must keep mode
    // "jam" so a later launch doesn't re-trigger enterJam's idle-only park.
    const stillJamming = tracks.some(track =>
      track.clips.some(clip => clipStates.get(clip.uuidString) === "playing"),
    );
    setMode(stillJamming ? "jam" : "idle");
  }, [project, mode, tracks, clipStates]);

  const hasPlayingClip = tracks.some(track =>
    track.clips.some(clip => clipStates.get(clip.uuidString) === "playing"),
  );
  const isReady = status === "Ready" && project !== null;

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{CLIP_GRID_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 980, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Clips — Jam to Arrangement · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              JAM &rarr; ARRANGEMENT
            </h1>
            <p className="mc-intro">
              A clip has no timeline position — only a loop length and a track it belongs
              to. Launching one quantizes it in: to the next bar if the track's idle, or to
              the loop grid of whatever clip is already playing there if it's not — so every
              clip you fire lands in time with the others already running. Once it starts it
              loops forever until you stop it or launch a different clip on the same track —
              the new one takes over instantly, so a track only ever plays one clip at a time.
            </p>
            <p className="mc-intro">
              A region is the opposite: fixed to a timeline position, playing back exactly
              once, in order — linear. <strong>Commit</strong> below turns whatever clips are
              currently playing into regions parked at the next open 4-bar section, so
              jamming and arranging can interleave freely. It's the same idea as the full
              OpenDAW studio's clip context-menu action{" "}
              <code>Convert to Region</code>, applied to every playing clip at once — though
              the studio appends each region after that track's last one, while Commit parks
              them all together at one shared next-free section.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !isReady ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Clip launcher</Text>
                  <ClipGrid project={project} tracks={tracks} clipStates={clipStates} onLaunch={enterJam} />
                  <Text size="1" color="gray">
                    A blinking border means the clip is scheduled and waiting for the next bar.
                    Launching a clip on a track that already has one playing hands over at the
                    boundary — the old clip stops the instant the new one starts.
                  </Text>
                </Flex>
              </Card>

              <Card>
                <Flex align="center" gap="3" wrap="wrap">
                  <Button size="3" onClick={commit} disabled={!hasPlayingClip}>
                    Commit combo to arrangement
                  </Button>
                  <Text size="2" color="gray">
                    {lastCommit
                      ? `Section ${lastCommit.section} committed (bars ${lastCommit.bars})`
                      : "Nothing committed yet"}
                  </Text>
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="3">
                  <Flex align="center" justify="between">
                    <Text size="2" weight="bold" color="gray">Arrangement</Text>
                    <Badge color={mode === "arrangement" ? "green" : mode === "jam" ? "amber" : "gray"}>
                      {mode}
                    </Badge>
                  </Flex>
                  <ArrangementPanel project={project} tracks={tracks} />
                  <Flex gap="3" align="center" wrap="wrap">
                    <Button size="3" onClick={playArrangement} disabled={regionCount === 0}>
                      Play arrangement
                    </Button>
                    <Button size="3" variant="outline" onClick={stopTransport}>Stop</Button>
                    <Button size="3" color="red" variant="outline" onClick={clearArrangement}>
                      Clear arrangement
                    </Button>
                  </Flex>
                </Flex>
              </Card>

              <section className="mc-anchors">
                <h2 className="mc-anchors-head">Reading the grid</h2>
                <p>
                  <strong>The takeover rule:</strong> while a clip plays on a track, that
                  track's timeline regions go silent — the clip owns the track's output until
                  it's stopped or replaced. Other tracks are unaffected; a clip playing on
                  Drums has no bearing on Bass, Guitars, or Vox.
                </p>
                <p>
                  <strong>Scene columns:</strong> the three buttons across the top of the grid
                  launch a whole column at once — one clip per track, same bar length — a fast
                  way to jam a full combo without clicking every cell.
                </p>
                <p>
                  <strong>Launching starts the transport:</strong> scheduling a clip resumes
                  the AudioContext and starts the engine if it isn't already running. There's
                  no separate Play button for jamming — only <code>Stop clips</code>.
                </p>
                <p>
                  <a href="/docs/09-editing-fades-and-automation.html">Editing, fades &amp; automation</a>
                  {" "}&middot;{" "}
                  <a href="/docs/04-box-system-and-reactivity.html">Box system &amp; reactivity</a>
                </p>
              </section>
            </>
          )}
        </Flex>
        <AudioAttribution stems="Drum" />
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
