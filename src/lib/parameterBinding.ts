/**
 * Binding between one UI control and one SDK parameter, free of React so it
 * can be unit-tested against real parameter adapters. `useParameterUnit` is
 * the React wrapper around these three functions.
 */
import type { Terminable } from "@opendaw/lib-std";
import type { Project } from "@opendaw/studio-core";

/**
 * The part of an SDK parameter adapter a control needs: its value in unit
 * space (0..1) and as printed text. It does not depend on the field's type, so
 * number, integer and boolean parameters all fit, and nothing here can write a
 * raw value past the parameter's mapping.
 */
export interface UnitParameter {
  getUnitValue(): number;
  setUnitValue(value: number): void;
  /** The unit value with automation and modulation added, as the engine applies it */
  getControlledUnitValue(): number;
  getPrintValue(): Readonly<{ value: string; unit: string }>;
  catchupAndSubscribe(observer: (parameter: UnitParameter) => void): Terminable;
}

export interface ParameterSnapshot {
  /** 0..1 */
  readonly unit: number;
  /** Value and unit as the parameter's own string mapping prints them */
  readonly print: string;
}

export function formatParameterPrint(parameter: UnitParameter): string {
  const { value, unit } = parameter.getPrintValue();
  return unit ? `${value} ${unit}` : value;
}

export function readParameter(parameter: UnitParameter): ParameterSnapshot {
  return { unit: parameter.getUnitValue(), print: formatParameterPrint(parameter) };
}

/**
 * Write a unit value as one transaction. The parameter's own mapping brings a
 * value outside 0..1 to the nearest end of its range. A non-finite value would
 * pass through that mapping and be stored as NaN, so it is ignored here.
 */
export function writeParameterUnit(project: Pick<Project, "editing">, parameter: UnitParameter, unit: number): void {
  if (!Number.isFinite(unit)) return;
  project.editing.modify(() => parameter.setUnitValue(unit));
}

/**
 * Report the parameter's value now and after every change, whoever makes it
 * (this binding, a preset, an undo). Terminate the returned handle to stop.
 */
export function observeParameter(
  parameter: UnitParameter,
  onChange: (snapshot: ParameterSnapshot) => void
): Terminable {
  return parameter.catchupAndSubscribe(current => onChange(readParameter(current)));
}
