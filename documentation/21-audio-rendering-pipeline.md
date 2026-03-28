# Audio Rendering Pipeline: From Musical Time to Pixels

How a DAW converts musical positions (beats, bars) into waveform pixels on screen, handling tempo changes along the way.

## The Two Coordinate Systems

A DAW timeline has two fundamentally different ways to measure position:

**Musical time (PPQN ticks)** — measures position in beats. A quarter note is always 960 ticks (at PPQN=960), regardless of tempo. Bar 5, beat 3 is always the same tick number. The grid lines in a DAW are evenly spaced in this space.

**Real time (seconds/samples)** — measures position in wall-clock time. One second is always one second. Audio samples live in this space (48,000 samples = 1 second at 48kHz).

At a constant tempo, these two systems are proportional — converting between them is just multiplication. But when tempo changes, the relationship becomes non-linear, and the math gets interesting.

## Constants

```
PPQN (Quarter) = 960          Ticks per quarter note
Bar            = 3840          Ticks per bar (4/4 time: 4 x 960)
SemiQuaver     = 240           Ticks per sixteenth note (960 / 4)
TempoChangeGrid = 80           Integration resolution (~1/12 beat)
RenderQuantum  = 128           Audio worklet block size (samples)
```

**Why 960 PPQN?** 960 = 2^6 x 3 x 5. This gives clean integer division for common subdivisions: triplets (960/3 = 320), sixteenths (960/4 = 240), thirty-seconds (960/8 = 120). No floating-point needed for standard musical divisions.

## Layer 1: Core Conversions (Constant Tempo)

At a single tempo, converting between ticks and seconds is a simple ratio:

```
seconds = ticks x 60 / (PPQN x BPM)
ticks   = seconds x BPM x PPQN / 60
```

For example, at 120 BPM:
- 1 quarter note = 960 ticks = 960 x 60 / (960 x 120) = **0.5 seconds**
- 1 bar (4/4) = 3840 ticks = 3840 x 60 / (960 x 120) = **2.0 seconds**
- 3 seconds of audio = 3 x 120 x 960 / 60 = **5760 ticks**

To get samples, multiply seconds by the sample rate:

```
samples = ticks x 60 x sampleRate / (PPQN x BPM)
```

At 120 BPM and 48kHz: 960 ticks = 0.5 seconds = 24,000 samples.

## Layer 2: Tempo Integration (Variable Tempo)

When tempo changes mid-timeline, the simple ratio breaks. A section at 120 BPM has different seconds-per-tick than a section at 60 BPM. Converting a tick position to seconds requires **integrating** over the tempo curve — summing up the time contribution of each small segment at its local tempo.

### Why Integration?

Think of it like driving on a highway where the speed limit changes. If you drive 100km at 100km/h, then 100km at 50km/h, the total time isn't `200km / 75km/h`. You have to compute each segment separately: 1 hour + 2 hours = 3 hours.

Same principle: if tick 0-3840 is at 120 BPM (2 seconds) and tick 3840-7680 is at 60 BPM (4 seconds), the total time to tick 7680 is 6 seconds — not the 4 seconds you'd get by averaging the tempos.

### The Integration Algorithm

The `VaryingTempoMap` converts ticks to seconds by stepping through `TempoChangeGrid`-sized intervals (80 ticks each, approximately 10ms at typical tempos):

```
function ppqnToSeconds(targetTick):
    accumulatedSeconds = 0
    currentTick = 0

    while currentTick < targetTick:
        // Get tempo at this position
        bpm = tempoMap.getTempoAt(currentTick)

        // Step to next grid boundary (or target, whichever is closer)
        nextGrid = ceil(currentTick / 80) * 80
        segmentEnd = min(nextGrid, targetTick)
        segmentTicks = segmentEnd - currentTick

        // Convert this segment's ticks to seconds at local tempo
        segmentSeconds = segmentTicks * 60 / (960 * bpm)

        accumulatedSeconds += segmentSeconds
        currentTick = segmentEnd

    return accumulatedSeconds
```

Each step assumes constant tempo within the 80-tick window. This is a **Riemann sum** — approximating the integral of `1/tempo` over the tick range. The 80-tick grid (~10ms) provides sufficient resolution for smooth tempo automation curves.

### Caching for Performance

The integration runs from tick 0 every time, which would be slow for positions deep in the timeline. A **cache** stores pre-computed (tick, seconds, bpm) entries at tempo event boundaries. Binary search finds the nearest cached entry, then integration continues from there.

### The Inverse: Seconds to Ticks

Going the other direction (seconds to ticks) uses the same stepping approach, but accumulates ticks instead of seconds. When a step would overshoot the target seconds, it interpolates linearly within that segment:

```
function secondsToTicks(targetSeconds):
    accumulatedSeconds = 0
    accumulatedTicks = 0

    while accumulatedSeconds < targetSeconds:
        bpm = tempoMap.getTempoAt(accumulatedTicks)
        segmentTicks = 80  // TempoChangeGrid
        segmentSeconds = segmentTicks * 60 / (960 * bpm)

        if accumulatedSeconds + segmentSeconds >= targetSeconds:
            // Overshoot — interpolate within this segment
            remainingSeconds = targetSeconds - accumulatedSeconds
            accumulatedTicks += remainingSeconds * bpm * 960 / 60
            break

        accumulatedSeconds += segmentSeconds
        accumulatedTicks += segmentTicks

    return accumulatedTicks
```

## Layer 3: The Timeline Grid (PPQN-Linear)

The grid, ruler, and beat markers use a simple **linear** mapping from ticks to pixels:

```
pixel = (tick - viewportStartTick) / ticksPerPixel
tick  = pixel * ticksPerPixel + viewportStartTick
```

This is intentionally NOT tempo-aware. Every beat is the same pixel width. Every bar is the same pixel width. The grid is uniform in musical space.

This is the correct behavior — when a musician looks at a timeline in "bars & beats" mode, they expect beat 1 of every bar to be equally spaced, regardless of whether the tempo is accelerating or decelerating.

## Layer 4: Waveform Rendering (Tempo-Aware)

This is where it gets interesting. The waveform renderer needs to show audio content aligned to the tick-linear grid. At a constant tempo, this is trivial — the audio's sample positions map linearly to tick positions. But at tempo changes, the same number of audio samples maps to different pixel widths depending on the local tempo.

### The Rendering Loop

The `AudioRenderer` iterates the clip's PPQN range in steps, computing the audio sample range for each step:

```
function renderAudioClip(clip, tempoMap, viewport):
    // Step size: at least 1 pixel wide, aligned to TempoChangeGrid
    minStep = viewport.ticksPerPixel * devicePixelRatio
    stepSize = max(80, ceil(minStep / 80) * 80)

    // Starting audio time
    regionStartSeconds = tempoMap.ppqnToSeconds(clip.startTick)
    currentTick = clip.startTick
    currentAudioTime = waveformOffset  // where playback starts in the audio file

    while currentTick < clip.endTick:
        nextTick = currentTick + stepSize

        // KEY: Duration depends on LOCAL TEMPO
        localBPM = tempoMap.getTempoAt(currentTick)
        stepSeconds = stepSize * 60 / (960 * localBPM)
        nextAudioTime = currentAudioTime + stepSeconds

        // Convert to pixel coordinates (linear in tick space)
        x0 = tickToPixel(currentTick)
        x1 = tickToPixel(nextTick)

        // Convert to audio sample coordinates
        u0 = currentAudioTime * sampleRate
        u1 = nextAudioTime * sampleRate

        // Render this segment's peaks
        renderPixelStrips(canvas, peaks, { x0, x1, u0, u1, ... })

        currentTick = nextTick
        currentAudioTime = nextAudioTime
```

**The critical insight:** Each step maps a fixed PPQN width (uniform pixels) to a variable audio time (depends on local tempo). When tempo is fast, more audio samples fit into the same pixel width. When tempo is slow, fewer samples fit.

### What This Looks Like

At a tempo change from 120 BPM to 60 BPM:

```
                    Tempo change here
                          |
    120 BPM               |        60 BPM
    |----|----|----|----|----|----|----|----| Grid (uniform)
    |████████████████████|████|████|████|████| Waveform

    <-- same audio per beat --> <-- 2x audio per beat -->
```

Before the tempo change, each beat-width shows 0.5 seconds of audio. After, each beat-width shows 1.0 seconds of audio (because at 60 BPM, a beat IS 1 second). The waveform appears "compressed" after the tempo change — more audio content packed into the same visual beat width.

## Layer 5: Peak Rendering (Pure Pixel Math)

The lowest level — `renderPixelStrips` — knows nothing about tempo, ticks, or music. It receives a pre-computed **layout**:

```
Layout:
    x0, x1 — screen pixel range (horizontal)
    y0, y1 — screen pixel range (vertical)
    u0, u1 — audio sample range
    v0, v1 — audio value range (-1.0 to +1.0)
```

Its job: for each pixel column from x0 to x1, find the min/max audio values in the corresponding sample range and draw a vertical line.

### The Peak Aggregation Math

Audio data is pre-processed into a multi-resolution peak cache. Each "stage" stores min/max pairs at increasing compression ratios (1x, 2x, 4x, 8x... samples per peak entry).

For a given zoom level, the renderer:

1. **Selects the appropriate stage** — the coarsest one where each peak entry covers fewer samples than one pixel width

2. **Computes peaks per pixel:**
   ```
   samplesPerPixel = (u1 - u0) / (x1 - x0)
   peaksPerPixel = samplesPerPixel / stage.samplesPerPeak
   ```

3. **For each pixel column**, aggregates all peak entries that fall within that pixel's sample range:
   ```
   for each pixel x from x0 to x1:
       peakStart = currentIndex
       peakEnd = currentIndex + peaksPerPixel

       min = MIN of all peak.min values in [peakStart, peakEnd]
       max = MAX of all peak.max values in [peakStart, peakEnd]

       yMin = map(min, valueRange, pixelRange)
       yMax = map(max, valueRange, pixelRange)

       fillRect(x, yMin, 1, yMax - yMin)
   ```

4. **Min/max swap trick**: After drawing each pixel, the previous max becomes the new min seed and vice versa. This ensures visual continuity between adjacent pixels — if the waveform crosses zero between two pixels, the connecting line is still drawn.

### Peak Data Format

Peaks are stored as packed Int32 values, each containing two Float16 numbers (min and max):

```
bits[0:15]  = Float16(min value)   // Lower 16 bits
bits[16:31] = Float16(max value)   // Upper 16 bits
```

This halves memory usage compared to storing two Float32 values per peak entry, which matters for long audio files at high resolution.

## The Complete Pipeline

Putting it all together, here's how a pixel on screen traces back to audio data:

```
User sees: pixel at x=500 on screen

Timeline viewport:
    tickAtPixel = 500 * ticksPerPixel + viewportStart
    = 500 * 24 + 0 = tick 12000

Tempo integration (if needed):
    secondsAtTick = tempoMap.ppqnToSeconds(12000)
    = integral of (60 / PPQN / BPM) from 0 to 12000
    = 6.25 seconds (at 120 BPM constant)

Audio renderer (per tempo segment):
    audioTimeAtTick = secondsAtTick - regionStart + waveformOffset
    sampleAtTick = audioTimeAtTick * 48000

Peak renderer:
    peakIndex = sampleAtTick / stage.samplesPerPeak
    min, max = peaks[peakIndex]
    yMin = map(min, [-1, 1], [0, height])
    yMax = map(max, [-1, 1], [0, height])

    Draw vertical line from yMin to yMax at x=500
```

## Two Timebase Modes for Clips

Audio clips can operate in two modes:

### Musical Timebase

Position and duration stored in PPQN ticks. The clip stays at the same bar/beat position regardless of tempo. When tempo changes, the clip's real-time duration changes (faster tempo = shorter real time), but its musical position is fixed.

Use case: drum loops, synth patterns, anything composed to fit specific bars.

### Seconds Timebase

Position stored in PPQN (for grid alignment), but duration stored in seconds. When tempo changes, the clip's PPQN duration is **recomputed** by integrating over the tempo curve at the clip's position. The same 4-second clip takes fewer beats at high tempo and more beats at low tempo.

Use case: sound effects, dialogue, field recordings — audio with a fixed real-time duration that shouldn't stretch with tempo.

### Conversion Between Timebases

The conversion is **position-dependent** when tempo varies:

```
// Seconds timebase: convert duration to PPQN at a specific position
function durationToPPQN(durationSeconds, positionTick):
    startSeconds = tempoMap.ppqnToSeconds(positionTick)
    endSeconds = startSeconds + durationSeconds
    endTick = tempoMap.secondsToPPQN(endSeconds)
    return endTick - positionTick
```

At 120 BPM: 4 seconds = 7680 ticks (8 beats).
At 60 BPM: 4 seconds = 3840 ticks (4 beats).
At a tempo ramp from 120 to 60 BPM: 4 seconds = somewhere between 3840 and 7680 ticks, determined by integration.
