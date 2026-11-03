import { describe, expect, it } from "vitest";
import { Option, UUID } from "@opendaw/lib-std";
import { BoxEditing } from "@opendaw/lib-box";
import { SpielwerkDeviceBox, WerkstattParameterBox } from "@opendaw/studio-boxes";
import { AudioUnitFactory, ProjectSkeleton } from "@opendaw/studio-adapters";
import { AudioUnitType } from "@opendaw/studio-enums";
import { transact } from "@/lib/testing/boxGraphFixtures";
import { readScriptParams } from "@/lib/scriptParams";
import { compileWithRestore, type ScriptCompilerLike } from "./spielwerkCompile";

/** A Spielwerk on a real graph and a compiler double that behaves like the SDK's: it writes `code` and
 *  re-registers the parameter boxes BEFORE the module loads, then resolves or rejects. */
function fixture(rejectOn: (source: string) => boolean) {
  const skeleton = ProjectSkeleton.empty({ createOutputMaximizer: false, createDefaultUser: false });
  const { boxGraph } = skeleton;
  const box = transact(boxGraph, () => {
    const unit = AudioUnitFactory.create(skeleton, AudioUnitType.Instrument, Option.None);
    return SpielwerkDeviceBox.create(boxGraph, UUID.generate(), (b) => {
      b.label.setValue("Spielwerk");
      b.index.setValue(0);
      b.host.refer(unit.midiEffects);
    });
  });
  const editing = new BoxEditing(boxGraph);
  const calls: string[] = [];
  const compiler: ScriptCompilerLike = {
    compile: async (_context, ed, device, source) => {
      calls.push(source);
      ed.modify(() => {
        device.code.setValue(source);
        for (const p of device.parameters.pointerHub.incoming()) p.box.delete();
        [...source.matchAll(/^\/\/ @param (\w+) (\S+)/gm)].forEach((m, index) => {
          WerkstattParameterBox.create(boxGraph, UUID.generate(), (pb) => {
            pb.label.setValue(m[1]);
            pb.index.setValue(index);
            pb.value.setValue(Number(m[2]));
            pb.defaultValue.setValue(Number(m[2]));
            pb.owner.refer(device.parameters);
          });
        });
      });
      if (rejectOn(source)) throw new Error("Processor is not defined");
    },
  };
  return { box, editing, compiler, calls };
}

const GOOD = "// @param delay 240\nclass Processor { * process(block, events) {} }";
const BAD = "// @param spread 60\nclass Prozessor { * process(block, events) {} }";

describe("compileWithRestore", () => {
  it("compiles once on success", async () => {
    const { box, editing, compiler, calls } = fixture(() => false);
    await compileWithRestore(compiler, {} as AudioContext, editing, box, GOOD);
    expect(calls).toEqual([GOOD]);
    expect(box.code.getValue()).toBe(GOOD);
    expect(readScriptParams(box)).toEqual([{ label: "delay", value: 240 }]);
  });

  it("restores the previous source on a rejected compile, parameter boxes included, and rethrows", async () => {
    const { box, editing, compiler, calls } = fixture((source) => source === BAD);
    await compileWithRestore(compiler, {} as AudioContext, editing, box, GOOD);
    await expect(compileWithRestore(compiler, {} as AudioContext, editing, box, BAD)).rejects.toThrow("Processor is not defined");
    expect(calls).toEqual([GOOD, BAD, GOOD]);
    expect(box.code.getValue()).toBe(GOOD);
    expect(readScriptParams(box)).toEqual([{ label: "delay", value: 240 }]);
  });
});
