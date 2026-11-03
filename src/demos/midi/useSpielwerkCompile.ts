/**
 * Compiling a Spielwerk script on demand and reading the parameters it declares. A rejected compile
 * leaves the device on its last good script (`compileWithRestore`). A successful compile hot-swaps
 * the script in the worklet, which drops the old runtime's held notes without note-offs, so the
 * caller is told to restart the pattern.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import { ScriptCompiler } from "@opendaw/studio-adapters";
import type { SpielwerkDeviceBox } from "@opendaw/studio-boxes";
import { readScriptParams, writeScriptParam, type ScriptParam } from "@/lib/scriptParams";
import { compileWithRestore } from "@/lib/midiEffects/spielwerkCompile";

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
    setBusy(true);
    try {
      await compileWithRestore(compilerRef.current!, audioContext, project.editing, box, source);
    } finally {
      setBusy(false);
      // On a rejection the previous script's boxes are back; either way the sliders follow the device.
      setParams(readScriptParams(box));
    }
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
