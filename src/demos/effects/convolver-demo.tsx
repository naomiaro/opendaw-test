import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Project } from "@opendaw/studio-core";
import {
  ConvolverDeviceBoxAdapter,
  type AutomatableParameterFieldAdapter,
} from "@opendaw/studio-adapters";
import type { BooleanField } from "@opendaw/lib-box";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { DropZone } from "@/components/DropZone";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { IMPULSE_RESPONSES } from "@/lib/impulseResponses";
import {
  DEMO_BPM,
  buildConvolverDemoContent,
  type ConvolverDemoSetup,
  type CurrentIR,
} from "./convolverContent";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Flex, Grid, Text, Card, Button, Badge, Switch, Slider, Separator, Callout,
} from "@radix-ui/themes";
import { CONSOLE_STYLES, CANVAS_COLORS } from "@/lib/design/consoleTheme";

const CONVOLVER_STYLES = `
.cv-ir-card:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
`;

// ---------------------------------------------------------------------------
// Static IR envelope: min/max per pixel column of the rendered channel data.
// ---------------------------------------------------------------------------

const EnvelopeCanvas: React.FC<{ channel: Float32Array; color: string; height: number }> = ({
  channel, color, height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      context.clearRect(0, 0, w, h);
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, w, h);
      context.fillStyle = color;
      const columns = Math.max(1, Math.floor(w));
      const samplesPerColumn = channel.length / columns;
      for (let x = 0; x < columns; x++) {
        const from = Math.floor(x * samplesPerColumn);
        const to = Math.min(channel.length, Math.ceil((x + 1) * samplesPerColumn));
        let min = 0, max = 0;
        for (let i = from; i < to; i++) {
          const value = channel[i];
          if (value < min) min = value;
          if (value > max) max = value;
        }
        const yTop = ((1 - max) / 2) * h;
        const yBottom = ((1 - min) / 2) * h;
        context.fillRect(x, yTop, 1, Math.max(1, yBottom - yTop));
      }
    });
    painter.requestUpdate();
    return () => painter.terminate();
  }, [channel, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height,
        display: "block",
        boxSizing: "border-box",
        border: "1px solid var(--mc-line)",
        borderRadius: 4,
        background: CANVAS_COLORS.bg,
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// Parameter slider bound to an AutomatableParameterFieldAdapter (unit space,
// printed through the adapter's StringMapping — dB for wet/dry, ms for pre-delay).
// ---------------------------------------------------------------------------

const ParamSlider: React.FC<{
  project: Project;
  param: AutomatableParameterFieldAdapter<number>;
  label: string;
}> = ({ project, param, label }) => {
  const [unit, setUnit] = useState(() => param.getUnitValue());
  const [print, setPrint] = useState("");

  useEffect(() => {
    const sub = param.catchupAndSubscribe(p => {
      setUnit(p.getUnitValue());
      const { value, unit: suffix } = p.getPrintValue();
      setPrint(`${value} ${suffix}`.trim());
    });
    return () => sub.terminate();
  }, [param]);

  return (
    <Flex direction="column" gap="1" flexGrow="1">
      <Flex justify="between">
        <Text size="1" color="gray">{label}</Text>
        <Text size="1" color="gray">{print}</Text>
      </Flex>
      <Slider
        min={0} max={1} step={0.005}
        value={[unit]}
        onValueChange={([value]) => project.editing.modify(() => param.setUnitValue(value))}
      />
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Switch bound to a plain BooleanField (normalize / reverse / enabled / mutes).
// ---------------------------------------------------------------------------

const FieldSwitch: React.FC<{
  project: Project;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  field: BooleanField<any>;
  label: string;
  invert?: boolean;
}> = ({ project, field, label, invert = false }) => {
  // Initialize from the field — a false default paints every switch "off" for
  // one frame before the catch-up subscription runs after first paint
  const [checked, setChecked] = useState(() => (invert ? !field.getValue() : field.getValue()));

  useEffect(() => {
    const sub = field.catchupAndSubscribe(obs => setChecked(invert ? !obs.getValue() : obs.getValue()));
    return () => sub.terminate();
  }, [field, invert]);

  return (
    <Flex align="center" gap="2">
      <Switch
        checked={checked}
        onCheckedChange={on => project.editing.modify(() => field.setValue(invert ? !on : on))}
      />
      <Text size="1">{label}</Text>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [setup, setSetup] = useState<ConvolverDemoSetup | null>(null);
  const [currentIR, setCurrentIR] = useState<CurrentIR | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let disposed = false;
    let bootProject: Project | null = null;
    (async () => {
      try {
        const localAudioBuffers = new Map<string, AudioBuffer>();
        const { project, audioContext } = await initializeOpenDAW({
          localAudioBuffers,
          bpm: DEMO_BPM,
          onStatusUpdate: setStatus,
        });
        bootProject = project;
        if (disposed) { project.terminate(); return; }
        audioCtxRef.current = audioContext;
        const built = await buildConvolverDemoContent(project, audioContext, localAudioBuffers, setStatus);
        if (disposed) { project.terminate(); return; }
        setCurrentIR(built.selectGalleryIR(IMPULSE_RESPONSES[0].id, setDropError));
        setProject(project);
        setSetup(built);
        setStatus("Ready");
      } catch (err) {
        // Without the terminate, a failed content build leaves the engine
        // worklet running behind the error card
        bootProject?.terminate();
        console.error("[convolver-demo] init failed: " + String(err));
        setStatus(`Init error: ${String(err)}`);
        setInitError(true);
      }
    })();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const sub = project.engine.isPlaying.catchupAndSubscribe(obs => setIsPlaying(obs.getValue()));
    return () => sub.terminate();
  }, [project]);

  const onPlay = useCallback(() => {
    // initializeOpenDAW's engine facade resumes a suspended AudioContext before play().
    project?.engine.play();
  }, [project]);
  const onStop = useCallback(() => { project?.engine.stop(true); }, [project]);

  const onSelectIR = useCallback((specId: string) => {
    if (!setup) return;
    setDropError(null);
    try {
      setCurrentIR(setup.selectGalleryIR(specId, setDropError));
    } catch (err) {
      console.error("[convolver-demo] could not select IR: " + String(err));
      setDropError(`Could not load that impulse response: ${String(err)}`);
    }
  }, [setup]);

  const onRemoveIR = useCallback(() => {
    if (!setup) return;
    setDropError(null);
    try {
      setCurrentIR(setup.removeIR());
    } catch (err) {
      console.error("[convolver-demo] could not remove IR: " + String(err));
      setDropError(`Could not remove the impulse response: ${String(err)}`);
    }
  }, [setup]);

  const loadCustomIR = useCallback(async (file: File) => {
    const audioContext = audioCtxRef.current;
    if (!setup || !audioContext) return;
    let buffer: AudioBuffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn("[convolver-demo] could not decode dropped file: " + String(err));
      setDropError(`Could not decode "${file.name}" — drop a wav/mp3/m4a audio file.`);
      return;
    }
    // Separate try: a box-graph failure here is not the user's file's fault
    try {
      setDropError(null);
      setCurrentIR(setup.setCustomIR(file.name, buffer, setDropError));
    } catch (err) {
      console.error("[convolver-demo] could not load impulse response into the engine: " + String(err));
      setDropError(`Failed to load "${file.name}" into the engine: ${String(err)}`);
    }
  }, [setup]);

  // The ref is always set before currentIR can be non-null (init order) — no
  // fallback rate, so a wrong threshold can't silently mask an ordering bug
  const sampleRate = audioCtxRef.current?.sampleRate;
  const maxSeconds = sampleRate !== undefined
    ? ConvolverDeviceBoxAdapter.MAX_IR_FRAMES / sampleRate
    : null;
  const truncated = currentIR !== null && maxSeconds !== null && currentIR.seconds > maxSeconds;

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{CONVOLVER_STYLES}</style>
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <div className="mc-kicker">Convolution Reverb · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>CONVOLVER</h1>
          <p className="mc-intro">
            The SDK&apos;s <code>Convolver</code> device: zero-latency partitioned convolution
            against an impulse-response sample referenced by the device&apos;s{" "}
            <code>file</code> pointer. A drum loop and a lone clave feed a bus holding one
            Convolver — pick a synthesized space below, or drop your own IR. Wet, dry and
            pre-delay are automatable parameters; Normalize and Reverse are plain fields
            that retransform the IR, and the engine crossfades every IR swap seamlessly.
          </p>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Button onClick={onPlay} disabled={!setup || isPlaying}>▶ Play</Button>
              <Button variant="soft" onClick={onStop} disabled={!setup}>■ Stop</Button>
              <Separator orientation="vertical" />
              {setup && project && (
                <>
                  <FieldSwitch project={project} field={setup.drumUnitBox.mute} label="Drums" invert />
                  <FieldSwitch project={project} field={setup.oneShotUnitBox.mute} label="Clave" invert />
                  <Separator orientation="vertical" />
                </>
              )}
              <Badge color={initError ? "red" : setup ? "amber" : "gray"}>
                {initError ? "Init failed" : setup ? "Ready" : "Booting…"}
              </Badge>
              <Text size="1" color="gray">{status}</Text>
            </Flex>
          </Card>

          {project && setup && (
            <>
              <Grid columns={{ initial: "2", sm: "3" }} gap="3">
                {IMPULSE_RESPONSES.map(spec => {
                  const selected = currentIR?.specId === spec.id;
                  return (
                    <Card
                      key={spec.id}
                      className="cv-ir-card"
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      aria-label={`Load impulse response: ${spec.name}`}
                      onClick={() => onSelectIR(spec.id)}
                      onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectIR(spec.id);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        outline: selected ? "2px solid var(--mc-amber)" : undefined,
                      }}
                    >
                      <Flex direction="column" gap="2">
                        <Flex align="center" justify="between">
                          <Text size="2" weight="bold">{spec.name}</Text>
                          {selected && <Badge color="amber">Loaded</Badge>}
                        </Flex>
                        <EnvelopeCanvas
                          channel={setup.galleryChannels.get(spec.id)!}
                          color={selected ? CANVAS_COLORS.amber : CANVAS_COLORS.cyan}
                          height={48}
                        />
                        <Text size="1" color="gray">{spec.description}</Text>
                      </Flex>
                    </Card>
                  );
                })}
              </Grid>

              <Grid columns={{ initial: "1", sm: "2" }} gap="4">
                <DropZone
                  ariaLabel="Load a custom impulse response — drop an audio file or press Enter to browse"
                  onFile={file => void loadCustomIR(file)}
                  onInvalidDrop={() => setDropError("Drop an audio file (not a link, image or text selection).")}
                >
                  <Flex direction="column" gap="2">
                    <Flex align="center" justify="between">
                      <Text size="2" weight="bold">Impulse Response</Text>
                      <Button size="1" variant="soft" onClick={onRemoveIR} disabled={currentIR === null}>
                        Remove
                      </Button>
                    </Flex>
                    {currentIR ? (
                      <>
                        <EnvelopeCanvas channel={currentIR.channel} color={CANVAS_COLORS.amber} height={72} />
                        <Flex justify="between">
                          <Text size="1" color="gray">{currentIR.name}</Text>
                          <Text size="1" color={truncated ? "red" : "gray"}>
                            {truncated && maxSeconds !== null
                              ? `Truncated (max ${maxSeconds.toFixed(1)} s)`
                              : `${currentIR.seconds.toFixed(2)} s`}
                          </Text>
                        </Flex>
                      </>
                    ) : (
                      <Flex align="center" justify="center" style={{ height: 92 }}>
                        <Text size="1" color="gray">
                          No impulse loaded — the device passes only the dry path. Pick a
                          space above or drop an audio file here.
                        </Text>
                      </Flex>
                    )}
                    {dropError && (
                      <Callout.Root color="red" role="alert" size="1">
                        <Callout.Text>{dropError}</Callout.Text>
                      </Callout.Root>
                    )}
                    <Text size="1" color="gray">
                      Drop any audio file here (or click to browse) to use it as the
                      impulse response — try a clap recording, a synth stab, or a whole
                      drum break.
                    </Text>
                  </Flex>
                </DropZone>

                <Card>
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Text size="2" weight="bold">Device</Text>
                      <FieldSwitch project={project} field={setup.convolverBox.enabled} label="Enabled" />
                    </Flex>
                    <ParamSlider project={project} param={setup.adapter.namedParameter.preDelay} label="PRE-DELAY" />
                    <ParamSlider project={project} param={setup.adapter.namedParameter.wet} label="WET" />
                    <ParamSlider project={project} param={setup.adapter.namedParameter.dry} label="DRY" />
                    <Separator size="4" />
                    <Flex gap="4">
                      <FieldSwitch project={project} field={setup.convolverBox.normalize} label="Normalize" />
                      <FieldSwitch project={project} field={setup.convolverBox.reverse} label="Reverse" />
                    </Flex>
                    <Text size="1" color="gray">
                      Normalize and Reverse are deliberately not automatable — each toggle
                      retransforms the impulse response, and the engine crossfades to the
                      new tail without a dropout. Mute the drums and listen to the clave
                      alone to hear each change in isolation.
                    </Text>
                  </Flex>
                </Card>
              </Grid>
            </>
          )}
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
