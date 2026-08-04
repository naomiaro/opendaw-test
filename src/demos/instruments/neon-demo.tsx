import React, { useEffect, useRef, useState, useCallback, MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { Project, MidiDevices } from "@opendaw/studio-core";
import { InstrumentFactories, CzSysex, NeonPreset, Neon } from "@opendaw/studio-adapters";
import type { CzTone } from "@opendaw/studio-adapters";
import type { AudioUnitBox, NeonDeviceBox } from "@opendaw/studio-boxes";
import type { Int32Field, Float32Field } from "@opendaw/lib-box";
import { VoicingMode } from "@opendaw/studio-enums";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { PianoKeyboard, PIANO_STYLES } from "@/demos/midi/PianoKeyboard";
import { CANVAS_COLORS, CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { NEON_PRESETS } from "./neonPresets";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Text, Flex, Card, Callout, Badge,
  SegmentedControl, Select, Slider, Switch, Button,
} from "@radix-ui/themes";

/**
 * One hook per bound control. Reads catch up immediately; writes go through a
 * transaction; any change (user, preset apply, undo) flows back via the subscription.
 * `onExternalChange` is read through a ref so callers can pass an inline closure
 * without re-subscribing every render — only `field` re-triggers the effect.
 */
function useNeonField(
  project: Project | null,
  field: Int32Field | Float32Field | null,
  onExternalChange?: () => void,
): [number, (v: number) => void] {
  const [value, setValue] = useState(0);
  const onExternalChangeRef = useRef(onExternalChange);
  onExternalChangeRef.current = onExternalChange;
  useEffect(() => {
    if (!field) return;
    const sub = field.catchupAndSubscribe((obs) => {
      setValue(obs.getValue());
      onExternalChangeRef.current?.();
    });
    return () => sub.terminate();
  }, [field]);
  const write = useCallback((v: number) => {
    if (!project || !field) return;
    project.editing.modify(() => field.setValue(v));
  }, [project, field]);
  return [value, write];
}

const NEON_WAVE2_OPTIONS = ["Off", ...Neon.Waves];

interface NeonParamPanelProps {
  project: Project;
  neonBox: NeonDeviceBox;
  setActivePatch: (label: string) => void;
  suppressCustomRef: MutableRefObject<boolean>;
}

/**
 * Parameter panel bound directly to Neon's box graph fields. Every control reads
 * and writes through `useNeonField` — moving a slider commits a transaction, and
 * loading a preset (Task 3's `applyTone`) flows back through the same subscriptions,
 * snapping every control to the patch's values.
 */
const NeonParamPanel: React.FC<NeonParamPanelProps> = ({
  project, neonBox, setActivePatch, suppressCustomRef,
}) => {
  // Guards the very first catch-up (fires synchronously on mount, while the
  // label still reads "Init") from flipping the patch label to "Custom".
  // Declared as the LAST effect below — React runs a component's effects in
  // declaration order, so it commits after every field hook's initial catch-up.
  const mountedRef = useRef(false);
  const markCustom = useCallback(() => {
    if (!mountedRef.current || suppressCustomRef.current) return;
    setActivePatch("Custom");
  }, [setActivePatch, suppressCustomRef]);

  const [lineSelect, setLineSelect] = useNeonField(project, neonBox.lineSelect, markCustom);
  const [modulation, setModulation] = useNeonField(project, neonBox.modulation, markCustom);
  const [octave, setOctave] = useNeonField(project, neonBox.octave, markCustom);
  const [detune, setDetune] = useNeonField(project, neonBox.detune, markCustom);
  const [tune, setTune] = useNeonField(project, neonBox.tune, markCustom);
  const [glideTime, setGlideTime] = useNeonField(project, neonBox.glideTime, markCustom);
  const [voicingMode, setVoicingMode] = useNeonField(project, neonBox.voicingMode, markCustom);

  const line0 = neonBox.lines.fields()[0];
  const line1 = neonBox.lines.fields()[1];
  const [line0Wave1, setLine0Wave1] = useNeonField(project, line0.wave1, markCustom);
  const [line0Wave2, setLine0Wave2] = useNeonField(project, line0.wave2, markCustom);
  const [line0Dcw, setLine0Dcw] = useNeonField(project, line0.dcwKeyFollow, markCustom);
  const [line0Dca, setLine0Dca] = useNeonField(project, line0.dcaKeyFollow, markCustom);
  const [line1Wave1, setLine1Wave1] = useNeonField(project, line1.wave1, markCustom);
  const [line1Wave2, setLine1Wave2] = useNeonField(project, line1.wave2, markCustom);
  const [line1Dcw, setLine1Dcw] = useNeonField(project, line1.dcwKeyFollow, markCustom);
  const [line1Dca, setLine1Dca] = useNeonField(project, line1.dcaKeyFollow, markCustom);

  const vibrato = neonBox.vibrato;
  const [vibratoWave, setVibratoWave] = useNeonField(project, vibrato.wave, markCustom);
  const [vibratoDelay, setVibratoDelay] = useNeonField(project, vibrato.delay, markCustom);
  const [vibratoRate, setVibratoRate] = useNeonField(project, vibrato.rate, markCustom);
  const [vibratoDepth, setVibratoDepth] = useNeonField(project, vibrato.depth, markCustom);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  const line2Deemphasized = lineSelect === 0; // "1" — line 2 not in the active signal path
  // Presets write fractional cents (sysex fine steps don't land on integers) — round
  // the total before splitting or the readout shows float dust.
  const detuneRounded = Math.round(detune);
  const detuneSemitones = Math.trunc(detuneRounded / 100);
  const detuneCents = detuneRounded % 100;

  return (
    <div className="ne-param-layout">
      <Card>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Text size="2" weight="bold" color="gray">Parameters</Text>
            <Badge color="amber" size="1">{Neon.LineSelect[lineSelect]}</Badge>
          </Flex>

          <Flex gap="4" wrap="wrap" align="center">
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">Line Select</Text>
              <SegmentedControl.Root
                value={String(lineSelect)}
                onValueChange={(v) => setLineSelect(Number(v))}
              >
                {Neon.LineSelect.map((label, i) => (
                  <SegmentedControl.Item key={label} value={String(i)}>{label}</SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">Modulation</Text>
              <SegmentedControl.Root
                value={String(modulation)}
                onValueChange={(v) => setModulation(Number(v))}
              >
                {Neon.Modulation.map((label, i) => (
                  <SegmentedControl.Item key={label} value={String(i)}>{label}</SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Flex>
          </Flex>

          <div className="ne-param-grid">
            <Card className="ne-line-card">
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Line 1</Text>
                <NeonWaveControls
                  wave1={line0Wave1} setWave1={setLine0Wave1}
                  wave2={line0Wave2} setWave2={setLine0Wave2}
                  dcwKeyFollow={line0Dcw} setDcwKeyFollow={setLine0Dcw}
                  dcaKeyFollow={line0Dca} setDcaKeyFollow={setLine0Dca}
                />
              </Flex>
            </Card>

            <Card className="ne-line-card" style={line2Deemphasized ? { opacity: 0.45 } : undefined}>
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Line 2</Text>
                {line2Deemphasized && (
                  <Text size="1" color="gray">
                    line 1 only — Line Select is "{Neon.LineSelect[lineSelect]}"
                  </Text>
                )}
                <NeonWaveControls
                  wave1={line1Wave1} setWave1={setLine1Wave1}
                  wave2={line1Wave2} setWave2={setLine1Wave2}
                  dcwKeyFollow={line1Dcw} setDcwKeyFollow={setLine1Dcw}
                  dcaKeyFollow={line1Dca} setDcaKeyFollow={setLine1Dca}
                />
              </Flex>
            </Card>

            <Card className="ne-line-card">
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Vibrato</Text>
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">Wave</Text>
                  <Select.Root value={String(vibratoWave)} onValueChange={(v) => setVibratoWave(Number(v))}>
                    <Select.Trigger style={{ width: "100%" }} />
                    <Select.Content>
                      {Neon.VibratoWaves.map((label, i) => (
                        <Select.Item key={label} value={String(i)}>{label}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <NeonSliderRow label="Delay" value={vibratoDelay} onChange={setVibratoDelay} min={0} max={99} step={1} />
                <NeonSliderRow label="Rate" value={vibratoRate} onChange={setVibratoRate} min={0} max={99} step={1} />
                <NeonSliderRow label="Depth" value={vibratoDepth} onChange={setVibratoDepth} min={0} max={99} step={1} />
              </Flex>
            </Card>

            <Card className="ne-line-card">
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Global</Text>
                <Flex direction="column" gap="1">
                  <Text size="1" color="gray">Octave</Text>
                  <Flex align="center" gap="2">
                    <Button
                      size="1" variant="soft"
                      onClick={() => setOctave(Math.max(-3, octave - 1))}
                      disabled={octave <= -3}
                    >
                      −
                    </Button>
                    <Text size="2" style={{ fontFamily: "var(--mc-mono)", minWidth: 20, textAlign: "center" }}>
                      {octave}
                    </Text>
                    <Button
                      size="1" variant="soft"
                      onClick={() => setOctave(Math.min(3, octave + 1))}
                      disabled={octave >= 3}
                    >
                      +
                    </Button>
                  </Flex>
                </Flex>
                <Flex direction="column" gap="1">
                  <Flex justify="between">
                    <Text size="1" color="gray">Detune</Text>
                    <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>
                      {detuneSemitones >= 0 ? "+" : ""}{detuneSemitones}st {detuneCents >= 0 ? "+" : ""}{detuneCents}ct
                    </Text>
                  </Flex>
                  <Slider min={-4800} max={4800} step={1} value={[detune]} onValueChange={([v]) => setDetune(v)} />
                </Flex>
                <NeonSliderRow label="Tune" value={tune} onChange={setTune} min={-1200} max={1200} step={1} />
                <NeonSliderRow label="Glide" value={glideTime} onChange={setGlideTime} min={0} max={1} step={0.01} decimals={2} />
                <Flex align="center" justify="between">
                  <Text size="1" color="gray">Voicing</Text>
                  <Flex align="center" gap="2">
                    <Text size="1" color={voicingMode === VoicingMode.Monophonic ? undefined : "gray"}>Mono</Text>
                    <Switch
                      checked={voicingMode === VoicingMode.Polyphonic}
                      onCheckedChange={(checked) =>
                        setVoicingMode(checked ? VoicingMode.Polyphonic : VoicingMode.Monophonic)
                      }
                    />
                    <Text size="1" color={voicingMode === VoicingMode.Polyphonic ? undefined : "gray"}>Poly</Text>
                  </Flex>
                </Flex>
              </Flex>
            </Card>
          </div>
        </Flex>
      </Card>

      <NeonEnvelopeViz project={project} neonBox={neonBox} />
    </div>
  );
};

type EnvKind = "pitch" | "dcw" | "dca";

/**
 * Read-only 8-stage envelope visualizer. The painter reads the selected envelope's
 * 18 fields directly from the box graph each repaint; repaints are driven by
 * `editing.subscribe` (fires after every transaction — preset applies and parameter
 * writes both land there) plus the selector effect. CanvasPainter debounces to
 * `requestUpdate()`, so idle frames cost nothing.
 */
const NeonEnvelopeViz: React.FC<{ project: Project; neonBox: NeonDeviceBox }> = ({
  project, neonBox,
}) => {
  const [envLine, setEnvLine] = useState<0 | 1>(0);
  const [envKind, setEnvKind] = useState<EnvKind>("dca");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const selRef = useRef<{ line: 0 | 1; kind: EnvKind }>({ line: envLine, kind: envKind });
  selRef.current = { line: envLine, kind: envKind };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const { line, kind } = selRef.current;
      const envelope = neonBox.envelopes.fields()[Neon.envelopeIndex(line, kind)];
      const rates = [
        envelope.rate1, envelope.rate2, envelope.rate3, envelope.rate4,
        envelope.rate5, envelope.rate6, envelope.rate7, envelope.rate8,
      ].map((f) => f.getValue());
      const levels = [
        envelope.level1, envelope.level2, envelope.level3, envelope.level4,
        envelope.level5, envelope.level6, envelope.level7, envelope.level8,
      ].map((f) => f.getValue());
      drawEnvelope(
        context, canvas.clientWidth, canvas.clientHeight,
        rates, levels, envelope.sustain.getValue(), envelope.end.getValue(),
      );
    });
    painterRef.current = painter;
    const editSub = project.editing.subscribe(() => painter.requestUpdate());
    return () => {
      editSub.terminate();
      painter.terminate();
      painterRef.current = null;
    };
  }, [project, neonBox]);

  useEffect(() => {
    painterRef.current?.requestUpdate();
  }, [envLine, envKind]);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Text size="2" weight="bold" color="gray">Envelopes</Text>
        <Flex gap="2" wrap="wrap">
          <SegmentedControl.Root
            size="1"
            value={String(envLine)}
            onValueChange={(v) => setEnvLine(Number(v) as 0 | 1)}
          >
            <SegmentedControl.Item value="0">Line 1</SegmentedControl.Item>
            <SegmentedControl.Item value="1">Line 2</SegmentedControl.Item>
          </SegmentedControl.Root>
          <SegmentedControl.Root
            size="1"
            value={envKind}
            onValueChange={(v) => setEnvKind(v as EnvKind)}
          >
            <SegmentedControl.Item value="pitch">Pitch</SegmentedControl.Item>
            <SegmentedControl.Item value="dcw">DCW</SegmentedControl.Item>
            <SegmentedControl.Item value="dca">DCA</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
        <canvas
          ref={canvasRef}
          style={{
            display: "block", width: "100%", height: 180,
            background: CANVAS_COLORS.bg, borderRadius: 4,
          }}
        />
        <Text size="1" color="gray">
          Schematic shape — stage width grows as its rate slows; dashed line marks the
          sustain stage. The DSP's hardware rate tables own real timing.
        </Text>
      </Flex>
    </Card>
  );
};

/**
 * Schematic stage polyline: x-advance per stage ∝ (100 − rate), floored so
 * instant stages stay visible; y maps level 0–99 bottom-to-top.
 */
function drawEnvelope(
  context: CanvasRenderingContext2D, width: number, height: number,
  rates: number[], levels: number[], sustain: number, end: number,
): void {
  const pad = 12;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;
  const stageCount = Math.max(1, Math.min(8, end));
  const widths = Array.from({ length: stageCount }, (_, i) => Math.max(8, 100 - rates[i]));
  const total = widths.reduce((a, b) => a + b, 0);
  const y = (level: number) => pad + plotH * (1 - level / 99);

  context.clearRect(0, 0, width, height);
  context.strokeStyle = CANVAS_COLORS.amber;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(pad, y(0));
  let x = pad;
  const stageX: number[] = [];
  for (let i = 0; i < stageCount; i++) {
    x += (widths[i] / total) * plotW;
    stageX.push(x);
    context.lineTo(x, y(levels[i]));
  }
  context.stroke();

  // Sustain marker: vertical dashed line at the sustain stage (sustain 0 = none).
  if (sustain >= 1 && sustain <= stageCount) {
    const sx = stageX[sustain - 1];
    context.strokeStyle = CANVAS_COLORS.structural;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(sx, pad);
    context.lineTo(sx, pad + plotH);
    context.stroke();
    context.setLineDash([]);
  }

  context.fillStyle = CANVAS_COLORS.label;
  stageX.forEach((dotX, i) => {
    context.beginPath();
    context.arc(dotX, y(levels[i]), 3, 0, Math.PI * 2);
    context.fill();
  });
}

/** Wave1 / Wave2 selects + DCW/DCA key-follow sliders — shared by both line cards. */
const NeonWaveControls: React.FC<{
  wave1: number; setWave1: (v: number) => void;
  wave2: number; setWave2: (v: number) => void;
  dcwKeyFollow: number; setDcwKeyFollow: (v: number) => void;
  dcaKeyFollow: number; setDcaKeyFollow: (v: number) => void;
}> = ({ wave1, setWave1, wave2, setWave2, dcwKeyFollow, setDcwKeyFollow, dcaKeyFollow, setDcaKeyFollow }) => (
  <>
    <Flex direction="column" gap="1">
      <Text size="1" color="gray">Wave 1</Text>
      <Select.Root value={String(wave1)} onValueChange={(v) => setWave1(Number(v))}>
        <Select.Trigger style={{ width: "100%" }} />
        <Select.Content>
          {Neon.Waves.map((label, i) => (
            <Select.Item key={label} value={String(i)}>{label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
    <Flex direction="column" gap="1">
      <Text size="1" color="gray">Wave 2</Text>
      <Select.Root value={String(wave2)} onValueChange={(v) => setWave2(Number(v))}>
        <Select.Trigger style={{ width: "100%" }} />
        <Select.Content>
          {NEON_WAVE2_OPTIONS.map((label, i) => (
            <Select.Item key={label} value={String(i)}>{label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
    <NeonSliderRow label="DCW Key Follow" value={dcwKeyFollow} onChange={setDcwKeyFollow} min={0} max={9} step={1} />
    <NeonSliderRow label="DCA Key Follow" value={dcaKeyFollow} onChange={setDcaKeyFollow} min={0} max={9} step={1} />
  </>
);

/** Labeled Radix Slider with a numeric readout — the repeated row shape across every card. */
const NeonSliderRow: React.FC<{
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; decimals?: number;
}> = ({ label, value, onChange, min, max, step, decimals = 0 }) => (
  <Flex direction="column" gap="1">
    <Flex justify="between">
      <Text size="1" color="gray">{label}</Text>
      <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{value.toFixed(decimals)}</Text>
    </Flex>
    <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
  </Flex>
);

// Preset card grid + drop zone — same console-panel card grid as the Apparat demo,
// scoped to this page (ne- prefix).
const PAGE_STYLES = `
.ne-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.ne-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  text-align: left;
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 4px;
  padding: 12px;
  cursor: pointer;
  font: inherit;
  color: var(--mc-text);
  transition: background 160ms ease, border-color 160ms ease;
}
.ne-card:hover:not(:disabled) { background: var(--mc-panel-hover); }
.ne-card[data-active] { border-color: var(--mc-amber); }
.ne-card:disabled { cursor: default; opacity: 0.55; }
.ne-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.ne-card-name { font-family: var(--mc-mono); font-size: 13px; font-weight: 600; }
.ne-card-desc { font-size: 11.5px; line-height: 1.45; color: var(--mc-muted); }
.ne-dropzone {
  padding: 28px 20px;
  border: 2px dashed var(--mc-line-bright);
  border-radius: 4px;
  text-align: center;
  cursor: pointer;
  background: var(--mc-bg);
  transition: border-color 160ms ease, background 160ms ease;
}
.ne-dropzone[data-active] {
  border-color: var(--mc-amber);
  background: rgba(232, 163, 61, 0.05);
}
.ne-param-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
  gap: 12px;
  align-items: start;
}
.ne-param-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 760px) {
  .ne-param-layout { grid-template-columns: 1fr; }
  .ne-param-grid { grid-template-columns: 1fr; }
}
`;

/**
 * Main Neon Demo App
 */
const App: React.FC = () => {
  const [status, setStatus] = useState("Initializing…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [neonBox, setNeonBox] = useState<NeonDeviceBox | null>(null);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [activePatch, setActivePatch] = useState("Init");
  const [syxError, setSyxError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const suppressCustomRef = useRef(false); // Task 4 reads this to skip "Custom" during preset apply
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize OpenDAW
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { project: newProject, audioContext: ctx } = await initializeOpenDAW({
          onStatusUpdate: setStatus,
        });

        if (!mounted) return;

        setAudioContext(ctx);

        // Create the Neon instrument so MIDI notes produce sound.
        let audioUnitBox: AudioUnitBox | null = null;
        let instrumentBox: NeonDeviceBox | null = null;
        newProject.editing.modify(() => {
          const result = newProject.api.createInstrument(InstrumentFactories.Neon);
          audioUnitBox = result.audioUnitBox;
          instrumentBox = result.instrumentBox as NeonDeviceBox;
        });

        // Resolve the capture AFTER the creation transaction commits (repo rule).
        // armed is a runtime observable — no editing.modify() around setValue.
        const captureOption = audioUnitBox
          ? newProject.captureDevices.get((audioUnitBox as AudioUnitBox).address.uuid)
          : null;
        if (!captureOption || captureOption.isEmpty()) {
          setInitError("Could not arm the MIDI capture — keys would make no sound.");
          return;
        }
        captureOption.unwrap().armed.setValue(true);

        setNeonBox(instrumentBox);
        setProject(newProject);
        setStatus("Ready — play the keyboard");
      } catch (error) {
        console.error("Init error: " + String(error));
        if (mounted) {
          setInitError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleNoteOn = useCallback(async (note: number) => {
    if (audioContext && audioContext.state !== "running") await audioContext.resume();
    MidiDevices.softwareMIDIInput.sendNoteOn(note, 0.8);
    setActiveNotes(prev => new Set(prev).add(note));
  }, [audioContext]);

  const handleNoteOff = useCallback((note: number) => {
    MidiDevices.softwareMIDIInput.sendNoteOff(note);
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(note);
      return next;
    });
  }, []);

  const applyTone = useCallback((tone: CzTone, label: string) => {
    if (!project || !neonBox) return;
    // Deliberately through both codec directions: the applied patch is the projection
    // real hardware would receive, and encode/decode are exercised on every click.
    const roundTripped = CzSysex.decode(CzSysex.encode(tone));
    suppressCustomRef.current = true;
    project.editing.modify(() => NeonPreset.apply(neonBox, roundTripped));
    suppressCustomRef.current = false;
    setActivePatch(label);
    setSyxError(null);
  }, [project, neonBox]);

  const handleSyxFile = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!CzSysex.isToneDump(bytes)) {
      console.log(`Neon demo: rejected ${file.name} — not a CZ-101 tone dump`);
      setSyxError(`"${file.name}" is not a CZ-101 tone dump (.syx single-tone format).`);
      return;
    }
    applyTone(CzSysex.decode(bytes), `Imported: ${file.name}`);
  }, [applyTone]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleSyxFile(file);
  }, [handleSyxFile]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleSyxFile(file);
    e.target.value = "";
  }, [handleSyxFile]);

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PIANO_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <Container size="3" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="6" style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Instruments — Phase Distortion · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>
              NEON
            </h1>
            <p className="mc-intro">
              Play Neon, OpenDAW's Casio CZ-101 phase-distortion synthesizer. Load{" "}
              <code>.syx</code> tone dumps, tweak waves and ring/noise modulation, and
              inspect 8-stage envelopes.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>
                <strong>Initialization failed:</strong> {initError}
              </Callout.Text>
            </Callout.Root>
          ) : !project ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <Card>
              <Flex direction="column" gap="4">
                <Flex align="center" gap="2">
                  <Text size="2" weight="bold" color="gray">Software Keyboard</Text>
                  {neonBox && <Badge color="green" size="1">Neon loaded</Badge>}
                </Flex>
                <Text size="2" color="gray">
                  Click keys to play Neon's built-in init tone (line-1 saw, organ DCA).
                </Text>
                <Flex justify="center" style={{ overflow: "auto", padding: "8px 0" }}>
                  <PianoKeyboard
                    activeNotes={activeNotes}
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                    disabled={!project}
                  />
                </Flex>
              </Flex>
            </Card>
          )}

          {project && (
            <Card>
              <Flex direction="column" gap="4">
                <Flex align="center" justify="between">
                  <Text size="2" weight="bold" color="gray">Presets</Text>
                  <Badge color="amber" size="1">{activePatch}</Badge>
                </Flex>
                <Text size="2" color="gray">
                  Every click round-trips the tone through <code>CzSysex.encode</code> /{" "}
                  <code>CzSysex.decode</code> before applying it to Neon.
                </Text>
                <div className="ne-grid">
                  {NEON_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="ne-card"
                      data-active={activePatch === preset.name || undefined}
                      onClick={() => applyTone(preset.tone, preset.name)}
                      disabled={!neonBox}
                    >
                      <span className="ne-card-name">{preset.name}</span>
                      <span className="ne-card-desc">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </Flex>
            </Card>
          )}

          {project && (
            <Card>
              <Flex direction="column" gap="3">
                <Text size="2" weight="bold" color="gray">Load .syx Tone Dump</Text>
                <Text size="2" color="gray">
                  Drop a Casio CZ-101 single-tone <code>.syx</code> file, or click to browse.
                  Bank dumps are read as their last tone if the sysex framing matches;
                  anything else is rejected.
                </Text>
                <div
                  className="ne-dropzone"
                  data-active={isDragOver || undefined}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Text size="2" color="gray">Drop .syx file here or click to browse</Text>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".syx"
                  style={{ display: "none" }}
                  onChange={handleFileInputChange}
                />
                {syxError && (
                  <Callout.Root color="red" role="alert" size="1">
                    <Callout.Text>{syxError}</Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Card>
          )}

          {project && neonBox && (
            <NeonParamPanel
              project={project}
              neonBox={neonBox}
              setActivePatch={setActivePatch}
              suppressCustomRef={suppressCustomRef}
            />
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
