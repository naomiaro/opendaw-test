import React from "react";
import { Badge, Card, Code, Flex, Separator, Text } from "@radix-ui/themes";

export interface TestStepRow {
  label: string;
  value: string;
}

export interface TestStepProps {
  index: number;
  title: string;
  description: React.ReactNode;
  actions: React.ReactNode;
  expected: TestStepRow[];
  got?: TestStepRow[] | null;
}

export const TestStep: React.FC<TestStepProps> = ({
  index,
  title,
  description,
  actions,
  expected,
  got,
}) => {
  const gotByLabel = new Map((got ?? []).map((r) => [r.label, r.value]));
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Badge color="amber" size="2" radius="full">
            Step {index}
          </Badge>
          <Text size="3" weight="bold">
            {title}
          </Text>
        </Flex>
        <Separator size="4" />
        <Text size="2">{description}</Text>
        <Flex gap="3" wrap="wrap">
          {actions}
        </Flex>
        {expected.length > 0 && (
          <Flex direction="column" gap="2" style={{ paddingTop: 4 }}>
            <Flex gap="3">
              <Text size="2" weight="bold" style={{ flex: 1 }}>
                Expected
              </Text>
              <Text size="2" weight="bold" style={{ flex: 1 }}>
                Got
              </Text>
            </Flex>
            <Separator size="4" />
            {expected.map((row) => (
              <Flex gap="3" key={row.label} align="start">
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="1" color="gray">
                    {row.label}
                  </Text>
                  <Code size="2">{row.value}</Code>
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: 1 }}>
                  <Text size="1" color="gray">
                    &nbsp;
                  </Text>
                  <Code size="2">{gotByLabel.get(row.label) ?? "—"}</Code>
                </Flex>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Card>
  );
};
