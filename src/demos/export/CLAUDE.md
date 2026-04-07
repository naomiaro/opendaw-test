# Export Demo — OpenDAW SDK Reference

### Offline Audio Rendering (Export)
`OfflineEngineRenderer` throws "Already connected" when passed a live project (due to
`liveStreamReceiver` conflict). With `Option.None`, `countStems` returns 1 (not 0), routing
through the stem export branch (no metronome) rather than the mixdown branch.

**Working approach for all offline rendering:**
```typescript
const projectCopy = project.copy();
projectCopy.boxGraph.beginTransaction();
projectCopy.timelineBox.loopArea.enabled.setValue(false);
projectCopy.boxGraph.endTransaction();

const context = new OfflineAudioContext(numChannels, numSamples, sampleRate);
const worklets = await AudioWorklets.createFor(context);
const engineWorklet = worklets.createEngine({
  project: projectCopy,
  exportConfiguration, // undefined = mixdown (metronome included), config = stems (no metronome)
});
engineWorklet.connect(context.destination);

// Engine preferences don't travel with project.copy() — set on worklet directly
engineWorklet.preferences.settings.metronome.enabled = true;
engineWorklet.preferences.settings.metronome.gain = -6; // dB, max 0

engineWorklet.setPosition(startPpqn);
await engineWorklet.isReady();
engineWorklet.play();
while (!(await engineWorklet.queryLoadingComplete())) { await Wait.timeSpan(TimeSpan.millis(100)); }
const audioBuffer = await context.startRendering();
projectCopy.terminate();
```

- Mixdown path (no `exportConfiguration`) = `EngineProcessor` branch `stemExports.length === 0` = metronome included
- Stem path (`exportConfiguration` provided) = per-track channels, metronome excluded
- `project.copy()` shares the same `sampleManager` (samples stay loaded) but NOT engine preferences
- Metronome gain: `z.number().min(-Infinity).max(0)` — default `-6` dB, max `0` dB (no boost, unlike track volume which goes to +6)

### Mutate-Copy-Restore Pattern for Offline Rendering
`project.copy()` creates new box instances — you cannot modify the original project's
boxes through the copy's `editing.modify()` (throws "Modification only prohibited in
transaction mode"). To capture muted state in a copy:
```typescript
// 1. Save state, 2. Mutate original, 3. Copy (synchronous), 4. Restore original
const saved = track.audioUnitBox.mute.getValue();
project.editing.modify(() => track.audioUnitBox.mute.setValue(true));
const projectCopy = project.copy(); // synchronous — captures muted state
project.editing.modify(() => track.audioUnitBox.mute.setValue(saved)); // restore immediately
// 5. Use projectCopy for async rendering — original is already restored
```
The mute window is a single synchronous JS task — no audio blocks process in between.

## Reference Files
- Export demo: `src/demos/export/export-demo.tsx`
- Range export utility: `src/lib/rangeExport.ts`
- Audio export hook: `src/hooks/useAudioExport.ts`
