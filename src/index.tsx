import React from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex, Card, Link } from "@radix-ui/themes";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";

const App: React.FC = () => {
  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <Container size="3" px="4" py="8">
        <Flex direction="column" align="center" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading
              size="9"
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}
            >
              OpenDAW Demos
            </Heading>
            <Text size="3" color="gray" align="center">
              Explore different capabilities of the OpenDAW headless audio engine
            </Text>
          </Flex>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", width: "100%" }}>
            <Card asChild>
              <Link href="/effects-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎚️</Text>
                    <Heading size="5">Effects & Mixer</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Comprehensive multi-track mixer with professional audio effects, waveforms, volume faders, pan
                    controls, mute/solo, and live effect parameters. Includes Reverb, Compressor, Delay, Lo-Fi Crusher,
                    and Stereo Width effects.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/track-editing-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">✂️</Text>
                    <Heading size="5">Track Editing</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Interactive audio region editing with Dark Ride stems. Split regions at the playhead, move regions
                    around the timeline, and experiment with non-destructive editing operations.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/recording-api-react-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎙️</Text>
                    <Heading size="5">Recording API</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Record audio from your microphone using OpenDAW's Recording API. Uses React with useRef to
                    efficiently store the tape unit reference.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/drum-scheduling-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🥁</Text>
                    <Heading size="5">Drum Pattern Scheduling</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Schedule drum samples across a timeline to create rhythmic patterns. Features a visual timeline
                    showing clips and a playhead that tracks playback position.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/looping-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🔁</Text>
                    <Heading size="5">Looping Capabilities</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Comprehensive demonstration of OpenDAW's looping features. Control timeline loop areas, enable/disable
                    looping, adjust loop boundaries, and watch loop iterations in real-time.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/timebase-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">⏱️</Text>
                    <Heading size="5">TimeBase Comparison</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Understand Musical vs Seconds TimeBase. See how Musical regions change duration with BPM while Seconds
                    regions stay constant. Learn when overlaps are allowed and which TimeBase to use for different scenarios.
                  </Text>
                </Flex>
              </Link>
            </Card>
            <Card asChild>
              <Link href="/tempo-automation-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎵</Text>
                    <Heading size="5">Tempo Automation</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Apply preset tempo automation patterns (accelerando, ritardando, stepped changes)
                    and hear the metronome and drum loop respond to tempo changes in real-time.
                  </Text>
                </Flex>
              </Link>
            </Card>
            <Card asChild>
              <Link href="/time-signature-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎼</Text>
                    <Heading size="5">Time Signature Changes</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Apply preset time signature sequences (standard to waltz, prog rock, film score patterns)
                    and hear the metronome adapt to changing meters in real-time.
                  </Text>
                </Flex>
              </Link>
            </Card>
          </div>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
