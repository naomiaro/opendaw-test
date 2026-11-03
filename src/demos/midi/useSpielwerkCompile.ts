/**
 * Compiling a Spielwerk script on demand and reading the parameters it declares. On a rejected
 * compile the device keeps its last good script: the compiler validates syntax before it writes,
 * but a module that fails to evaluate lands after the write, so the previous source is restored
 * when the field changed. A successful compile is a MIDI-chain change: the engine drops the
 * instrument's sounding voices, so the caller is told to restart the pattern.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { ScriptCompiler } from "@opendaw/studio-adapters";
import type { SpielwerkDeviceBox } from "@opendaw/studio-boxes";
import { readScriptParams, writeScriptParam, type ScriptParam } from "@/lib/scriptParams";

export interface SpielwerkCompile {
  /** Rejects with the compiler's error; the device then still runs its previous script. */
  compile(source: string): Promise<void>;
  busy: boolean;
  params: ScriptParam[];
  writeParam(label: string, value: number): void;
}

export function useSpielwerkCompile(
  project: Project | null,
  audioContext: AudioContext | null,
  box: SpielwerkDeviceBox | null,
  onCompiled: () => void
): SpielwerkCompile {
  const compilerRef = useRef<ReturnType<typeof ScriptCompiler.create> | null>(null);
  if (compilerRef.current === null) {
    compilerRef.current = ScriptCompiler.create({ headerTag: "spielwerk", registryName: "spielwerkProcessors", functionName: "spielwerk" });
  }
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<ScriptParam[]>([]);

  useEffect(() => {
    setParams(box ? readScriptParams(box) : []);
  }, [box]);

  const compile = useCallback(async (source: string) => {
    if (!project || !audioContext || !box) throw new Error("the engine is still starting");
    const previous = box.code.getValue();
    setBusy(true);
    try {
      await compilerRef.current!.compile(audioContext, project.editing, box, source);
    } catch (error) {
      if (box.code.getValue() !== previous) {
        project.editing.modify(() => box.code.setValue(previous));
      }
      throw error;
    } finally {
      setBusy(false);
    }
    setParams(readScriptParams(box));
    onCompiled();
  }, [project, audioContext, box, onCompiled]);

  const writeParam = useCallback((label: string, value: number) => {
    if (!project || !box) return;
    if (writeScriptParam(project.editing, box, label, value)) {
      setParams((current) => current.map((p) => (p.label === label ? { label, value } : p)));
    }
  }, [project, box]);

  return { compile, busy, params, writeParam };
}
