// src/demos/warp/warp-overview.tsx
// Static overview page — no audio, no engine imports, no hooks.
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import {
  Theme,
  Container,
  Heading,
  Text,
  Flex,
  Card,
  Link,
  Table,
} from "@radix-ui/themes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";

function WarpOverview() {
  return (
    <Theme appearance="dark" accentColor="iris">
      <Container size="3" py="6">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6">
          <Flex direction="column" gap="3">
            <Heading size="7">Beat Maps &amp; Warping: Who Bends?</Heading>
            <Text color="gray">
              A beat tracker — or sidecar metadata in an ACID chunk, an Apple Loops
              header, or an Ableton{" "}<code>.asd</code> analysis file — yields a list
              of <code>&#123;second, beat&#125;</code> pins: the time in the file where
              each beat lands. Once that map exists, the file and the project grid must
              be reconciled. Every DAW surfaces exactly three answers: bend the file,
              bend the grid, or slice and stretch.
            </Text>
          </Flex>

          <Card>
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Scenario</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>What happens</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>What you hear</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>DAWs call it</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Demo</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>Varispeed</Table.Cell>
                  <Table.Cell>File bends to the grid</Table.Cell>
                  <Table.Cell>Beats lock, pitch shifts with tempo</Table.Cell>
                  <Table.Cell>Ableton <em>Re-Pitch</em></Table.Cell>
                  <Table.Cell>
                    <Link href="/warp-varispeed-demo.html">Open</Link>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Grid follows file</Table.Cell>
                  <Table.Cell>Grid bends to the file</Table.Cell>
                  <Table.Cell>Audio untouched, metronome and ruler bend</Table.Cell>
                  <Table.Cell>
                    Ableton <em>Set tempo from clip</em>; Logic Smart Tempo <em>ADAPT</em>
                  </Table.Cell>
                  <Table.Cell>
                    <Link href="/warp-grid-follows-file-demo.html">Open</Link>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.Cell>Time-stretch</Table.Cell>
                  <Table.Cell>File bends to the grid, sliced</Table.Cell>
                  <Table.Cell>Beats lock, key survives</Table.Cell>
                  <Table.Cell>
                    Ableton <em>Beats/Complex</em>; Logic <em>Flex Time</em>
                  </Table.Cell>
                  <Table.Cell>
                    <Link href="/warp-timestretch-demo.html">Open</Link>
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">Varispeed</Heading>
              <Text color="gray">
                DJs and producers working in a tape or vinyl aesthetic reach for this.
                The pitch shift is a feature, not a flaw — the record speeds up and
                sharpens, just as it would on a turntable. It is also the only
                artifact-free conform: no stretch DSP runs at all, only a read-rate
                change, so there is nothing to smear or double.
              </Text>
              <Text>
                <Link href="/warp-varispeed-demo.html">Varispeed demo &rarr;</Link>
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">Grid follows file</Heading>
              <Text color="gray">
                Performances recorded without a click — a live drummer, an archival
                multitrack, a field recording — arrive with a beat map that no rigid
                tempo can follow. Rather than mangle the audio, this mode treats the
                music as sacred and bends the grid. After the conform, MIDI, quantize,
                and the metronome follow the player.
              </Text>
              <Text>
                <Link href="/warp-grid-follows-file-demo.html">Grid-follows-file demo &rarr;</Link>
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">Time-stretch</Heading>
              <Text color="gray">
                Remixing and beatmatching where the key must survive: acapellas dropped
                over new beats, sample-pack loops brought to project tempo, stem imports
                from a different session. The algorithm slices the file at transient
                boundaries and stretches each slice independently, locking beats to the
                grid while the pitch stays fixed. This is the modern DAW default.
              </Text>
              <Text>
                <Link href="/warp-timestretch-demo.html">Time-stretch demo &rarr;</Link>
              </Text>
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Heading size="5">Engine-agnostic anchors</Heading>
              <Text color="gray">
                The warp-marker list is identical for varispeed and time-stretch. The
                same <code>&#123;tick, second&#125;</code> pins (the beat map&apos;s{" "}
                <code>&#123;second, beat&#125;</code> rows mapped onto grid ticks) drive an{" "}
                <code>AudioPitchStretchBox</code> and an <code>AudioTimeStretchBox</code>{" "}
                without modification. This is why Ableton lets you switch a clip&apos;s warp
                mode without touching its markers — the anchors describe the beat map,
                not the stretch algorithm. The{" "}
                <Link href="/warp-timestretch-demo.html">time-stretch demo</Link> makes
                the A/B audible with raw, varispeed, and time-stretch all available on
                one page.
              </Text>
            </Flex>
          </Card>

          <MoisesLogo />
        </Flex>
      </Container>
    </Theme>
  );
}

createRoot(document.getElementById("root")!).render(<WarpOverview />);
