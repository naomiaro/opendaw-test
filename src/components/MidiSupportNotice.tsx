import React from "react";
import { Callout, Flex } from "@radix-ui/themes";
import { midiSupportNotices, type MidiSupportState } from "@/lib/midiSupportNotice";

/**
 * The info area at the top of a demo that offers hardware MIDI: what stands between the
 * visitor and their devices, if anything. Renders nothing when nothing does.
 */
export function MidiSupportNotice(state: MidiSupportState): React.ReactElement | null {
  const notices = midiSupportNotices(state);
  if (notices.length === 0) return null;
  return (
    <Flex direction="column" gap="2">
      {notices.map((notice) => (
        <Callout.Root key={notice.kind} color={notice.color} size="1" role={notice.kind === "denied" ? "alert" : "status"}>
          <Callout.Text>{notice.text}</Callout.Text>
        </Callout.Root>
      ))}
    </Flex>
  );
}
