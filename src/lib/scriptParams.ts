/**
 * The parameters a script device (Werkstatt, Spielwerk, Apparat) declares with `// @param`, read
 * from the parameter boxes the compiler registers on the device's `parameters` field. Values are the
 * raw declared values (not unit values), which is what a script's `paramChanged` receives.
 */
import type { Editing } from "@opendaw/lib-std";
import type { Field } from "@opendaw/lib-box";
import { WerkstattParameterBox } from "@opendaw/studio-boxes";
import type { Pointers } from "@opendaw/studio-enums";

export interface ScriptParam {
  label: string;
  value: number;
}

export interface ScriptDevice {
  readonly parameters: Field<Pointers.Parameter>;
}

function parameterBoxes(device: ScriptDevice): WerkstattParameterBox[] {
  return device.parameters.pointerHub
    .incoming()
    .map((pointer) => pointer.box)
    .filter((box): box is WerkstattParameterBox => box instanceof WerkstattParameterBox)
    .sort((a, b) => a.index.getValue() - b.index.getValue());
}

/** Label and value of every declared parameter, in declaration order. */
export function readScriptParams(device: ScriptDevice): ScriptParam[] {
  return parameterBoxes(device).map((box) => ({ label: box.label.getValue(), value: box.value.getValue() }));
}

/** Write a declared parameter's value; false when the script declares no such label (nothing written). */
export function writeScriptParam(editing: Editing, device: ScriptDevice, label: string, value: number): boolean {
  const box = parameterBoxes(device).find((candidate) => candidate.label.getValue() === label);
  if (box === undefined) return false;
  editing.modify(() => box.value.setValue(value));
  return true;
}
