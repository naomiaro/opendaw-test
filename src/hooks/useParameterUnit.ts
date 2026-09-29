import { useCallback, useEffect, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import {
  observeParameter, readParameter, writeParameterUnit, type UnitParameter,
} from "@/lib/parameterBinding";

export { formatParameterPrint } from "@/lib/parameterBinding";
export type { UnitParameter } from "@/lib/parameterBinding";

/**
 * Bind one control to one parameter. Reads catch up immediately, writes commit
 * a transaction, and any other write (preset, undo) flows back through the
 * same subscription. The logic lives in `src/lib/parameterBinding.ts`.
 */
export function useParameterUnit(
  project: Pick<Project, "editing">,
  parameter: UnitParameter
): [unit: number, print: string, write: (unit: number) => void] {
  const [snapshot, setSnapshot] = useState(() => readParameter(parameter));
  useEffect(() => {
    const observation = observeParameter(parameter, setSnapshot);
    return () => observation.terminate();
  }, [parameter]);
  const write = useCallback(
    (unit: number) => writeParameterUnit(project, parameter, unit),
    [project, parameter]
  );
  return [snapshot.unit, snapshot.print, write];
}
