// Final assembly: clip launcher on top, arrangement timeline below. Boots a
// jam session (4 Dark Ride stems, 3 launcher clips each), lets clips play
// freely while parked past any arrangement content, and turns whatever's
// playing into timeline regions on Commit.
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { Project } from "@opendaw/studio-core";
import { AudioRegionBox, ValueEventCollectionBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { getAllAudioRegions } from "@/lib/adapterUtils";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
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
    if (project === null) return;
    const sync = () => setRegionCount(getAllAudioRegions(project).length);
    sync();
    const sub = project.editing.subscribe(sync);
    return () => sub.terminate();
  }, [project]);

  const enterJam = useCallback(() => {
    if (project === null) return;
    if (mode !== "jam") {
      project.engine.setPosition(JAM_PARK_POSITION);
      setMode("jam");
    }
  }, [project, mode]);

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
    project.engine.stop(); // resets the clip sequencer — all clips stop
    project.engine.setPosition(0);
    project.engine.play(); // facade resumes the AudioContext
    setMode("arrangement");
  }, [project]);

  const stopTransport = useCallback(() => {
    if (project === null) return;
    project.engine.stop();
    setMode("idle");
  }, [project]);

  const clearArrangement = useCallback(() => {
    if (project === null) return;
    if (mode === "arrangement") project.engine.stop();
    project.editing.modify(() => {
      getAllAudioRegions(project).forEach(r => r.box.delete());
    });
    setLastCommit(null);
    setMode("idle");
  }, [project, mode]);

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
              to. Launching one arms it for the next bar (quantized, so every clip you fire
              lands in time with the others already running), and once it starts it loops
              forever until you stop it or launch a different clip on the same track — the
              new one takes over instantly, so a track ever plays at most one clip.
            </p>
            <p className="mc-intro">
              A region is the opposite: fixed to a timeline position, playing back exactly
              once, in order — linear. <strong>Commit</strong> below turns whatever clips are
              currently playing into regions parked at the next open 4-bar section, so
              jamming and arranging can interleave freely. It's the same move the full
              OpenDAW studio offers from a clip's context menu as{" "}
              <code>Convert to Region</code> — Commit just applies it to every playing clip
              at once.
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
                  {" "}&middot;{" "}
                  Drum stems from Dark Ride&rsquo;s &lsquo;Deny Control&rsquo; via{" "}
                  <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer">cambridge-mt.com</a>
                </p>
              </section>
            </>
          )}
        </Flex>
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
