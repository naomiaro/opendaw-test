import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { buildWasmDemoContent } from "./patternContent";
import "@radix-ui/themes/styles.css";
import { Theme, Container, Flex, Text, Card, Button, Badge, Switch, Separator } from "@radix-ui/themes";
import { CONSOLE_STYLES } from "@/lib/design/consoleTheme";

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [cpuPct, setCpuPct] = useState(0);
  const [dropouts, setDropouts] = useState<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const perfLifeRef = useRef<{ terminate: () => void } | null>(null);
  // Dropout count read at the moment reporting turned on, so the displayed figure is
  // dropouts since reporting started, not the AudioContext's lifetime total.
  const dropoutBaseRef = useRef(0);

  // ---- Init ----
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { project, audioContext } = await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (disposed) { project.terminate(); return; }
        audioCtxRef.current = audioContext;
        buildWasmDemoContent(project);
        setProject(project);
        setStatus("Ready");
      } catch (err) {
        console.error("[wasm-engine-demo] init failed:", String(err));
        setStatus(`Init error: ${String(err)}`);
        setInitError(true);
      }
    })();
    return () => { disposed = true; };
  }, []);

  // Reflect transport state.
  useEffect(() => {
    if (!project) { return; }
    const sub = project.engine.isPlaying.catchupAndSubscribe((obs) => setIsPlaying(obs.getValue()));
    return () => sub.terminate();
  }, [project]);

  // ---- Transport (REAL click required to start the AudioContext) ----
  const onPlay = useCallback(async () => {
    if (!project) { return; }
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "running") { await ctx.resume(); }
    project.engine.play();
  }, [project]);

  const onStop = useCallback(() => {
    project?.engine.stop(true);
  }, [project]);

  // ---- Performance reporting toggle (drives settings.debug.dspLoadMeasurement) ----
  const onToggleReporting = useCallback((on: boolean) => {
    if (!project) { return; }
    setReporting(on);
    project.engine.preferences.settings.debug.dspLoadMeasurement = on;

    // Tear down any prior perf loop.
    perfLifeRef.current?.terminate();
    perfLifeRef.current = null;

    if (!on) { setCpuPct(0); setDropouts(null); return; }

    const engine = project.engine;
    const ctx = audioCtxRef.current;
    // Chromium-only dropout counter. Display dropouts since reporting turned on, not the
    // AudioContext lifetime total.
    const stats = (ctx as unknown as { playbackStats?: { underrunEvents: number } } | null)?.playbackStats;
    dropoutBaseRef.current = stats ? stats.underrunEvents : 0;
    setDropouts(stats ? 0 : null);

    // engine.cpuLoad already stores a rounded percentage (0-100+), NOT a 0-1 fraction —
    // see node_modules/@opendaw/studio-core/dist/EngineWorklet.js: cpuLoad.setValue(Math.round((maxMs/budgetMs)*100)).
    const cpuSub = engine.cpuLoad.catchupAndSubscribe((obs) =>
      setCpuPct(Math.round(obs.getValue())),
    );
    let lastShown: number | null = stats ? 0 : null;
    const frame = AnimationFrame.add(() => {
      // Dropouts only accrue during playback — skip the read/setState while stopped (and only
      // setState on change, never per frame).
      if (!stats || !engine.isPlaying.getValue()) { return; }
      const delta = stats.underrunEvents - dropoutBaseRef.current;
      if (delta !== lastShown) { lastShown = delta; setDropouts(delta); }
    });
    perfLifeRef.current = { terminate: () => { cpuSub.terminate(); frame.terminate(); } };
  }, [project]);

  useEffect(() => () => { perfLifeRef.current?.terminate(); }, []);

  return (
    <Theme appearance="dark" accentColor="amber" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <Container size="4" style={{ padding: "2rem", minHeight: "100vh" }}>
        <GitHubCorner />
        <BackLink />

        <Flex direction="column" gap="4">
          <div className="mc-kicker">Engine — WASM · OpenDAW SDK</div>
          <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>WASM ENGINE</h1>
          <p className="mc-intro">
            A Vaporisateur synth loop playing through the WASM (Rust) audio engine — the only
            engine these demos run; the TypeScript engine is deprecated upstream and no longer
            wired here. <code>initializeOpenDAW</code> installs and compiles the engine before
            the first <code>EngineWorklet</code> boots. Toggle{" "}
            <code>settings.debug.dspLoadMeasurement</code> below to watch DSP load live; it is
            off by default because measuring load perturbs the load it measures.
          </p>

          {/* Engine badge */}
          <Card>
            <Flex direction="column" gap="1">
              <Text size="1" color="gray">ACTIVE ENGINE</Text>
              <Flex align="center" gap="2">
                <Badge color={initError ? "red" : project ? "amber" : "gray"} size="2">
                  {initError ? "Init failed" : project ? "WASM (Rust)" : "Booting…"}
                </Badge>
                <Text size="1" color="gray">
                  {initError
                    ? "see status line below"
                    : project
                      ? "the only engine — TypeScript engine removed"
                      : "compiling WASM…"}
                </Text>
              </Flex>
            </Flex>
          </Card>

          {/* Transport */}
          <Card>
            <Flex align="center" gap="3">
              <Button onClick={onPlay} disabled={!project || isPlaying}>▶ Play</Button>
              <Button variant="soft" onClick={onStop} disabled={!project || !isPlaying}>■ Stop</Button>
              <Separator orientation="vertical" />
              <Text size="1" color="gray">{status}</Text>
            </Flex>
          </Card>

          {/* Performance reporting */}
          <Card>
            <Flex align="center" justify="between" mb={reporting ? "3" : "0"}>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">Performance reporting</Text>
                <Text size="1" color="gray">
                  Off by default — measuring DSP load perturbs the load it measures.
                </Text>
              </Flex>
              <Switch checked={reporting} disabled={!project}
                      onCheckedChange={(v) => onToggleReporting(v)} />
            </Flex>
            {reporting && (
              <Flex gap="5" mt="2">
                <Flex direction="column">
                  <Text size="1" color="gray">DSP LOAD</Text>
                  <Text size="6" weight="bold">{cpuPct}%</Text>
                </Flex>
                <Flex direction="column">
                  <Text size="1" color="gray">DROPOUTS</Text>
                  <Text size="6" weight="bold">
                    {dropouts === null ? "n/a" : dropouts}
                  </Text>
                  {dropouts === null && <Text size="1" color="gray">Chromium only</Text>}
                </Flex>
              </Flex>
            )}
          </Card>
        </Flex>

        <MoisesLogo />
      </Container>
    </Theme>
  );
};

const root = createRoot(document.getElementById("root") as HTMLElement);
root.render(<App />);
