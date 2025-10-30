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
              <Link href="/playback-demo-react.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎵</Text>
                    <Heading size="5">Multi-track Playback</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Load and play multiple audio tracks in sync. Demonstrates the tape track functionality with play,
                    pause, and stop controls.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/recording-api-react-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎙️</Text>
                    <Heading size="5">Recording API Demo</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Record audio from your microphone using OpenDAW's Recording API. Uses React with useRef to
                    efficiently store the tape unit reference.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/lifecycle-react-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">⚛️</Text>
                    <Heading size="5">Lifecycle Management (React)</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Learn proper subscription cleanup with React useEffect. Add/remove dynamic components and watch
                    subscriptions being managed automatically.
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
                    Schedule drum samples across a timeline to create rhythmic patterns. Features a visual timeline showing
                    clips and a playhead that tracks playback position.
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/drum-scheduling-autofit-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🥁</Text>
                    <Heading size="5">Drum Scheduling (AudioFit)</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Same drum pattern but using AudioFit mode with AutofitUtils.changeBpm().
                  </Text>
                </Flex>
              </Link>
            </Card>

            <Card asChild>
              <Link href="/effects-demo.html" style={{ textDecoration: "none", padding: "var(--space-5)" }}>
                <Flex direction="column" gap="3">
                  <Flex direction="column" align="center" gap="2">
                    <Text size="8">🎚️</Text>
                    <Heading size="5">Effects & Mixer</Heading>
                  </Flex>
                  <Text size="2" color="gray">
                    Multi-track mixer demonstrating volume, mute, and solo effects. Features vertical faders,
                    waveform visualization, and DAW-style solo behavior.
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
