import React from "react";
import { Flex, Text } from "@radix-ui/themes";

export interface DebugLink {
  label: string;
  href: string;
  kind: "demo" | "note";
}

export interface DebugLinkBarProps {
  links: DebugLink[];
}

export const DebugLinkBar: React.FC<DebugLinkBarProps> = ({ links }) => {
  if (links.length === 0) return null;
  return (
    <Flex gap="3" wrap="wrap" align="center" style={{ padding: "0.25rem 0" }}>
      <Text size="2" color="gray" weight="bold">
        See also:
      </Text>
      {links.map((l) => (
        <Text size="2" key={l.href}>
          <a
            href={l.href}
            style={{
              color: "var(--accent-11)",
              textDecoration: "underline",
            }}
            target={l.kind === "note" ? "_blank" : undefined}
            rel={l.kind === "note" ? "noopener noreferrer" : undefined}
          >
            {l.kind === "demo" ? "▶ " : "📄 "}
            {l.label}
          </a>
        </Text>
      ))}
    </Flex>
  );
};
