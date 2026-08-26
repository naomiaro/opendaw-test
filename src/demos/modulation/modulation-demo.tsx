import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import {
  LfoModulatorBoxAdapter,
  StepsModulatorBoxAdapter,
  type RandomModulatorBoxAdapter,
  type MacroModulatorBoxAdapter,
  type AutomatableParameterFieldAdapter,
  type ModulatorBoxAdapter,
} from "@opendaw/studio-adapters";
import type { ModulationBox } from "@opendaw/studio-boxes";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { buildModulationDemoContent, type ModulationDemoSetup } from "./modulationContent";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Flex, Grid, Text, Card, Button, Badge, Switch, Select, Slider, Separator,
} from "@radix-ui/themes";
import { CONSOLE_STYLES, CANVAS_COLORS } from "@/lib/design/consoleTheme";

// ---------------------------------------------------------------------------
// Live scope: plots the target parameter's controlled unit value (storage value
// plus the engine's streamed modulation sum) every frame. The engine free-runs
// modulation while the transport is paused, so the trace keeps moving.
// ---------------------------------------------------------------------------

const SCOPE_SECONDS = 4;
const SCOPE_FPS = 60;
const SCOPE_LEN = SCOPE_SECONDS * SCOPE_FPS;

const ModScope: React.FC<{
  param: AutomatableParameterFieldAdapter<number>;
  color: string;
}> = ({ param, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const samples = new Float32Array(SCOPE_LEN).fill(param.getUnitValue());
    let head = 0;
    const painter = new CanvasPainter(canvas, (_painter, context) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      context.clearRect(0, 0, w, h);
      context.fillStyle = CANVAS_COLORS.bg;
      context.fillRect(0, 0, w, h);
      // base-value reference line (the stored value the modulation moves around)
      const baseY = (1 - param.getUnitValue()) * (h - 8) + 4;
      context.strokeStyle = CANVAS_COLORS.gridSupporting;
      context.setLineDash([3, 4]);
      context.beginPath();
      context.moveTo(0, baseY);
      context.lineTo(w, baseY);
      context.stroke();
      context.setLineDash([]);
      // the trace, oldest → newest left → right
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      for (let i = 0; i < SCOPE_LEN; i++) {
        const value = samples[(head + i) % SCOPE_LEN];
        const x = (i / (SCOPE_LEN - 1)) * w;
        const y = (1 - value) * (h - 8) + 4;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    });
    const frame = AnimationFrame.add(() => {
      samples[head] = param.getControlledUnitValue();
      head = (head + 1) % SCOPE_LEN;
      painter.requestUpdate();
    });
    return () => {
      frame.terminate();
      painter.terminate();
    };
  }, [param, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: 72,
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
// Shared card chrome: enable switch + per-assignment depth slider + scope.
// ---------------------------------------------------------------------------

const ModulatorCard: React.FC<{
  project: Project;
  adapter: ModulatorBoxAdapter;
  assignment: ModulationBox;
  targetParam: AutomatableParameterFieldAdapter<number>;
  targetLabel: string;
  color: string;
  description: string;
  children?: React.ReactNode;
}> = ({ project, adapter, assignment, targetParam, targetLabel, color, description, children }) => {
  const [enabled, setEnabled] = useState(true);
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    const enabledSub = adapter.box.enabled.catchupAndSubscribe(obs => setEnabled(obs.getValue()));
    const depthSub = assignment.depth.catchupAndSubscribe(obs => setDepth(obs.getValue()));
    return () => {
      enabledSub.terminate();
      depthSub.terminate();
    };
  }, [adapter, assignment]);

  const onToggle = useCallback((on: boolean) => {
    project.editing.modify(() => adapter.box.enabled.setValue(on));
  }, [project, adapter]);

  // One transaction per slider sample is deliberate: this page has no undo UI, and
  // nothing subscribes to editing — the simplicity beats an append-folding scheme here.
  const onDepth = useCallback((value: number) => {
    project.editing.modify(() => assignment.depth.setValue(value));
  }, [project, assignment]);

  return (
    <Card>
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text size="3" weight="bold">{adapter.label}</Text>
              <Badge color="gray" variant="soft">→ {targetLabel}</Badge>
            </Flex>
            <Text size="1" color="gray">{description}</Text>
          </Flex>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </Flex>

        <ModScope param={targetParam} color={color} />

        <Flex direction="column" gap="1">
          <Flex justify="between">
            <Text size="1" color="gray">DEPTH</Text>
            <Text size="1" color="gray">{depth.toFixed(2)}</Text>
          </Flex>
          <Slider
            min={-1} max={1} step={0.01}
            value={[depth]}
            onValueChange={([value]) => onDepth(value)}
          />
        </Flex>

        {children}
      </Flex>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Kind-specific controls
// ---------------------------------------------------------------------------

const LfoControls: React.FC<{ project: Project; adapter: LfoModulatorBoxAdapter }> = ({ project, adapter }) => {
  const [shape, setShape] = useState(0);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    const shapeSub = adapter.box.shape.catchupAndSubscribe(obs => setShape(obs.getValue()));
    const rateSub = adapter.box.rateSync.catchupAndSubscribe(obs => setRate(obs.getValue()));
    return () => {
      shapeSub.terminate();
      rateSub.terminate();
    };
  }, [adapter]);

  return (
    <Flex gap="3">
      <Flex direction="column" gap="1" flexGrow="1">
        <Text size="1" color="gray">SHAPE</Text>
        <Select.Root value={String(shape)}
                     onValueChange={value => project.editing.modify(() => adapter.box.shape.setValue(Number(value)))}>
          <Select.Trigger />
          <Select.Content>
            {LfoModulatorBoxAdapter.ShapeStrings.map((label, index) => (
              <Select.Item key={index} value={String(index)}>{label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Flex direction="column" gap="1" flexGrow="1">
        <Text size="1" color="gray">RATE</Text>
        <Select.Root value={String(rate)}
                     onValueChange={value => project.editing.modify(() => adapter.box.rateSync.setValue(Number(value)))}>
          <Select.Trigger />
          <Select.Content>
            {LfoModulatorBoxAdapter.RateStrings.map((label, index) => (
              <Select.Item key={index} value={String(index)}>{label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
    </Flex>
  );
};

const StepsControls: React.FC<{ project: Project; adapter: StepsModulatorBoxAdapter }> = ({ project, adapter }) => {
  // Any committed edit re-reads the step fields (randomize here, or any other writer).
  const [, setVersion] = useState(0);
  const [direction, setDirection] = useState(0);

  useEffect(() => {
    const directionSub = adapter.box.direction.catchupAndSubscribe(obs => setDirection(obs.getValue()));
    // setVersion is NOT an editing.modify — safe inside editing.subscribe.
    const editSub = project.editing.subscribe(() => setVersion(v => v + 1));
    return () => {
      directionSub.terminate();
      editSub.terminate();
    };
  }, [project, adapter]);

  const steps = adapter.steps.slice(0, adapter.count).map(field => field.getValue());

  const onRandomize = useCallback(() => {
    project.editing.modify(() => adapter.randomize());
  }, [project, adapter]);

  return (
    <Flex direction="column" gap="2">
      <Flex align="end" style={{ gap: 2, height: 36 }}>
        {steps.map((value, index) => (
          <div key={index} style={{
            flex: 1,
            height: `${Math.max(6, value * 100)}%`,
            background: value > 0.01 ? "var(--mc-amber)" : "var(--mc-line)",
            opacity: value > 0.01 ? 0.4 + value * 0.6 : 1,
            borderRadius: 1,
          }} />
        ))}
      </Flex>
      <Flex gap="3" align="center">
        <Flex direction="column" gap="1" flexGrow="1">
          <Text size="1" color="gray">DIRECTION</Text>
          <Select.Root value={String(direction)}
                       onValueChange={value => project.editing.modify(() => adapter.box.direction.setValue(Number(value)))}>
            <Select.Trigger />
            <Select.Content>
              {StepsModulatorBoxAdapter.DirectionStrings.map((label, index) => (
                <Select.Item key={index} value={String(index)}>{label}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Button variant="soft" onClick={onRandomize} style={{ alignSelf: "end" }}>Randomize</Button>
      </Flex>
    </Flex>
  );
};

const RandomControls: React.FC<{ project: Project; adapter: RandomModulatorBoxAdapter }> = ({ project, adapter }) => {
  const [smooth, setSmooth] = useState(0);

  useEffect(() => {
    const sub = adapter.box.smooth.catchupAndSubscribe(obs => setSmooth(obs.getValue()));
    return () => sub.terminate();
  }, [adapter]);

  return (
    <Flex direction="column" gap="1">
      <Flex justify="between">
        <Text size="1" color="gray">SMOOTH</Text>
        <Text size="1" color="gray">{smooth.toFixed(2)}</Text>
      </Flex>
      <Slider
        min={0} max={1} step={0.01}
        value={[smooth]}
        onValueChange={([value]) =>
          project.editing.modify(() => adapter.box.smooth.setValue(value))}
      />
    </Flex>
  );
};

const MacroControls: React.FC<{ project: Project; adapter: MacroModulatorBoxAdapter }> = ({ project, adapter }) => {
  const [value, setValue] = useState(0.5);

  useEffect(() => {
    const sub = adapter.box.value.catchupAndSubscribe(obs => setValue(obs.getValue()));
    return () => sub.terminate();
  }, [adapter]);

  return (
    <Flex direction="column" gap="1">
      <Flex justify="between">
        <Text size="1" color="gray">MACRO VALUE — drag me</Text>
        <Text size="1" color="gray">{value.toFixed(2)}</Text>
      </Flex>
      <Slider
        min={0} max={1} step={0.01}
        value={[value]}
        onValueChange={([v]) =>
          project.editing.modify(() => adapter.box.value.setValue(v))}
      />
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
  const [setup, setSetup] = useState<ModulationDemoSetup | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { project, audioContext } = await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (disposed) { project.terminate(); return; }
        audioCtxRef.current = audioContext;
        const built = buildModulationDemoContent(project);
        setProject(project);
        setSetup(built);
        setStatus("Ready");
      } catch (err) {
        console.error("[modulation-demo] init failed:", String(err));
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

  const onPause = useCallback(() => {
    project?.engine.stop(false);
  }, [project]);

  const onStop = useCallback(() => {
    project?.engine.stop(true);
  }, [project]);

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <div className="mc-kicker">Modulation · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>MODULATORS</h1>
          <p className="mc-intro">
            The SDK's project-global modulation system: four modulator kinds created
            with <code>project.api.modulation</code> and assigned to device parameters
            with <code>assign(modulator, parameter.modulationTarget, depth)</code>. The
            engine adds each modulator's output — scaled by the assignment's bipolar
            depth — onto the parameter in normalized space, and streams the sum back so
            UI values (<code>getControlledUnitValue()</code>) show what you hear. Two
            assignments on the same parameter <em>sum</em> — the Macro card stacks onto
            the same cutoff the LFO wobbles.
          </p>

          <Card>
            <Flex align="center" gap="3" wrap="wrap">
              <Button onClick={onPlay} disabled={!setup || isPlaying}>▶ Play</Button>
              <Button variant="soft" onClick={onPause} disabled={!setup || !isPlaying}>⏸ Pause</Button>
              <Button variant="soft" onClick={onStop} disabled={!setup}>■ Stop</Button>
              <Separator orientation="vertical" />
              <Badge color={initError ? "red" : setup ? "amber" : "gray"}>
                {initError ? "Init failed" : setup ? "Ready" : "Booting…"}
              </Badge>
              <Text size="1" color="gray">{status}</Text>
            </Flex>
          </Card>

          <Card>
            <Text size="1" color="gray">
              <strong>Try pausing:</strong> the scopes keep moving. Modulation free-runs on
              its own clock while the transport stands still — automation holds its value,
              modulators do not. Each scope plots its target's controlled unit value; the
              dashed line is the stored base value the modulation moves around.
            </Text>
          </Card>

          {project && setup && (
            <Grid columns={{ initial: "1", sm: "2" }} gap="4">
              <ModulatorCard
                project={project}
                adapter={setup.lfo.adapter}
                assignment={setup.lfo.assignment}
                targetParam={setup.cutoff}
                targetLabel="filter cutoff"
                color={CANVAS_COLORS.amber}
                description="Synced sine wobble on the synth's low-pass filter."
              >
                <LfoControls project={project} adapter={setup.lfo.adapter} />
              </ModulatorCard>

              <ModulatorCard
                project={project}
                adapter={setup.steps.adapter}
                assignment={setup.steps.assignment}
                targetParam={setup.volume}
                targetLabel="channel volume"
                color={CANVAS_COLORS.green}
                description="Unipolar 16-step pattern, negative depth = rhythmic ducking."
              >
                <StepsControls project={project} adapter={setup.steps.adapter} />
              </ModulatorCard>

              <ModulatorCard
                project={project}
                adapter={setup.random.adapter}
                assignment={setup.random.assignment}
                targetParam={setup.panning}
                targetLabel="panning"
                color={CANVAS_COLORS.cyan}
                description="Seeded random walk, smoothed, drifting the stereo position."
              >
                <RandomControls project={project} adapter={setup.random.adapter} />
              </ModulatorCard>

              <ModulatorCard
                project={project}
                adapter={setup.macro.adapter}
                assignment={setup.macro.assignment}
                targetParam={setup.cutoff}
                targetLabel="filter cutoff"
                color={CANVAS_COLORS.playhead}
                description="A hand-driven source stacked on the LFO's target — modulation sums."
              >
                <MacroControls project={project} adapter={setup.macro.adapter} />
              </ModulatorCard>
            </Grid>
          )}
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
