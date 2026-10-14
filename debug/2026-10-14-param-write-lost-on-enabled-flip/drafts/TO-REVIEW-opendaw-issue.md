<!-- Target: new issue on andremichelle/openDAW. Not posted. Title below; body follows the rule. -->

# Parameter write in the same transaction as an effect's `enabled` toggle never reaches the engine

**SDK:** `@opendaw/studio-sdk` 0.0.174 (WASM engine), Chrome 155, macOS.

A device parameter field written inside an `editing.modify()` that also toggles an effect's `enabled` field
in the same audio unit keeps its new value in the box graph, but the engine keeps rendering with the old
value. Writing the same value again later sends nothing, so the engine stays out of sync until the field
changes to a third value. The same write in its own `editing.modify()` is applied.

**Repro page (headless, measures the engine output):**
https://opendaw-test.pages.dev/param-write-enabled-flip-debug-demo.html — click Run; the verdict reads
BUG PRESENT / FIXED. Source: https://github.com/naomiaro/opendaw-test/blob/main/src/demos/engine/param-write-enabled-flip-debug-demo.tsx

A Vaporisateur plays one quarter note (0.25–0.75 s) in a 4 s loop; a StereoTool is in its chain,
bypassed. The synth's `release` sets how long the note rings; the page reads the tail off the output.

| step | transaction | tail |
|---|---|---|
| 1 | `release = 0.5` alone | 400 ms |
| 2 | `stereoTool.enabled false→true` **and** `release = 2.0`, one `editing.modify` | **400 ms** — box reads 2.0 |
| 3 | `enabled true→false`, then `release = 2.5` in a second `editing.modify` | 2050 ms |
| 4 | `release = 0.5` alone | 400 ms |

Same outcome with a Delay or a WebCLAP device as the toggled effect, with the two writes in either order,
and whether the transport is playing, paused or stopped when the transaction commits.

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-14-param-write-lost-on-enabled-flip/note.md
