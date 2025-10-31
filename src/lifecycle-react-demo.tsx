// noinspection PointlessArithmeticExpressionJS

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { UUID } from "@opendaw/lib-std";
import { PPQN } from "@opendaw/lib-dsp";
import { InstrumentFactories, Project } from "@opendaw/studio-core";
import { AudioFileBox, AudioRegionBox, AudioUnitBox, TrackBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { loadAudioFile } from "./lib/audioUtils";
import { initializeOpenDAW } from "./lib/projectSetup";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Button,
  Flex,
  Card,
  Badge,
  Separator,
  Callout
} from "@radix-ui/themes";

// Type definitions
type TrackData = {
  name: string;
  trackBox: TrackBox;
  audioUnitBox: AudioUnitBox;
};

/**
 * TransportDisplay - React component that displays global playback state
 * Demonstrates useEffect cleanup with subscriptions
 */
const TransportDisplay: React.FC<{ project: Project }> = ({ project }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [updateCount, setUpdateCount] = useState(0);

  useEffect(() => {
    console.debug("[TransportDisplay] Component mounted, subscribing...");

    // Subscribe to engine state - use catchupAndSubscribe to get current value immediately
    const playingSubscription = project.engine.isPlaying.catchupAndSubscribe(obs => {
      setUpdateCount(prev => prev + 1);
      setIsPlaying(obs.getValue());
    });

    const positionSubscription = project.engine.position.catchupAndSubscribe(obs => {
      setUpdateCount(prev => prev + 1);
      setPosition(obs.getValue());
    });

    console.debug("[TransportDisplay] Subscribed and caught up with current state");

    // Cleanup function - React will call this when component unmounts
    return () => {
      console.debug("[TransportDisplay] Component unmounting, cleaning up...");
      playingSubscription.terminate();
      positionSubscription.terminate();
      console.debug("[TransportDisplay] Subscriptions terminated");
    };
  }, [project]); // Re-run only if project changes

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Heading size="4">Transport Display</Heading>
          <Badge color="green">Active</Badge>
        </Flex>
        <Separator size="4" />
        <Flex justify="between" align="center">
          <Text weight="bold">Playing:</Text>
          <Text style={{ color: isPlaying ? "#4caf50" : "#f44336" }}>{isPlaying ? "▶ Playing" : "⏸ Stopped"}</Text>
        </Flex>
        <Flex justify="between" align="center">
          <Text weight="bold">Position:</Text>
          <Text>{position.toFixed(2)}</Text>
        </Flex>
        <Flex justify="between" align="center">
          <Text weight="bold">Updates:</Text>
          <Text>{updateCount}</Text>
        </Flex>
      </Flex>
    </Card>
  );
};

/**
 * TrackMonitor - React component that monitors a specific track
 * Demonstrates per-component lifecycle management
 */
const TrackMonitor: React.FC<{
  track: TrackData;
  onRemove: () => void;
}> = ({ track, onRemove }) => {
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [soloed, setSoloed] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);

  useEffect(() => {
    console.debug(`[TrackMonitor:${track.name}] Component mounted, subscribing...`);

    // Subscribe to track state changes - use catchupAndSubscribe to get current value immediately
    const volumeSubscription = track.audioUnitBox.volume.catchupAndSubscribe(obs => {
      setUpdateCount(prev => prev + 1);
      setVolume(obs.getValue());
    });

    const muteSubscription = track.audioUnitBox.mute.catchupAndSubscribe(obs => {
      setUpdateCount(prev => prev + 1);
      setMuted(obs.getValue());
    });

    const soloSubscription = track.audioUnitBox.solo.catchupAndSubscribe(obs => {
      setUpdateCount(prev => prev + 1);
      setSoloed(obs.getValue());
    });

    console.debug(`[TrackMonitor:${track.name}] Subscribed and caught up with current state`);

    // Cleanup function
    return () => {
      console.debug(`[TrackMonitor:${track.name}] Component unmounting, cleaning up...`);
      volumeSubscription.terminate();
      muteSubscription.terminate();
      soloSubscription.terminate();
      console.debug(`[TrackMonitor:${track.name}] Subscriptions terminated`);
    };
  }, [track]);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex justify="between" align="center">
          <Heading size="4">{track.name}</Heading>
          <Button color="red" size="1" onClick={onRemove}>
            Remove
          </Button>
        </Flex>
        <Separator size="4" />
        <Flex justify="between" align="center">
          <Text weight="bold">Volume:</Text>
          <Text>{volume.toFixed(1)} dB</Text>
        </Flex>
        <Flex justify="between" align="center">
          <Text weight="bold">Muted:</Text>
          <Text>{muted ? "🔇 Yes" : "🔊 No"}</Text>
        </Flex>
        <Flex justify="between" align="center">
          <Text weight="bold">Soloed:</Text>
          <Text>{soloed ? "⭐ Yes" : "No"}</Text>
        </Flex>
        <Flex justify="between" align="center">
          <Text weight="bold">Updates:</Text>
          <Text>{updateCount}</Text>
        </Flex>
      </Flex>
    </Card>
  );
};

/**
 * Main App Component
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTransport, setShowTransport] = useState(false);
  const [activeMonitors, setActiveMonitors] = useState<Set<number>>(new Set());
  const [selectedTrack, setSelectedTrack] = useState(0);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Store local audio buffers for the sample manager
        const localAudioBuffers = new Map<string, AudioBuffer>();

        // Initialize OpenDAW with custom sample loading
        const { project: newProject, audioContext: newAudioContext } = await initializeOpenDAW({
          localAudioBuffers,
          onStatusUpdate: setStatus
        });

        if (!mounted) return;

        setAudioContext(newAudioContext);

        const { Quarter } = PPQN;

        setStatus("Loading audio files...");

        // Load audio files
        const audioFiles = [
          { name: "Bass & Drums", url: "/audio/BassDrums30.mp3" },
          { name: "Guitar", url: "/audio/Guitar30.mp3" },
          { name: "Piano & Synth", url: "/audio/PianoSynth30.mp3" },
          { name: "Vocals", url: "/audio/Vocals30.mp3" }
        ];

        const audioBuffers = await Promise.all(audioFiles.map(file => loadAudioFile(newAudioContext, file.url)));

        if (!mounted) return;

        setStatus("Creating tracks...");

        // Store track references
        const newTracks: TrackData[] = [];

        const { editing, api, boxGraph } = newProject;
        editing.modify(() => {
          audioFiles.forEach((file, index) => {
            const { audioUnitBox, trackBox } = api.createInstrument(InstrumentFactories.Tape);
            audioUnitBox.volume.setValue(-3);

            newTracks.push({ name: file.name, trackBox, audioUnitBox });

            const audioBuffer = audioBuffers[index];
            const durationInPPQN = Math.ceil(((audioBuffer.duration * 120) / 60) * Quarter);

            const fileUUID = UUID.generate();
            const fileUUIDString = UUID.toString(fileUUID);
            localAudioBuffers.set(fileUUIDString, audioBuffer);

            const audioFileBox = AudioFileBox.create(boxGraph, fileUUID, box => {
              box.fileName.setValue(file.name);
              box.endInSeconds.setValue(audioBuffer.duration);
            });

            AudioRegionBox.create(boxGraph, UUID.generate(), box => {
              box.regions.refer(trackBox.regions);
              box.file.refer(audioFileBox);
              box.position.setValue(0);
              box.duration.setValue(durationInPPQN);
              box.loopOffset.setValue(0);
              box.loopDuration.setValue(durationInPPQN);
              box.label.setValue(file.name);
              box.mute.setValue(false);
            });

            console.debug(`Created track "${file.name}"`);
          });
        });

        if (!mounted) return;

        newProject.engine.setPosition(0);
        setProject(newProject);
        setTracks(newTracks);
        setStatus("Ready - Add monitors to see React lifecycle in action!");
        console.debug("Demo ready!");
      } catch (error) {
        console.error("Initialization error:", error);
        setStatus(`Error: ${error}`);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handlePlay = useCallback(async () => {
    if (!project || !audioContext) return;
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    project.engine.play();
    setIsPlaying(true);
  }, [project, audioContext]);

  const handleStop = useCallback(() => {
    if (!project) return;
    project.engine.stop(true);
    project.engine.setPosition(0);
    setIsPlaying(false);
  }, [project]);

  const handleToggleTransport = useCallback(() => {
    setShowTransport(prev => !prev);
  }, []);

  const handleAddMonitor = useCallback(() => {
    if (activeMonitors.has(selectedTrack)) {
      alert(`Monitor for "${tracks[selectedTrack].name}" already exists`);
      return;
    }
    setActiveMonitors(prev => new Set(prev).add(selectedTrack));
  }, [selectedTrack, activeMonitors, tracks]);

  const handleRemoveMonitor = useCallback((trackIndex: number) => {
    setActiveMonitors(prev => {
      const newSet = new Set(prev);
      newSet.delete(trackIndex);
      return newSet;
    });
  }, []);

  const handleMuteTrack = useCallback(
    (index: number) => {
      if (!project) return;
      const track = tracks[index];
      const currentMute = track.audioUnitBox.mute.getValue();
      project.editing.modify(() => {
        track.audioUnitBox.mute.setValue(!currentMute);
      });
    },
    [project, tracks]
  );

  const handleSoloTrack = useCallback(
    (index: number) => {
      if (!project) return;
      const track = tracks[index];
      const currentSolo = track.audioUnitBox.solo.getValue();
      console.debug(`[Solo] Track "${track.name}" - Current solo: ${currentSolo}, Setting solo to: ${!currentSolo}`);

      project.editing.modify(() => {
        // Toggle solo on this track
        track.audioUnitBox.solo.setValue(!currentSolo);

        // If we're soloing this track (turning solo ON)
        if (!currentSolo) {
          // Always unmute this track
          track.audioUnitBox.mute.setValue(false);
          console.debug(`[Solo] Unmuting "${track.name}" because it's being soloed`);

          // Mute all other non-soloed tracks
          tracks.forEach((otherTrack, otherIndex) => {
            if (otherIndex !== index && !otherTrack.audioUnitBox.solo.getValue()) {
              otherTrack.audioUnitBox.mute.setValue(true);
              console.debug(`[Solo] Muting "${otherTrack.name}" because "${track.name}" is soloed`);
            }
          });
        } else {
          // If we're unsoloing this track, check if any other tracks are still soloed
          const anyOtherSoloed = tracks.some((t, i) => i !== index && t.audioUnitBox.solo.getValue());

          if (!anyOtherSoloed) {
            // No tracks are soloed anymore, unmute everything
            tracks.forEach(t => {
              t.audioUnitBox.mute.setValue(false);
              console.debug(`[Solo] Unmuting "${t.name}" because no tracks are soloed`);
            });
          } else {
            // Other tracks are still soloed, so mute this one
            track.audioUnitBox.mute.setValue(true);
            console.debug(`[Solo] Muting "${track.name}" because other tracks are still soloed`);
          }
        }
      });
    },
    [project, tracks]
  );

  if (!project) {
    return (
      <Theme appearance="dark" accentColor="blue" radius="large">
        <Container size="2" px="4" py="8">
          <Flex direction="column" align="center" gap="4">
            <Heading size="8">OpenDAW React Lifecycle Demo</Heading>
            <Text size="3" color="gray">{status}</Text>
          </Flex>
        </Container>
      </Theme>
    );
  }

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <BackLink />

          <Flex direction="column" align="center" gap="2">
            <Heading size="8">OpenDAW React Lifecycle Demo</Heading>
            <Text size="3" color="gray">Demonstrating proper subscription cleanup with React useEffect</Text>
          </Flex>

          <Callout.Root color="blue">
            <Callout.Text>
              <strong>What is this demo?</strong>
              <br />
              This demo shows how to properly manage OpenDAW observable subscriptions in React using useEffect cleanup
              functions. Components automatically clean up their subscriptions when unmounted. Watch the console to see
              subscription lifecycle events!
            </Callout.Text>
          </Callout.Root>

          {/* Playback Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Playback Controls</Heading>
              <Flex gap="3" wrap="wrap">
                <Button onClick={handlePlay} disabled={isPlaying} color="green" size="3">
                  ▶ Play
                </Button>
                <Button onClick={handleStop} disabled={!isPlaying} color="red" size="3">
                  ■ Stop
                </Button>
              </Flex>
              <Text size="2" align="center" color="gray">{status}</Text>
            </Flex>
          </Card>

          {/* Track Controls */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Track Controls</Heading>
              <Text size="2" color="gray">
                Modify track state to see monitors update in real-time
              </Text>
              <Flex gap="2" wrap="wrap" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}>
                {tracks.map((track, index) => (
                  <React.Fragment key={index}>
                    <Button onClick={() => handleMuteTrack(index)} color="orange" size="2">
                      Mute {track.name}
                    </Button>
                    <Button onClick={() => handleSoloTrack(index)} color="blue" size="2">
                      Solo {track.name}
                    </Button>
                  </React.Fragment>
                ))}
              </Flex>
            </Flex>
          </Card>

          {/* Component Management */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Component Management</Heading>
              <Flex direction="column" gap="6">
                <Flex direction="column" gap="3">
                  <Text size="2" weight="medium" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Transport Display
                  </Text>
                  <Button
                    onClick={handleToggleTransport}
                    color={showTransport ? "green" : "blue"}
                    size="3"
                  >
                    {showTransport ? "Hide Transport" : "Show Transport"}
                  </Button>
                  {showTransport && <TransportDisplay project={project} />}
                </Flex>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="medium" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Track Monitors
                  </Text>
                  <Flex gap="3" wrap="wrap">
                    <select
                      value={selectedTrack}
                      onChange={e => setSelectedTrack(Number(e.target.value))}
                      style={{
                        padding: "10px",
                        fontSize: "14px",
                        background: "#333",
                        color: "white",
                        border: "1px solid #555",
                        borderRadius: "6px",
                        cursor: "pointer"
                      }}
                    >
                      {tracks.map((track, index) => (
                        <option key={index} value={index}>
                          {track.name}
                        </option>
                      ))}
                    </select>
                    <Button onClick={handleAddMonitor} color="green" size="3">
                      Add Monitor
                    </Button>
                  </Flex>
                </Flex>
              </Flex>
            </Flex>
          </Card>

          {/* Active Monitors */}
          <Card>
            <Flex direction="column" gap="4">
              <Heading size="5" color="blue">Active Monitors</Heading>
              <Text size="2" color="gray">
                Each monitor is a React component with its own useEffect. Click "Remove" to unmount and watch subscriptions
                clean up automatically!
              </Text>
              <Flex gap="4" wrap="wrap" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
                {Array.from(activeMonitors).map(trackIndex => (
                  <TrackMonitor
                    key={trackIndex}
                    track={tracks[trackIndex]}
                    onRemove={() => handleRemoveMonitor(trackIndex)}
                  />
                ))}
              </Flex>
              {activeMonitors.size === 0 && (
                <Text size="2" color="gray" style={{ fontStyle: "italic" }}>
                  No active monitors. Add some to see lifecycle management in action!
                </Text>
              )}
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

// Bootstrap the React app
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
