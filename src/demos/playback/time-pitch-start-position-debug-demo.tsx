import React from "react";
import { createRoot } from "react-dom/client";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Heading, Flex } from "@radix-ui/themes";

const App: React.FC = () => {
  return (
    <Theme appearance="dark" accentColor="amber">
      <Container size="3" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="4">
          <Heading size="7" align="center">
            Time/Pitch Start-Position Pop
          </Heading>
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
