# Automation simplifier flattens smooth gestures far beyond its ε

**Verified against:** `@opendaw/studio-sdk` 0.0.170 (`studio-core` 0.2.4, `studio-adapters` 0.3.2), WASM engine, Chrome.
**Repro page:** [`automation-simplifier-debug-demo.html`](../automation-simplifier-debug-demo.html) (unlisted).
**Related demo:** [`live-automation-recording-demo.html`](../live-automation-recording-demo.html).

## Symptom

Record automation with the transport loop enabled and perform a slow, smooth gesture
(for example a gradual pan arc across two bars). At the loop wrap the curve visibly
snaps to a straight line, and after the following pass the gesture is gone from the
lane altogether.

Two independent mechanisms produce that, and the repro page measures both in one run.

## Measured (repro page, two runs of the same protocol)

Protocol: 8-bar transport loop (`0 → 30720` at 122 BPM), `startRecording(false)`,
programmatic writes into an audio unit's `panning` parameter across bars 2–4 via
`editing.modify(() => adapter.setUnitValue(v), false)` at frame rate, then **no further
writes** — the transport wraps and runs to bar 5 of the next pass, then stops.

| | Step 1: smooth arc (`0.9 − 0.8·t²`) | Step 2: fast zig-zag control (8 periods) |
|---|---|---|
| writes injected | 228 | 228 |
| events raw → kept at finalize | 116 → **4** (3 % retained) | 116 → 94 (81 % retained) |
| max deviation, simplifier (unitValue) | **0.1976 — 19.8× ε** | 0.1514 — 15.1× ε |
| max deviation, end to end (unitValue) | 0.7905 | 0.5456 |
| gesture region at finalize | `pos 7680 · dur 23040 · loopOffset 0 · loopDuration 23040` | same |
| gesture region at stop | `pos 19440 · dur 11280 · loopOffset 11760 · loopDuration 23040` | same |

Kept events for the smooth arc (region-local position @ unitValue):

```
0@0.9000   0@0.9000   7634@0.1095   23040@0.1095
```

The injected arc ran 0.9000 → 0.1000 over 7680 PPQN. What survived is the seed pair plus
a single straight segment to the end value: the entire curvature is gone. 0.1976 is
exactly the parabola's own sagitta against that chord (0.8 × 0.25 = 0.20), i.e. **every
interior point was dropped**.

Note the control: even a fast zig-zag that retains 81 % of its points still lands 15× ε
out, because a single dropped sample next to a local extremum cuts the peak.

## Mechanism (A): the finalize-time thinning pass

`RecordAutomation.simplifyRecordedEvents` (`studio-core/dist/capture/RecordAutomation.js`)
runs from `finalizeState` (transport stop) and from `handleLoopWrap` (every loop wrap),
for parameters whose value mapping is `floating()`:

```js
const Epsilon = 0.01;
for (const event of events) {
    while (keep.length >= 2) {
        const a = keep[keep.length - 2];
        const b = keep[keep.length - 1];
        if (a.position === b.position || b.position === event.position) break;
        if (a.interpolation.type !== "linear" || b.interpolation.type !== "linear") break;
        const t = (b.position - a.position) / (event.position - a.position);
        const expected = a.value + t * (event.value - a.value);
        if (Math.abs(b.value - expected) > Epsilon) break;
        keep.pop();
        adapter.events.remove(b);
        b.box.delete();
    }
    keep.push(event);
}
```

This is a single-pass greedy collinearity filter, **not** Ramer–Douglas–Peucker (no
recursive worst-point split, no global error bound). Its error test has a systematic
blind spot:

- The point being tested, `b`, is always the point *adjacent to the incoming event* —
  the far end of the chord `a → event`.
- On a smooth arc the deviation between arc and chord is `≈ 4·S·t·(1−t)` (S = sagitta),
  which vanishes at both chord endpoints. With one sample of spacing `d` and a chord of
  span `L`, `b` sits at `t = 1 − d/L`, so the measured error is `≈ 4·S·d/L` — it *shrinks
  as the chord grows*.
- Points already popped are never re-tested against the longer chord.

So the pass keeps swallowing points as long as the newest one still looks collinear from
the far end, and the admissible sagitta grows roughly as `S ≈ ε·L/(4·d)`. At the measured
sampling (d ≈ 66 PPQN, L ≈ 7634 PPQN) that ceiling is ≈ 0.29 — consistent with the
observed 0.198. ε is therefore not a bound on the error the user sees; it is a bound on
the error at the one place the arc is guaranteed to be closest to its chord.

**Suggested fix:** test the removal against every point the chord would swallow, not just
the adjacent one — e.g. keep the popped points in a pending buffer and check
`max |value − chord(a, event)|` over that buffer before committing the pop (still one
pass, O(n) amortised in practice), or run a real Douglas–Peucker split on the take. Either
change makes ε mean what it reads as.

## Mechanism (B): latch overdub front-trim (by design)

After a wrap, `handleLoopWrap` finalizes the current take and immediately opens a new
region for the same parameter holding `state.lastValue` — latch semantics: the producer
never lifts off, so the take stays open. `updateRegionDurations` then grows that region
with the playhead *with no further gestures at all*, and `RegionClipResolver.#trimStart`
front-trims whatever it grows into:

```js
const delta = position - region.position;
region.position = position;
region.duration = oldDuration - delta;
region.loopOffset = mod(oldLoopOffset + delta, oldLoopDuration);
```

That is exactly the geometry change measured above: the gesture region goes from
`pos 7680 · loopOffset 0` to `pos 19440 · loopOffset 11760` — 11760 PPQN eaten — while a
flat two-event hold region (`0@0.1095 … 19440@0.1095`) covers the range the arc used to
occupy. End-to-end deviation at the original write positions is then 0.79 unitValue: the
curve is not merely simplified, it is no longer what plays there.

This is not a defect: it is what latch means with the loop running (the missing engine
behaviour is *touch* mode, which would lift off at the end of the gesture and preserve the
previous pass). It is documented here because it is indistinguishable from (A) by eye and
has to be excluded before (A) can be measured. It is also the reason a region's events can
sit entirely outside its own visible span — see `src/demos/automation/CLAUDE.md`.

## Reproducing

1. Open [`automation-simplifier-debug-demo.html`](../automation-simplifier-debug-demo.html).
2. Click **Run** on step 1 (a real click — it resumes the AudioContext). The run takes
   ~26 s and self-classifies: outcome (`OK` / `HUNG` / `THREW`), stage trail, verdict
   (`A` / `B` / `BOTH` / `NEITHER`), both deviations, the region geometry before and after
   the trim, and the full kept-event dump.
3. Click **Run** on step 2 for the fast/jagged control.

Expected columns show what a faithful ε = 0.01 pass with no overdub trim would report; the
Got column is the measurement.
