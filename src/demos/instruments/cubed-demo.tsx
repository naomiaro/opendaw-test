import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { asInstanceOf } from "@opendaw/lib-std";
import { MidiKeys } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { Project } from "@opendaw/studio-core";
import {
  InstrumentFactories,
  CubedDeviceBoxAdapter,
  CubedPatternData,
  CubedRandomize,
  CubedStep,
  AblPattern,
  LfoModulatorBoxAdapter,
  type CubedContour,
  type CubedRandomizeOptions,
  type AutomatableParameterFieldAdapter,
} from "@opendaw/studio-adapters";
import { CubedDeviceBox, LfoModulatorBox, type ModulationBox } from "@opendaw/studio-boxes";
import { initializeOpenDAW } from "@/lib/projectSetup";
import { CanvasPainter } from "@/lib/CanvasPainter";
import { GitHubCorner } from "@/components/GitHubCorner";
import { MoisesLogo } from "@/components/MoisesLogo";
import { BackLink } from "@/components/BackLink";
import { CANVAS_COLORS, CONSOLE_STYLES } from "@/lib/design/consoleTheme";
import { CUBED_PRESETS, type CubedPreset } from "./cubedPatterns";
import "@radix-ui/themes/styles.css";
import {
  Theme, Container, Flex, Grid, Text, Card, Button, Badge, Switch, Select,
  SegmentedControl, Slider, Separator, Callout, TextArea,
} from "@radix-ui/themes";

const STEPS_PER_PAGE = 16;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// indexOf guards against a future label rename; fields don't clamp, so a raw -1
// would be stored silently (repo rule: box numeric constraints do not clamp).
const LFO_RATE_1_BAR = (() => {
  const index = LfoModulatorBoxAdapter.RateStrings.indexOf("1 bar");
  if (index < 0) console.error("Cubed demo: RateStrings no longer contains '1 bar' — falling back to index 4");
  return index >= 0 ? index : 4;
})();

// ---------------------------------------------------------------------------
// Page styles — mastering-console editorial (docs/design/2026-06-11-…md).
// The step grid is this page's signature element: it IS the pattern data.
// ---------------------------------------------------------------------------

const PAGE_STYLES = `
.cb-grid-scroll { overflow-x: auto; padding-bottom: 4px; }
.cb-grid {
  display: grid;
  grid-template-columns: 64px repeat(${STEPS_PER_PAGE}, minmax(34px, 1fr));
  gap: 1px;
  background: var(--mc-line);
  border: 1px solid var(--mc-line);
  min-width: 640px;
}
.cb-grid > * { background: var(--mc-panel); }
.cb-rowlabel {
  font-family: var(--mc-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mc-label);
  display: flex;
  align-items: center;
  padding-left: 8px;
}
.cb-index {
  font-family: var(--mc-mono);
  font-size: 10px;
  color: var(--mc-label);
  text-align: center;
  padding: 4px 0;
}
.cb-index.beyond { background: var(--mc-bg); }
.cb-play { height: 6px; background: var(--mc-bg); }
.cb-play.on { background: ${CANVAS_COLORS.playhead}; }
.cb-cell {
  font-family: var(--mc-mono);
  font-size: 11px;
  color: var(--mc-text);
  background: var(--mc-panel);
  border: none;
  padding: 7px 0;
  text-align: center;
  cursor: pointer;
}
.cb-cell:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: -2px; }
.cb-note { cursor: ns-resize; user-select: none; touch-action: none; }
.cb-toggle { color: var(--mc-label); }
.cb-toggle.on { color: var(--mc-bg); font-weight: 600; }
.cb-toggle.gate.on { background: var(--mc-amber); }
.cb-toggle.slide.on { background: var(--mc-cyan); }
.cb-toggle.accent.on { background: var(--mc-rose); }
/* Beyond-length cells dim via a darker ground, not opacity — the buttons stay
   live, so their text must hold the 4.5:1 floor (label on bg = 5.2:1). */
.cb-col-beyond { background: var(--mc-bg); color: var(--mc-label); }
.cb-note-input {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--mc-mono);
  font-size: 11px;
  text-align: center;
  color: var(--mc-text);
  background: var(--mc-bg);
  border: 1px solid var(--mc-amber);
  padding: 6px 0;
}
.cb-dropzone {
  border: 1px dashed var(--mc-line-bright);
  border-radius: 6px;
  padding: 14px;
  text-align: center;
  cursor: pointer;
}
.cb-dropzone[data-active] { border-color: var(--mc-amber); background: var(--mc-panel-hover); }
.cb-dropzone:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.cb-preset {
  background: var(--mc-panel);
  border: 1px solid var(--mc-line);
  border-radius: 6px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cb-preset:hover { border-color: var(--mc-line-bright); background: var(--mc-panel-hover); }
.cb-preset:focus-visible { outline: 2px solid var(--mc-amber); outline-offset: 2px; }
.cb-preset[data-active] { border-color: var(--mc-amber); }
.cb-preset-name {
  font-family: var(--mc-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--mc-text);
}
.cb-preset-desc { font-size: 12px; color: var(--mc-muted); line-height: 1.4; }
@media (prefers-reduced-motion: no-preference) {
  .cb-preset { transition: border-color 120ms, background 120ms; }
}
`;

// ---------------------------------------------------------------------------
// Parameter binding: one hook per bound control (repo convention). Reads catch
// up immediately; writes commit a transaction; preset applies flow back through
// the same subscription and snap the slider.
// ---------------------------------------------------------------------------

// The demo binds through the unit-value API only (getUnitValue/setUnitValue/
// getPrintValue), which is independent of the field's primitive type — Cubed's
// unipolar params are declared AutomatableParameterFieldAdapter<PrimitiveValues>.
type UnitParam = AutomatableParameterFieldAdapter;

function formatPrint(param: UnitParam): string {
  const { value, unit } = param.getPrintValue();
  return unit ? `${value} ${unit}` : value;
}

function useParamUnit(
  project: Project,
  param: UnitParam,
): [number, string, (v: number) => void] {
  const [unit, setUnit] = useState(() => param.getUnitValue());
  const [print, setPrint] = useState(() => formatPrint(param));
  useEffect(() => {
    const sub = param.catchupAndSubscribe((p) => {
      setUnit(p.getUnitValue());
      setPrint(formatPrint(p));
    });
    return () => sub.terminate();
  }, [param]);
  const write = useCallback((v: number) => {
    project.editing.modify(() => param.setUnitValue(v));
  }, [project, param]);
  return [unit, print, write];
}

const ParamSlider: React.FC<{
  project: Project;
  param: UnitParam;
  label: string;
}> = ({ project, param, label }) => {
  const [unit, print, write] = useParamUnit(project, param);
  return (
    <Flex direction="column" gap="1">
      <Flex justify="between">
        <Text size="1" color="gray">{label}</Text>
        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{print}</Text>
      </Flex>
      <Slider min={0} max={1} step={0.005} value={[unit]} onValueChange={([v]) => write(v)} />
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Live cutoff scope: plots the controlled unit value (stored value + streamed
// modulation sum) so the LFO sweep is visible against the knob's base value.
// Same pattern as the modulation demo's ModScope.
// ---------------------------------------------------------------------------

const SCOPE_SECONDS = 4;
const SCOPE_LEN = SCOPE_SECONDS * 60;

const CutoffScope: React.FC<{ param: UnitParam }> = ({ param }) => {
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
      const baseY = (1 - param.getUnitValue()) * (h - 8) + 4;
      context.strokeStyle = CANVAS_COLORS.gridSupporting;
      context.setLineDash([3, 4]);
      context.beginPath();
      context.moveTo(0, baseY);
      context.lineTo(w, baseY);
      context.stroke();
      context.setLineDash([]);
      context.strokeStyle = CANVAS_COLORS.amber;
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
  }, [param]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Live filter cutoff value with LFO modulation"
      style={{
        width: "100%", height: 64, display: "block", boxSizing: "border-box",
        border: "1px solid var(--mc-line)", borderRadius: 4, background: CANVAS_COLORS.bg,
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// The step grid — note / gate / slide / accent rows over 16 visible columns,
// with a playhead row lit from the device's live step stream.
// ---------------------------------------------------------------------------

const NoteCell: React.FC<{
  note: number;
  beyond: boolean;
  stepNumber: number;
  onTranspose: (semitones: number) => void;
  /** fold: true = commit via editing.append() so a whole drag is ONE undo entry */
  onSet: (note: number, fold: boolean) => void;
}> = ({ note, beyond, stepNumber, onTranspose, onSet }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  // Drag bookkeeping lives in refs — only an actual note change commits (and
  // re-renders via the parent's version bump), not every pointermove. `committed`
  // folds all but the first change of a gesture into one undo entry.
  const dragRef = useRef<{ startY: number; startNote: number; pointerId: number; committed: boolean } | null>(null);
  // Escape must not commit: unmounting a focused input fires blur in some
  // browsers, which would apply the typed text anyway.
  const cancelledRef = useRef(false);

  const commitText = useCallback(() => {
    setEditing(false);
    if (cancelledRef.current) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const parsed = CubedPatternData.parseNote(trimmed);
    if (parsed.nonEmpty()) onSet(parsed.unwrap(), false);
  }, [text, onSet]);

  if (editing) {
    return (
      <input
        className="cb-note-input"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        value={text}
        aria-label={`Note for step ${stepNumber}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitText();
          if (e.key === "Escape") {
            cancelledRef.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className={`cb-cell cb-note${beyond ? " cb-col-beyond" : ""}`}
      aria-label={`Step ${stepNumber} note ${MidiKeys.toFullString(note)} — drag or use arrow keys to transpose, double-click to type`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragRef.current = { startY: e.clientY, startNote: note, pointerId: e.pointerId, committed: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const semitones = Math.round((drag.startY - e.clientY) / 6);
        const next = Math.max(0, Math.min(127, drag.startNote + semitones));
        if (next !== note) {
          onSet(next, drag.committed);
          drag.committed = true;
        }
      }}
      onPointerUp={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      }}
      // A cancelled gesture (touch takeover, system gesture) must clear the drag
      // anchor, or the next plain hover keeps transposing off the stale start note.
      onPointerCancel={(e) => {
        if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      }}
      onLostPointerCapture={() => { dragRef.current = null; }}
      onDoubleClick={() => {
        cancelledRef.current = false;
        setText(MidiKeys.toFullString(note));
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); onTranspose(e.shiftKey ? 12 : 1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); onTranspose(e.shiftKey ? -12 : -1); }
        else if (e.key === "Enter") {
          cancelledRef.current = false;
          setText(MidiKeys.toFullString(note));
          setEditing(true);
        }
      }}
    >
      {MidiKeys.toFullString(note)}
    </button>
  );
};

const StepGrid: React.FC<{
  project: Project;
  adapter: CubedDeviceBoxAdapter;
  page: number;
  /** any hand edit un-marks the active preset highlight */
  onPatternEdited: () => void;
}> = ({ project, adapter, page, onPatternEdited }) => {
  const playCellsRef = useRef<Array<HTMLDivElement | null>>([]);
  const playStepRef = useRef(-1);
  const pageRef = useRef(page);
  pageRef.current = page;

  const applyPlayhead = useCallback(() => {
    const base = pageRef.current * STEPS_PER_PAGE;
    playCellsRef.current.forEach((cell, column) => {
      cell?.classList.toggle("on", base + column === playStepRef.current);
    });
  }, []);

  // Playhead: the device streams its current step at address field 0. Direct
  // DOM class toggles — no setState per stream packet (repo overlay rule).
  useEffect(() => {
    const sub = project.liveStreamReceiver.subscribeIntegers(
      adapter.address.append(0),
      (array) => {
        playStepRef.current = array[0];
        applyPlayhead();
      },
    );
    return () => sub.terminate();
  }, [project, adapter, applyPlayhead]);

  useEffect(applyPlayhead, [page, applyPlayhead]);

  // fold: editing.append() commits separately but folds into the previous
  // transaction's undo entry — a note drag becomes ONE undo step, not one per pixel.
  const writeStep = useCallback((absIndex: number, mutate: (step: CubedStep) => void, fold = false) => {
    const commit = fold
      ? (fn: () => void) => project.editing.append(fn)
      : (fn: () => void) => project.editing.modify(fn);
    commit(() => {
      const field = adapter.currentPattern().steps.getField(absIndex);
      const step = CubedStep.unpack(field.getValue());
      mutate(step);
      field.setValue(CubedStep.pack(step));
    });
    onPatternEdited();
  }, [project, adapter, onPatternEdited]);

  // Rendered synchronously from the box graph; the parent re-renders this
  // subtree after every committed transaction (editing.subscribe version bump).
  const pattern = adapter.currentPattern();
  const length = pattern.length.getValue();
  const base = page * STEPS_PER_PAGE;
  const columns = Array.from({ length: STEPS_PER_PAGE }, (_, column) => {
    const absIndex = base + column;
    return {
      absIndex,
      stepNumber: absIndex + 1,
      beyond: absIndex >= length,
      step: CubedStep.unpack(pattern.steps.getField(absIndex).getValue()),
    };
  });

  const toggleRow = (
    label: string,
    key: "active" | "slide" | "accent",
    className: string,
  ) => (
    <React.Fragment key={key}>
      <div className="cb-rowlabel">{label}</div>
      {columns.map(({ absIndex, stepNumber, beyond, step }) => (
        <button
          key={absIndex}
          type="button"
          className={`cb-cell cb-toggle ${className}${step[key] ? " on" : ""}${beyond ? " cb-col-beyond" : ""}`}
          aria-pressed={step[key]}
          aria-label={`Step ${stepNumber} ${label.toLowerCase()}`}
          onClick={() => writeStep(absIndex, (s) => { s[key] = !s[key]; })}
        >
          {step[key] ? "●" : "·"}
        </button>
      ))}
    </React.Fragment>
  );

  return (
    <div className="cb-grid-scroll">
      <div className="cb-grid">
        <div className="cb-rowlabel">Step</div>
        {columns.map(({ absIndex, stepNumber, beyond }) => (
          <div key={absIndex} className={`cb-index${beyond ? " beyond" : ""}`}>{stepNumber}</div>
        ))}
        <div className="cb-rowlabel" aria-hidden="true" />
        {columns.map(({ absIndex }, column) => (
          <div
            key={absIndex}
            className="cb-play"
            ref={(el) => { playCellsRef.current[column] = el; }}
          />
        ))}
        <div className="cb-rowlabel">Note</div>
        {columns.map(({ absIndex, stepNumber, beyond, step }) => (
          <NoteCell
            key={absIndex}
            note={step.note}
            beyond={beyond}
            stepNumber={stepNumber}
            onTranspose={(semitones) => writeStep(absIndex, (s) => {
              s.note = Math.max(0, Math.min(127, s.note + semitones));
            })}
            onSet={(note, fold) => writeStep(absIndex, (s) => { s.note = note; }, fold)}
          />
        ))}
        {toggleRow("Gate", "active", "gate")}
        {toggleRow("Slide", "slide", "slide")}
        {toggleRow("Accent", "accent", "accent")}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Random generator options → CubedRandomizeOptions
// ---------------------------------------------------------------------------

const GeneratorPanel: React.FC<{ onRandomize: (options: CubedRandomizeOptions) => void }> = ({ onRandomize }) => {
  const [root, setRoot] = useState(CubedRandomize.Default.root);
  const [scaleIndex, setScaleIndex] = useState(() =>
    Math.max(0, MidiKeys.StockScales.findIndex((s) => s === CubedRandomize.Default.scale)));
  const [contour, setContour] = useState<CubedContour>(CubedRandomize.Default.contour);
  const [octave, setOctave] = useState(CubedRandomize.Default.octave);
  const [octaves, setOctaves] = useState(CubedRandomize.Default.octaves);
  const [density, setDensity] = useState(CubedRandomize.Default.density);
  const [accent, setAccent] = useState(CubedRandomize.Default.accent);
  const [slide, setSlide] = useState(CubedRandomize.Default.slide);
  const [motif, setMotif] = useState(CubedRandomize.Default.motif);
  const [rootFirst, setRootFirst] = useState(CubedRandomize.Default.rootFirst);

  const fire = useCallback(() => {
    onRandomize({
      root,
      scale: MidiKeys.StockScales[scaleIndex],
      octave,
      octaves,
      density,
      accent,
      slide,
      motif,
      contour,
      rootFirst,
    });
  }, [onRandomize, root, scaleIndex, octave, octaves, density, accent, slide, motif, contour, rootFirst]);

  const probabilitySlider = (label: string, value: number, set: (v: number) => void) => (
    <Flex direction="column" gap="1">
      <Flex justify="between">
        <Text size="1" color="gray">{label}</Text>
        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{Math.round(value * 100)}%</Text>
      </Flex>
      <Slider min={0} max={1} step={0.05} value={[value]} onValueChange={([v]) => set(v)} />
    </Flex>
  );

  return (
    <Flex direction="column" gap="3">
      <Grid columns={{ initial: "2", sm: "4" }} gap="3">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">Root</Text>
          <Select.Root value={String(root)} onValueChange={(v) => setRoot(Number(v))}>
            <Select.Trigger />
            <Select.Content>
              {NOTE_NAMES.map((name, index) => (
                <Select.Item key={name} value={String(index)}>{name}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">Scale</Text>
          <Select.Root value={String(scaleIndex)} onValueChange={(v) => setScaleIndex(Number(v))}>
            <Select.Trigger />
            <Select.Content>
              {MidiKeys.StockScales.map((scale, index) => (
                <Select.Item key={scale.name} value={String(index)}>{scale.name}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">Contour</Text>
          <Select.Root value={contour} onValueChange={(v) => setContour(v as CubedContour)}>
            <Select.Trigger />
            <Select.Content>
              {CubedRandomize.Contours.map((name) => (
                <Select.Item key={name} value={name}>{name}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">Motif</Text>
          <Select.Root value={String(motif)} onValueChange={(v) => setMotif(Number(v))}>
            <Select.Trigger />
            <Select.Content>
              {CubedRandomize.Motifs.map((value) => (
                <Select.Item key={value} value={String(value)}>{value === 0 ? "Off" : String(value)}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </Grid>
      <Grid columns={{ initial: "1", sm: "3" }} gap="3">
        {probabilitySlider("Density", density, setDensity)}
        {probabilitySlider("Accent", accent, setAccent)}
        {probabilitySlider("Slide", slide, setSlide)}
      </Grid>
      <Flex gap="4" align="center" wrap="wrap">
        <Flex align="center" gap="2">
          <Text size="1" color="gray">Octave</Text>
          <SegmentedControl.Root value={String(octave)} onValueChange={(v) => setOctave(Number(v))}>
            {[0, 1, 2, 3].map((value) => (
              <SegmentedControl.Item key={value} value={String(value)}>{value}</SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
        <Flex align="center" gap="2">
          <Text size="1" color="gray">Spanning</Text>
          <SegmentedControl.Root value={String(octaves)} onValueChange={(v) => setOctaves(Number(v))}>
            {[1, 2, 3, 4].map((value) => (
              <SegmentedControl.Item key={value} value={String(value)}>{value}</SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
        </Flex>
        <Flex align="center" gap="2">
          <Switch checked={rootFirst} onCheckedChange={setRootFirst} size="1" />
          <Text size="1" color="gray">Start on tonic</Text>
        </Flex>
        <Button onClick={fire}>⚂ Randomize</Button>
      </Flex>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Pattern exchange: JSON text round-trip + ABL .pat import
// ---------------------------------------------------------------------------

const ExchangePanel: React.FC<{
  project: Project;
  adapter: CubedDeviceBoxAdapter;
  onPatternEdited: () => void;
}> = ({ project, adapter, onPatternEdited }) => {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportJson = useCallback(() => {
    const json = CubedPatternData.toJSON(adapter.readCurrentPattern());
    setText(json);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(json).then(
        () => setMessage({ kind: "ok", text: "Pattern exported — also copied to the clipboard." }),
        () => setMessage({ kind: "ok", text: "Pattern exported to the text box (clipboard unavailable)." }),
      );
    } else {
      setMessage({ kind: "ok", text: "Pattern exported to the text box." });
    }
  }, [adapter]);

  const applyJson = useCallback(() => {
    const parsed = CubedPatternData.fromJSON(text);
    if (parsed.isEmpty()) {
      setMessage({ kind: "error", text: "That text does not read as a Cubed pattern — the current pattern is unchanged." });
      return;
    }
    project.editing.modify(() => adapter.writeCurrentPattern(parsed.unwrap()));
    onPatternEdited();
    setMessage({ kind: "ok", text: "Pattern applied from JSON." });
  }, [project, adapter, text, onPatternEdited]);

  const loadAblFile = useCallback(async (file: File) => {
    try {
      const content = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
      const parsed = AblPattern.parse(content);
      if (parsed.steps.length === 0) {
        setMessage({ kind: "error", text: `"${file.name}" is not a readable ABL pattern.` });
        return;
      }
      project.editing.modify(() => adapter.writeCurrentPattern(parsed));
      onPatternEdited();
      // writeCurrentPattern clamps to 64 steps — report what was actually written.
      const applied = Math.min(parsed.length, 64);
      const truncated = parsed.length > 64 ? `, truncated from ${parsed.length}` : "";
      setMessage({ kind: "ok", text: `Loaded ${file.name} (${applied} steps${truncated}) into the current pattern.` });
    } catch (error) {
      console.error(`Cubed demo: failed to read ${file.name}: ` + String(error));
      setMessage({ kind: "error", text: `Could not read "${file.name}" — ${error instanceof Error ? error.message : String(error)}` });
    }
  }, [project, adapter, onPatternEdited]);

  return (
    <Flex direction="column" gap="3">
      <Text size="2" color="gray">
        The whole pattern travels as readable JSON via{" "}
        <code>CubedPatternData.toJSON / fromJSON</code> — paste it into a chat with an
        AI, ask for a variation, and apply the answer. Reading is lenient: notes as
        names (<code>C2</code>) or MIDI numbers, missing flags count as off.
      </Text>
      <TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"type": "cubed-pattern", "version": 1, "length": 16, "steps": [...]}'
        rows={6}
        style={{ fontFamily: "var(--mc-mono)", fontSize: 12 }}
        aria-label="Pattern JSON"
      />
      <Flex gap="2" wrap="wrap">
        <Button variant="soft" onClick={exportJson}>Export current pattern</Button>
        <Button onClick={applyJson} disabled={text.trim().length === 0}>Apply JSON</Button>
      </Flex>
      <Separator size="4" />
      <Text size="2" color="gray">
        Or import an AudioRealism Bass Line <code>.pat</code> file — the SDK's{" "}
        <code>AblPattern.parse</code> reads both the ABL2 and ABL3 dialects.
      </Text>
      <div
        className="cb-dropzone"
        role="button"
        tabIndex={0}
        aria-label="Load an ABL .pat pattern file"
        data-active={isDragOver || undefined}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void loadAblFile(file);
          else setMessage({ kind: "error", text: "Nothing droppable — drop a .pat file." });
        }}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <Text size="2" color="gray">Drop an ABL .pat file here or click to browse</Text>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pat"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loadAblFile(file);
          e.target.value = "";
        }}
      />
      {message && (
        <Callout.Root color={message.kind === "error" ? "red" : "green"} size="1" role={message.kind === "error" ? "alert" : "status"}>
          <Callout.Text>{message.text}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// LFO on cutoff — the acid classic. Created lazily on first enable, then the
// modulator's enabled flag toggles it. One transaction creates + assigns
// (assign's index read on the fresh modulator's empty hub is safe).
// ---------------------------------------------------------------------------

type LfoSetup = {
  readonly box: LfoModulatorBox;
  readonly assignment: ModulationBox;
};

const LfoPanel: React.FC<{
  project: Project;
  adapter: CubedDeviceBoxAdapter;
}> = ({ project, adapter }) => {
  const [setup, setSetup] = useState<LfoSetup | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState(LFO_RATE_1_BAR);
  const [depth, setDepth] = useState(0.35);
  const [lfoError, setLfoError] = useState<string | null>(null);
  const cutoff = adapter.namedParameter.cutoff;

  useEffect(() => {
    if (!setup) return undefined;
    const enabledSub = setup.box.enabled.catchupAndSubscribe((obs) => setEnabled(obs.getValue()));
    const rateSub = setup.box.rateSync.catchupAndSubscribe((obs) => setRate(obs.getValue()));
    const depthSub = setup.assignment.depth.catchupAndSubscribe((obs) => setDepth(obs.getValue()));
    return () => {
      enabledSub.terminate();
      rateSub.terminate();
      depthSub.terminate();
    };
  }, [setup]);

  const onToggle = useCallback((on: boolean) => {
    if (setup) {
      project.editing.modify(() => setup.box.enabled.setValue(on));
      return;
    }
    if (!on) return;
    // Created once, page-lifetime — the panel never unmounts, so the modulator
    // boxes are deliberately not deleted; later toggles flip `enabled` only.
    let box: LfoModulatorBox | null = null;
    let assignment: ModulationBox | null = null;
    try {
      // editing.modify RETHROWS after aborting the transaction, so a failure
      // here (asInstanceOf mismatch, assign invariant) commits nothing — but it
      // must be caught and surfaced, or the switch just silently stays off.
      project.editing.modify(() => {
        box = asInstanceOf(project.api.modulation.createLfo("Acid Sweep"), LfoModulatorBox);
        box.rateSync.setValue(LFO_RATE_1_BAR);
        assignment = project.api.modulation.assign(box, cutoff.modulationTarget, 0.35);
      });
    } catch (error) {
      console.error("Cubed demo: LFO creation failed: " + String(error));
      setLfoError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!box || !assignment) {
      console.error("Cubed demo: LFO modulator creation produced no box/assignment");
      setLfoError("The LFO modulator was not created.");
      return;
    }
    setLfoError(null);
    // Casts defeat TS closure-narrowing to never after the modify() callback.
    setSetup({ box: box as LfoModulatorBox, assignment: assignment as ModulationBox });
    setEnabled(true);
  }, [project, setup, cutoff]);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <Text size="2" color="gray">
          Sweep the filter with a synced LFO — modulation is added onto the cutoff's
          unit value by the engine and streamed back to the scope below.
        </Text>
      </Flex>
      {setup && (
        <Grid columns={{ initial: "1", sm: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">Rate</Text>
            <Select.Root
              value={String(rate)}
              onValueChange={(v) => project.editing.modify(() => setup.box.rateSync.setValue(Number(v)))}
            >
              <Select.Trigger />
              <Select.Content>
                {LfoModulatorBoxAdapter.RateStrings.map((label, index) => (
                  <Select.Item key={label} value={String(index)}>{label}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex direction="column" gap="1">
            <Flex justify="between">
              <Text size="1" color="gray">Depth</Text>
              <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{depth.toFixed(2)}</Text>
            </Flex>
            <Slider
              min={-1} max={1} step={0.01}
              value={[depth]}
              onValueChange={([v]) => project.editing.modify(() => setup.assignment.depth.setValue(v))}
            />
          </Flex>
        </Grid>
      )}
      {setup && <CutoffScope param={cutoff} />}
      {lfoError && (
        <Callout.Root color="red" size="1" role="alert">
          <Callout.Text>Could not create the LFO: {lfoError}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const App: React.FC = () => {
  const [status, setStatus] = useState("Booting…");
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [cubedBox, setCubedBox] = useState<CubedDeviceBox | null>(null);
  const [adapter, setAdapter] = useState<CubedDeviceBoxAdapter | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [page, setPage] = useState(0);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Re-render the pattern card after every committed transaction — the grid and
  // pattern header read the box graph synchronously during render.
  const [, setVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const { project: newProject } = await initializeOpenDAW({ onStatusUpdate: setStatus });
        if (disposed) { newProject.terminate(); return; }

        let instrumentBox: CubedDeviceBox | null = null;
        newProject.editing.modify(() => {
          instrumentBox = asInstanceOf(
            newProject.api.createInstrument(InstrumentFactories.Cubed).instrumentBox,
            CubedDeviceBox);
        });
        if (!instrumentBox) {
          throw new Error("createInstrument(InstrumentFactories.Cubed) produced no instrument box");
        }
        // Cast defeats TS closure-narrowing to never after the modify() callback.
        const box = instrumentBox as CubedDeviceBox;
        const cubedAdapter = newProject.boxAdapters.adapterFor(box, CubedDeviceBoxAdapter);

        // Seed: acid tempo + the first preset's pattern and sound.
        newProject.editing.modify(() => {
          newProject.timelineBox.bpm.setValue(132);
          applyPresetInTransaction(cubedAdapter, CUBED_PRESETS[0]);
        });

        setProject(newProject);
        setCubedBox(box);
        setAdapter(cubedAdapter);
        setActivePreset(CUBED_PRESETS[0].name);
        setStatus("Ready — press Play");
      } catch (error) {
        console.error("Cubed demo init error: " + String(error) +
          (error instanceof Error && error.stack ? "\n" + error.stack : ""));
        if (!disposed) setInitError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!project) return undefined;
    const playingSub = project.engine.isPlaying.catchupAndSubscribe((obs) => setIsPlaying(obs.getValue()));
    const bpmSub = project.timelineBox.bpm.catchupAndSubscribe((obs) => setBpm(obs.getValue()));
    const editSub = project.editing.subscribe(() => setVersion((v) => v + 1));
    return () => {
      playingSub.terminate();
      bpmSub.terminate();
      editSub.terminate();
    };
  }, [project]);

  const applyPreset = useCallback((preset: CubedPreset) => {
    if (!project || !adapter) return;
    project.editing.modify(() => applyPresetInTransaction(adapter, preset));
    setActivePreset(preset.name);
  }, [project, adapter]);

  // Any non-preset pattern change makes the preset highlight a lie — clear it.
  const markPatternEdited = useCallback(() => setActivePreset(null), []);

  const patternIndex = cubedBox?.patternIndex.getValue() ?? 0;
  const patternLength = adapter?.currentPattern().length.getValue() ?? 16;
  const waveform = cubedBox?.waveform.getValue() ?? 0;

  return (
    <Theme appearance="dark" accentColor="amber" radius="large" style={{ background: "var(--mc-bg)" }}>
      <style>{CONSOLE_STYLES}</style>
      <style>{PAGE_STYLES}</style>
      <Container size="4" px="4" py="8">
        <GitHubCorner />
        <BackLink />
        <Flex direction="column" gap="5" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div>
            <div className="mc-kicker">Instruments — Acid Bassline · OpenDAW SDK</div>
            <h1 className="mc-title" style={{ fontSize: "clamp(28px, 4.5vw, 44px)" }}>CUBED</h1>
            <p className="mc-intro">
              A monophonic 303-style bass synth with a built-in step sequencer: 16
              patterns of up to 64 steps, each step a note with gate, slide and accent
              flags. The sequencer follows the transport — press Play and edit the
              pattern while it runs. Everything on this page is main-thread adapter
              surface: <code>CubedDeviceBoxAdapter</code> pattern ops,{" "}
              <code>namedParameter</code> knobs, and JSON/ABL pattern exchange.
            </p>
          </div>

          {initError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text><strong>Initialization failed:</strong> {initError}</Callout.Text>
            </Callout.Root>
          ) : !project || !adapter || !cubedBox ? (
            <Text align="center" color="gray">{status}</Text>
          ) : (
            <>
              <Card>
                <Flex align="center" gap="3" wrap="wrap">
                  <Button onClick={() => project.engine.play()} disabled={isPlaying}>▶ Play</Button>
                  <Button variant="soft" onClick={() => project.engine.stop(false)} disabled={!isPlaying}>⏸ Pause</Button>
                  <Button variant="soft" onClick={() => project.engine.stop(true)}>■ Stop</Button>
                  <Separator orientation="vertical" />
                  <Flex align="center" gap="2" style={{ minWidth: 220 }} flexGrow="1">
                    <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>BPM</Text>
                    <Slider
                      min={80} max={180} step={1}
                      value={[bpm]}
                      onValueChange={([v]) => project.editing.modify(() => project.timelineBox.bpm.setValue(v))}
                      style={{ flexGrow: 1 }}
                    />
                    <Text size="1" style={{ fontFamily: "var(--mc-mono)", minWidth: 32 }}>{Math.round(bpm)}</Text>
                  </Flex>
                  <Badge color={isPlaying ? "green" : "amber"}>{isPlaying ? "Playing" : status}</Badge>
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="4">
                  <Flex align="center" justify="between" wrap="wrap" gap="3">
                    <Text size="2" weight="bold" color="gray">Pattern Sequencer</Text>
                    <Flex align="center" gap="3" wrap="wrap">
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray">Pattern</Text>
                        <Select.Root
                          value={String(patternIndex)}
                          onValueChange={(v) => {
                            project.editing.modify(() => cubedBox.patternIndex.setValue(Number(v)));
                            markPatternEdited();
                          }}
                        >
                          <Select.Trigger />
                          <Select.Content>
                            {Array.from({ length: 16 }, (_, index) => (
                              <Select.Item key={index} value={String(index)}>{index + 1}</Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Root>
                      </Flex>
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray">View</Text>
                        <SegmentedControl.Root value={String(page)} onValueChange={(v) => setPage(Number(v))}>
                          {["1–16", "17–32", "33–48", "49–64"].map((label, index) => (
                            <SegmentedControl.Item key={label} value={String(index)}>{label}</SegmentedControl.Item>
                          ))}
                        </SegmentedControl.Root>
                      </Flex>
                    </Flex>
                  </Flex>

                  <StepGrid project={project} adapter={adapter} page={page} onPatternEdited={markPatternEdited} />

                  <Flex align="center" gap="3" wrap="wrap">
                    <Flex align="center" gap="2" style={{ minWidth: 200 }} flexGrow="1">
                      <Text size="1" color="gray" style={{ whiteSpace: "nowrap" }}>Length</Text>
                      <Slider
                        min={1} max={64} step={1}
                        value={[patternLength]}
                        onValueChange={([v]) => {
                          project.editing.modify(() => adapter.currentPattern().length.setValue(v));
                          markPatternEdited();
                        }}
                        style={{ flexGrow: 1 }}
                      />
                      <Text size="1" style={{ fontFamily: "var(--mc-mono)", minWidth: 40 }}>{patternLength} st</Text>
                    </Flex>
                    <Separator orientation="vertical" />
                    <Button variant="soft" onClick={() => { project.editing.modify(() => adapter.rotateCurrentPattern(-1)); markPatternEdited(); }}>◀ Shift</Button>
                    <Button variant="soft" onClick={() => { project.editing.modify(() => adapter.rotateCurrentPattern(1)); markPatternEdited(); }}>Shift ▶</Button>
                    <Button variant="soft" color="red" onClick={() => { project.editing.modify(() => adapter.clearCurrentPattern()); markPatternEdited(); }}>Clear</Button>
                  </Flex>

                  <Text size="1" color="gray">
                    A hand-picked pattern switch waits for the next bar line while playing;
                    an automated switch takes effect immediately. Steps beyond the length are
                    dimmed and keep their notes across length changes and shifts — presets,
                    Randomize, JSON/ABL apply, and Clear reset them.
                  </Text>
                </Flex>
              </Card>

              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Presets</Text>
                  <Grid columns={{ initial: "1", sm: "3" }} gap="3">
                    {CUBED_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        className="cb-preset"
                        data-active={activePreset === preset.name || undefined}
                        onClick={() => applyPreset(preset)}
                      >
                        <span className="cb-preset-name">{preset.name}</span>
                        <span className="cb-preset-desc">{preset.description}</span>
                      </button>
                    ))}
                  </Grid>
                </Flex>
              </Card>

              <Grid columns={{ initial: "1", md: "2" }} gap="5">
                <Card>
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Text size="2" weight="bold" color="gray">Sound</Text>
                      <SegmentedControl.Root
                        value={String(waveform)}
                        onValueChange={(v) => project.editing.modify(() => cubedBox.waveform.setValue(Number(v)))}
                      >
                        <SegmentedControl.Item value="0">Sawtooth</SegmentedControl.Item>
                        <SegmentedControl.Item value="1">Square</SegmentedControl.Item>
                      </SegmentedControl.Root>
                    </Flex>
                    <ParamSlider project={project} param={adapter.namedParameter.cutoff} label="Cutoff" />
                    <ParamSlider project={project} param={adapter.namedParameter.resonance} label="Resonance" />
                    <ParamSlider project={project} param={adapter.namedParameter.envMod} label="Env Mod" />
                    <ParamSlider project={project} param={adapter.namedParameter.decay} label="Decay" />
                    <ParamSlider project={project} param={adapter.namedParameter.accent} label="Accent" />
                    <ParamSlider project={project} param={adapter.namedParameter.tuning} label="Tuning" />
                    <ParamSlider project={project} param={adapter.namedParameter.volume} label="Volume" />
                  </Flex>
                </Card>

                <Flex direction="column" gap="5">
                  <Card>
                    <Flex direction="column" gap="3">
                      <Text size="2" weight="bold" color="gray">Random Generator</Text>
                      <GeneratorPanel
                        onRandomize={(options) => {
                          project.editing.modify(() => adapter.randomizeCurrentPattern(options));
                          markPatternEdited();
                        }}
                      />
                    </Flex>
                  </Card>
                  <Card>
                    <Flex direction="column" gap="3">
                      <Text size="2" weight="bold" color="gray">LFO → Cutoff</Text>
                      <LfoPanel project={project} adapter={adapter} />
                    </Flex>
                  </Card>
                </Flex>
              </Grid>

              <Card>
                <Flex direction="column" gap="3">
                  <Text size="2" weight="bold" color="gray">Pattern Exchange</Text>
                  <ExchangePanel project={project} adapter={adapter} onPatternEdited={markPatternEdited} />
                </Flex>
              </Card>
            </>
          )}
        </Flex>
        <MoisesLogo />
      </Container>
    </Theme>
  );
};

/** Writes a preset's pattern and knob settings. Caller wraps in editing.modify(). */
function applyPresetInTransaction(adapter: CubedDeviceBoxAdapter, preset: CubedPreset): void {
  adapter.writeCurrentPattern(preset.pattern);
  const p = adapter.namedParameter;
  p.cutoff.setUnitValue(preset.sound.cutoff);
  p.resonance.setUnitValue(preset.sound.resonance);
  p.envMod.setUnitValue(preset.sound.envMod);
  p.decay.setUnitValue(preset.sound.decay);
  p.accent.setUnitValue(preset.sound.accent);
  adapter.box.waveform.setValue(preset.sound.waveform);
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
