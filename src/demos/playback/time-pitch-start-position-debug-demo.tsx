import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { loadAudioFile, getAudioExtension } from "@/lib/audioUtils";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex, Card, Text, Badge } from "@radix-ui/themes";

const PROJECT_BPM = 124;
const AUDIO_FILE = `/audio/DarkRide/06_Vox.${getAudioExtension()}`;
const AUDIO_LABEL = "06_Vox";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);

  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const localAudioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus("Initializing OpenDAW...");
        const { audioContext: newAudioContext } =
          await initializeOpenDAW({
            localAudioBuffers: localAudioBuffersRef.current,
            bpm: PROJECT_BPM,
            onStatusUpdate: setStatus,
          });
        if (cancelled) return;

        setStatus(`Loading ${AUDIO_LABEL}...`);
        const audioBuffer = await loadAudioFile(newAudioContext, AUDIO_FILE);
        if (cancelled) return;
        audioBufferRef.current = audioBuffer;

        setStatus("Ready");
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setStatus("Failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
          <Card>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold">Status:</Text>
              <Badge
                color={status === "Failed" ? "red" : status === "Ready" ? "green" : "blue"}
              >
                {status}
              </Badge>
              {audioBufferRef.current && (
                <Text size="2" color="gray">
                  {audioBufferRef.current.duration.toFixed(2)} s,{" "}
                  {audioBufferRef.current.numberOfChannels} ch,{" "}
                  {audioBufferRef.current.sampleRate} Hz
                </Text>
              )}
            </Flex>
            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
          </Card>
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
