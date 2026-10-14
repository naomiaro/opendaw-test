<!-- Target: new issue on andremichelle/openDAW. Not posted. Post AFTER repo PR #152 is merged and deployed (the page URL exists only then). -->

# Parameter write in the same transaction as an effect's `enabled` toggle never reaches the engine

**SDK:** `@opendaw/studio-sdk` 0.0.174 (WASM engine), Chrome 155, macOS.

A device parameter field written inside an `editing.modify()` that also toggles an effect's `enabled` field
in the same audio unit (either direction) keeps its new value in the box graph, but the engine keeps
rendering with the old value. Writing the same value again sends nothing (lib-box's `setValue` returns on
an unchanged value), so the engine stays out of sync until the field changes to a third value. The same
write in its own `editing.modify()` is applied, with the effect enabled or bypassed.

**Repro page (headless, measures the engine output):**
https://opendaw-test.pages.dev/param-write-enabled-flip-debug-demo.html — click Run; the verdict reads
BUG PRESENT / FIXED. Source: https://github.com/naomiaro/opendaw-test/blob/main/src/demos/engine/param-write-enabled-flip-debug-demo.tsx

A Vaporisateur plays one quarter note (0.25–0.75 s) in a 4 s loop; a StereoTool is in its chain, bypassed
at first. The synth's `release` sets how long the note rings; the page reads the tail off the output (it
lands at about 0.8 × the release). Every capture starts from `stop(true)` and `play()`.

| step | transaction | tail |
|---|---|---|
| 1 | `release = 0.5` alone | 400 ms |
| 2 | `stereoTool.enabled false→true` **and** `release = 2.5`, one `editing.modify` | **400 ms** — box reads 2.5 |
| 2b | `release = 2.5` alone (the value the box already holds) | 400 ms — nothing sent |
| 2c | `release = 3.0` alone (StereoTool enabled) | 2500 ms |
| 3 | `stereoTool.enabled true→false` **and** `release = 0.5`, one `editing.modify` | **2500 ms** — box reads 0.5 |
| 4 | `release = 0.6` alone | 500 ms |
| 5 | `enabled false→true`, then `release = 2.0` in a second `editing.modify` | 1650 ms |

Two runs, same figures. In hand runs the same happened with a Delay and with a WebCLAP device as the
toggled effect.

Investigation note: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-10-14-param-write-lost-on-enabled-flip/note.md
