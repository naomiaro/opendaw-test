import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Text, Flex } from "@radix-ui/themes";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "./components/GitHubCorner";
import { MoisesLogo } from "./components/MoisesLogo";
import { BackLink } from "./components/BackLink";
import { initializeOpenDAW } from "./lib/projectSetup";

const App: React.FC = () => {
  const [status, setStatus] = useState("Loading...");
  const projectRef = useRef<Project | null>(null);

  useEffect(() => {
    initializeOpenDAW({ onStatusUpdate: setStatus }).then(({ project }) => {
      projectRef.current = project;
      setStatus("Ready");
    });
  }, []);

  return (
    <Theme appearance="dark" accentColor="blue" radius="large">
      <GitHubCorner />
      <BackLink />
      <Container size="3" px="4" py="8">
        <Flex direction="column" gap="6" style={{ maxWidth: 900, margin: "0 auto" }}>
          <Flex direction="column" align="center" gap="2">
            <Heading size="8">Tempo Automation</Heading>
            <Text size="3" color="gray">
              Apply preset tempo patterns and hear the metronome follow tempo changes in real-time
            </Text>
          </Flex>
          <Text>{status}</Text>
        </Flex>
      </Container>
      <MoisesLogo />
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
