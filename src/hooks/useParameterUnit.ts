import { useCallback, useEffect, useState } from "react";
import type { Project } from "@opendaw/studio-core";
import type { AutomatableParameterFieldAdapter } from "@opendaw/studio-adapters";

/**
 * The unit-value API (getUnitValue / setUnitValue / getPrintValue) does not
 * depend on the field's primitive type, so one binding serves number, integer
 * and boolean parameters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnitParameter = AutomatableParameterFieldAdapter<any>;

export function formatParameterPrint(parameter: UnitParameter): string {
  const { value, unit } = parameter.getPrintValue();
  return unit ? `${value} ${unit}` : value;
}

/**
 * Bind one control to one parameter. Reads catch up immediately, writes commit
 * a transaction, and any other write (preset, undo) flows back through the
 * same subscription.
 */
export function useParameterUnit(
  project: Project,
  parameter: UnitParameter
): [unit: number, print: string, write: (unit: number) => void] {
  const [unit, setUnit] = useState(() => parameter.getUnitValue());
  const [print, setPrint] = useState(() => formatParameterPrint(parameter));
  useEffect(() => {
    const sub = parameter.catchupAndSubscribe(current => {
      setUnit(current.getUnitValue());
      setPrint(formatParameterPrint(current));
    });
    return () => sub.terminate();
  }, [parameter]);
  const write = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      project.editing.modify(() => parameter.setUnitValue(clamped));
    },
    [project, parameter]
  );
  return [unit, print, write];
}
