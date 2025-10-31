import React from "react";
import { Flex } from "@radix-ui/themes";

/**
 * Moises Logo Component
 * Displays the Moises.ai logo with a link to their website
 */
export const MoisesLogo: React.FC = () => {
  return (
    <Flex justify="center" py="4">
      <a href="https://moises.ai/" target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
        <img src="/moises-dark-logo.svg" alt="Moises.ai" style={{ height: "32px", opacity: 0.8 }} />
      </a>
    </Flex>
  );
};
