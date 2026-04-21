import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "@opendaw/studio-core";
import { AudioUnitBox } from "@opendaw/studio-boxes";
import { Colors } from "@opendaw/studio-enums";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { TransportControls } from "@/components/TransportControls";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadTracksWithGroups, type GroupData } from "@/lib/groupTrackLoading";
import { getAudioExtension } from "@/lib/audioUtils";
import { usePlaybackPosition } from "@/hooks/usePlaybackPosition";
import { useTransportControls } from "@/hooks/useTransportControls";
import type { TrackData } from "@/lib/types";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Button,
  Callout,
  Badge,
  Slider,
  Separator,
  Code,
} from "@radix-ui/themes";
import { InfoCircledIcon } from "@radix-ui/react-icons";

const BPM = 124;

// ---------------------------------------------------------------------------
// TrackStrip: volume / mute / solo for a single track
// ---------------------------------------------------------------------------
const TrackStrip: React.FC<{
  track: TrackData;
  project: Project;
}> = ({ track, project }) => {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soloed, setSoloed] = useState(false);

  useEffect(() => {
    const volSub = track.audioUnitBox.volume.catchupAndSubscribe(obs => setVolume(obs.getValue()));
    const muteSub = track.audioUnitBox.mute.catchupAndSubscribe(obs => setMuted(obs.getValue()));
    const soloSub = track.audioUnitBox.solo.catchupAndSubscribe(obs => setSoloed(obs.getValue()));
    return () => { volSub.terminate(); muteSub.terminate(); soloSub.terminate(); };
  }, [track]);

  const handleVolume = useCallback((values: number[]) => {
    project.editing.modify(() => { track.audioUnitBox.volume.setValue(values[0]); });
  }, [project, track]);

  const handleMute = useCallback(() => {
    project.editing.modify(() => { track.audioUnitBox.mute.setValue(!muted); });
  }, [project, track, muted]);

  const handleSolo = useCallback(() => {
    project.editing.modify(() => { track.audioUnitBox.solo.setValue(!soloed); });
  }, [project, track, soloed]);

  return (
    <Flex align="center" gap="3" style={{ padding: "8px 12px" }}>
      <Text size="2" weight="medium" style={{ minWidth: 120 }}>{track.name}</Text>
      <Slider
        value={[volume]}
        onValueChange={handleVolume}
        min={-60}
        max={6}
        step={0.1}
        style={{ flex: 1, minWidth: 120 }}
      />
      <Text size="1" color="gray" style={{ minWidth: 50, textAlign: "right", fontFamily: "monospace" }}>
        {volume.toFixed(1)} dB
      </Text>
      <Button
        size="1"
        color={muted ? "red" : "gray"}
        variant={muted ? "solid" : "soft"}
        onClick={handleMute}
        style={{ width: 32, height: 24, padding: 0, fontSize: 12, fontWeight: "bold" }}
      >
        M
      </Button>
      <Button
        size="1"
        color={soloed ? "yellow" : "gray"}
        variant={soloed ? "solid" : "soft"}
        onClick={handleSolo}
        style={{ width: 32, height: 24, padding: 0, fontSize: 12, fontWeight: "bold" }}
      >
        S
      </Button>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// GroupStrip: volume / mute / solo for a group bus
// ---------------------------------------------------------------------------
const GroupStrip: React.FC<{
  group: GroupData;
  project: Project;
  accentColor: string;
}> = ({ group, project, accentColor }) => {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soloed, setSoloed] = useState(false);

  useEffect(() => {
    const box = group.audioUnitBox;
    const volSub = box.volume.catchupAndSubscribe(obs => setVolume(obs.getValue()));
    const muteSub = box.mute.catchupAndSubscribe(obs => setMuted(obs.getValue()));
    const soloSub = box.solo.catchupAndSubscribe(obs => setSoloed(obs.getValue()));
    return () => { volSub.terminate(); muteSub.terminate(); soloSub.terminate(); };
  }, [group]);

  const handleVolume = useCallback((values: number[]) => {
    project.editing.modify(() => { group.audioUnitBox.volume.setValue(values[0]); });
  }, [project, group]);

  const handleMute = useCallback(() => {
    project.editing.modify(() => { group.audioUnitBox.mute.setValue(!muted); });
  }, [project, group, muted]);

  const handleSolo = useCallback(() => {
    project.editing.modify(() => { group.audioUnitBox.solo.setValue(!soloed); });
  }, [project, group, soloed]);

  return (
    <Flex align="center" gap="3" style={{ padding: "8px 12px" }}>
      <Flex align="center" gap="2" style={{ minWidth: 120 }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          backgroundColor: accentColor, flexShrink: 0
        }} />
        <Text size="2" weight="bold">{group.name}</Text>
      </Flex>
      <Slider
        value={[volume]}
        onValueChange={handleVolume}
        min={-60}
        max={6}
        step={0.1}
        style={{ flex: 1, minWidth: 120 }}
      />
      <Text size="1" color="gray" style={{ minWidth: 50, textAlign: "right", fontFamily: "monospace" }}>
        {volume.toFixed(1)} dB
      </Text>
      <Button
        size="1"
        color={muted ? "red" : "gray"}
        variant={muted ? "solid" : "soft"}
        onClick={handleMute}
        style={{ width: 32, height: 24, padding: 0, fontSize: 12, fontWeight: "bold" }}
      >
        M
      </Button>
      <Button
        size="1"
        color={soloed ? "yellow" : "gray"}
        variant={soloed ? "solid" : "soft"}
        onClick={handleSolo}
        style={{ width: 32, height: 24, padding: 0, fontSize: 12, fontWeight: "bold" }}
      >
        S
      </Button>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// MasterStrip: volume only for the master output
// ---------------------------------------------------------------------------
const MasterStrip: React.FC<{
  masterBox: AudioUnitBox | null;
  project: Project | null;
}> = ({ masterBox, project }) => {
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    if (!masterBox) return;
    const sub = masterBox.volume.catchupAndSubscribe((obs: { getValue: () => number }) => setVolume(obs.getValue()));
    return () => sub.terminate();
  }, [masterBox]);

  const handleVolume = useCallback((values: number[]) => {
    if (!project || !masterBox) return;
    project.editing.modify(() => { masterBox.volume.setValue(values[0]); });
  }, [project, masterBox]);

  return (
    <Flex align="center" gap="3" style={{ padding: "8px 12px" }}>
      <Text size="2" weight="bold" style={{ minWidth: 120 }}>Master Output</Text>
      <Slider
        value={[volume]}
        onValueChange={handleVolume}
        min={-60}
        max={6}
        step={0.1}
        style={{ flex: 1, minWidth: 120 }}
      />
      <Text size="1" color="gray" style={{ minWidth: 50, textAlign: "right", fontFamily: "monospace" }}>
        {volume.toFixed(1)} dB
      </Text>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// GroupCard: a group header + child track strips
// ---------------------------------------------------------------------------
const GroupCard: React.FC<{
  group: GroupData;
  tracks: TrackData[];
  project: Project;
  accentColor: string;
  borderColor: string;
}> = ({ group, tracks, project, accentColor, borderColor }) => {
  return (
    <div style={{
      border: `2px solid ${borderColor}`,
      borderRadius: "var(--radius-3)",
      overflow: "hidden",
    }}>
      {/* Group header strip */}
      <div style={{ backgroundColor: `${borderColor}22` }}>
        <GroupStrip group={group} project={project} accentColor={accentColor} />
      </div>
      <Separator size="4" />
      {/* Child tracks */}
      {tracks.map(track => (
        <div key={track.name} style={{ borderTop: "1px solid var(--gray-5)" }}>
          <TrackStrip track={track} project={project} />
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SignalFlowDiagram: visual representation of the routing
// ---------------------------------------------------------------------------
const SignalFlowDiagram: React.FC<{
  groups: { name: string; trackNames: string[]; color: string }[];
}> = ({ groups }) => {
  return (
    <div style={{
      fontFamily: "monospace",
      fontSize: 13,
      lineHeight: "1.6",
      padding: "16px",
      backgroundColor: "var(--gray-2)",
      borderRadius: "var(--radius-2)",
      overflowX: "auto",
    }}>
      {groups.map((group, gi) => (
        <div key={group.name} style={{ marginBottom: gi < groups.length - 1 ? 12 : 0 }}>
          {group.trackNames.map((name, i) => (
            <div key={name}>
              <span style={{ color: "var(--gray-9)" }}>  {name.padEnd(16)}</span>
              <span style={{ color: "var(--gray-7)" }}> ──&gt; </span>
              {i === 0 ? (
                <span style={{ color: group.color, fontWeight: "bold" }}>[{group.name}]</span>
              ) : (
                <span style={{ color: "var(--gray-6)" }}>{"    ".padEnd(group.name.length + 2)}</span>
              )}
              {i === 0 && (
                <>
                  <span style={{ color: "var(--gray-7)" }}> ──&gt; </span>
                  <span style={{ color: "var(--accent-9)", fontWeight: "bold" }}>[Master]</span>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
const RHYTHM_GROUP = {
  name: "Rhythm",
  color: Colors.blue,
  trackNames: ["Drums", "Bass"],
};

const MELODIC_GROUP = {
  name: "Melodic",
  color: Colors.purple,
  trackNames: ["Intro", "Vocals", "Guitar", "Guitar Lead", "Effect Returns"],
};

const GROUP_CONFIGS = [RHYTHM_GROUP, MELODIC_GROUP];

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [groups, setGroups] = useState<GroupData[]>([]);

  // Playback position and transport hooks
  const { currentPosition, isPlaying, pausedPositionRef } = usePlaybackPosition(project);
  const { handlePlay, handlePause, handleStop } = useTransportControls({ project, audioContext, pausedPositionRef });

  const bpmRef = useRef<number>(BPM);

  const masterAudioBox = project?.rootBoxAdapter.audioUnits.adapters().find(u => u.isOutput)?.box ?? null;

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();

        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: BPM,
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(ctx);
        setProject(newProject);
        bpmRef.current = BPM;

        const ext = getAudioExtension();
        const result = await loadTracksWithGroups(
          newProject,
          ctx,
          [
            { name: "Drums", file: `/audio/DarkRide/02_Drums.${ext}` },
            { name: "Bass", file: `/audio/DarkRide/03_Bass.${ext}` },
            { name: "Intro", file: `/audio/DarkRide/01_Intro.${ext}` },
            { name: "Vocals", file: `/audio/DarkRide/06_Vox.${ext}` },
            { name: "Guitar", file: `/audio/DarkRide/04_ElecGtrs.${ext}` },
            { name: "Guitar Lead", file: `/audio/DarkRide/05_ElecGtrsLead.${ext}` },
            { name: "Effect Returns", file: `/audio/DarkRide/07_EffectReturns.${ext}` },
          ],
          localAudioBuffers,
          GROUP_CONFIGS,
          {
            onProgress: (current, total, trackName) => {
              if (mounted) setStatus(`Loading ${trackName} (${current}/${total})...`);
            },
          }
        );

        if (mounted) {
          setTracks(result.tracks);
          setGroups(result.groups);
          setStatus("Ready to play!");
        }
      } catch (error) {
        console.error("Failed to initialize:", error);
        if (mounted) setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Helpers to get tracks belonging to a group
  const tracksForGroup = (groupName: string) => {
    const cfg = GROUP_CONFIGS.find(g => g.name === groupName);
    if (!cfg) return [];
    return cfg.trackNames.map(n => tracks.find(t => t.name === n)).filter(Boolean) as TrackData[];
  };

  const rhythmGroup = groups.find(g => g.name === "Rhythm");
  const melodicGroup = groups.find(g => g.name === "Melodic");

  const isLoading = status !== "Ready to play!";

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", zIndex: 9999, gap: 20,
        }}>
          <div style={{
            width: 50, height: 50,
            border: "4px solid rgba(59,130,246,0.3)", borderTop: "4px solid #3b82f6",
            borderRadius: "50%", animation: "spin 1s linear infinite",
          }} />
          <Text size="5" weight="medium" style={{ color: "#fff" }}>{status}</Text>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <BackLink />

          {/* Header */}
          <Flex direction="column" gap="2" align="center">
            <Heading size="8" align="center">Mixer Groups Demo</Heading>
            <Text size="3" color="gray" align="center">
              Route tracks through group buses for sub-mixing before the master output
            </Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
            <Callout.Text>
              This demo shows how to create <strong>group buses</strong> (sub-mixes) in OpenDAW.
              Tracks are routed through intermediate group buses — <strong>Rhythm</strong> (Drums + Bass)
              and <strong>Melodic</strong> (Intro + Vocals + Guitars + Effects) — before reaching the
              master output. Each track and group has independent volume, mute, and solo controls.
              Soloing a group solos all its child tracks automatically.
            </Callout.Text>
          </Callout.Root>

          {/* Transport */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Transport</Heading>
              <Separator size="4" />
              <TransportControls
                isPlaying={isPlaying}
                currentPosition={currentPosition}
                bpm={bpmRef.current}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
              />
            </Flex>
          </Card>

          {/* Mixer */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="4">Mixer</Heading>
              <Separator size="4" />

              {/* Rhythm Group */}
              {rhythmGroup && project && (
                <GroupCard
                  group={rhythmGroup}
                  tracks={tracksForGroup("Rhythm")}
                  project={project}
                  accentColor="#3b82f6"
                  borderColor="#3b82f6"
                />
              )}

              {/* Melodic Group */}
              {melodicGroup && project && (
                <GroupCard
                  group={melodicGroup}
                  tracks={tracksForGroup("Melodic")}
                  project={project}
                  accentColor="#a855f7"
                  borderColor="#a855f7"
                />
              )}

              {/* Master */}
              <div style={{
                border: "2px solid var(--accent-9)",
                borderRadius: "var(--radius-3)",
                overflow: "hidden",
              }}>
                <div style={{ backgroundColor: "var(--accent-3)" }}>
                  <MasterStrip masterBox={masterAudioBox} project={project} />
                </div>
              </div>
            </Flex>
          </Card>

          {/* Signal Flow */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Signal Flow</Heading>
              <Separator size="4" />
              <Text size="2" color="gray">
                Audio flows from individual tracks through their assigned group bus, then to the master output.
              </Text>
              <SignalFlowDiagram
                groups={[
                  { name: "Rhythm", trackNames: ["Drums", "Bass"], color: "#3b82f6" },
                  { name: "Melodic", trackNames: ["Intro", "Vocals", "Guitar", "Guitar Lead", "Effect Returns"], color: "#a855f7" },
                ]}
              />
            </Flex>
          </Card>

          {/* API Reference */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">API Reference</Heading>
              <Separator size="4" />
              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">Creating a Group Bus:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`import { AudioBusFactory } from "@opendaw/studio-adapters";
import { AudioUnitType, IconSymbol, Colors } from "@opendaw/studio-enums";

project.editing.modify(() => {
  const audioBusBox = AudioBusFactory.create(
    project.skeleton,
    "Rhythm",           // group name
    IconSymbol.AudioBus, // icon
    AudioUnitType.Bus,   // type
    Colors.blue          // color
  );
});`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Routing a Track to a Group:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`// After creating an instrument track:
const { audioUnitBox } = project.api.createInstrument(
  InstrumentFactories.Tape
);

// Reroute from master to the group bus
audioUnitBox.output.refer(groupBusBox.input);`}
                </Code>

                <Text size="2" weight="bold" style={{ marginTop: 8 }}>Accessing Group Controls:</Text>
                <Code size="2" style={{ display: "block", whiteSpace: "pre", padding: 12, overflowX: "auto" }}>
{`// Get the AudioUnitBox for volume/mute/solo
const audioUnitBox = audioBusBox.output
  .targetVertex.unwrap().box;

// Control group volume, mute, solo
audioUnitBox.volume.setValue(-6);  // dB
audioUnitBox.mute.setValue(true);
audioUnitBox.solo.setValue(true);`}
                </Code>
              </Flex>
            </Flex>
          </Card>

          {/* Attribution */}
          <Card>
            <Flex direction="column" gap="3">
              <Heading size="4">Audio Attribution</Heading>
              <Separator size="4" />
              <Text size="2">
                Mix stems from Dark Ride's 'Deny Control'. This file is provided for educational purposes only, and the
                material contained in it should not be used for any commercial purpose without the express permission of
                the copyright holders. Please refer to{" "}
                <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-9)" }}>
                  www.cambridge-mt.com
                </a>{" "}
                for further details.
              </Text>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
