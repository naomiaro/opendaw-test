/**
 * Compile a Spielwerk script so a rejected compile leaves the device on its last good script. The
 * SDK's compiler writes `code` and re-registers the parameter boxes in a transaction BEFORE the
 * module loads, and only a syntax check runs first; a module that fails to evaluate (a renamed
 * class, a throw at construction) rejects after the write. Recompiling the previous source puts
 * the code, the parameter boxes and the worklet's registry entry back together.
 */
import type { Editing } from "@opendaw/lib-std";
import type { SpielwerkDeviceBox } from "@opendaw/studio-boxes";

/** The part of `ScriptCompiler.create(...)` this uses; a test passes a double. */
export interface ScriptCompilerLike {
  compile(audioContext: BaseAudioContext, editing: Editing, deviceBox: SpielwerkDeviceBox, source: string): Promise<void>;
}

export async function compileWithRestore(
  compiler: ScriptCompilerLike,
  audioContext: BaseAudioContext,
  editing: Editing,
  box: SpielwerkDeviceBox,
  source: string
): Promise<void> {
  const previous = box.code.getValue();
  try {
    await compiler.compile(audioContext, editing, box, source);
  } catch (error) {
    if (box.code.getValue() !== previous) {
      await compiler.compile(audioContext, editing, box, previous).catch((restoreError: unknown) => {
        console.error("Restoring the previous Spielwerk script failed: " + String(restoreError));
      });
    }
    throw error;
  }
}
