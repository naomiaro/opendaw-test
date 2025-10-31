import React from "react";
import { Button, Flex } from "@radix-ui/themes";

/**
 * BackLink component - provides a navigation link back to the main demos page
 * Consistently styled with blue color and left alignment
 */
export const BackLink: React.FC = () => {
  return (
    <Flex justify="start" style={{ width: "100%" }}>
      <Button variant="ghost" color="blue" asChild>
        <a href="/" style={{ textDecoration: "none", cursor: "pointer" }}>
          ← Back to Demos
        </a>
      </Button>
    </Flex>
  );
};
