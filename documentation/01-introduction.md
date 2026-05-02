# Introduction to OpenDAW Architecture

## What is a DAW?

A **DAW (Digital Audio Workstation)** is software for recording, editing, and producing audio. Think of applications like Ableton Live, Logic Pro, or FL Studio.

## A Note on Note Names

OpenDAW uses **British musical terminology** for note durations — `PPQN.SemiQuaver`, `PPQN.Quarter` — and exposes terms like `semiquavers` in user-facing position strings (`bars.beats.semiquavers:ticks`). If you grew up with the American convention (whole/half/quarter), here's the translation:

| Notation | British (SDK) | American | Fraction | PPQN | SDK constant |
|---|---|---|---|---|---|
| <svg aria-label="semibreve" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1001"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1002"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1003"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1004"><g class="vf-notehead" id="vf-auto1008"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><rect x="17" y="41.16" width="22.96" height="27.76" opacity="0" pointer-events="auto"></rect></g></svg> | Semibreve | Whole note | 1 | 3840 | `PPQN.Bar` (in 4/4) |
| <svg aria-label="minim" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1010"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1011"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1012"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1013"><g class="vf-stem" id="vf-auto1015"><path stroke-width="1.5" fill="none" d="M45.25 60L45.25 25"></path></g><g class="vf-notehead" id="vf-auto1017"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><rect x="17" y="25" width="29" height="42" opacity="0" pointer-events="auto"></rect></g></svg> | Minim | Half note | 1/2 | 1920 | — |
| <svg aria-label="crotchet" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1019"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1020"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1021"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1022"><g class="vf-stem" id="vf-auto1024"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 25"></path></g><g class="vf-notehead" id="vf-auto1026"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><rect x="17" y="25" width="15.48" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg> | Crotchet | Quarter note | 1/4 | 960 | `PPQN.Quarter` |
| <svg aria-label="quaver" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1028"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1029"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1030"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1031"><g class="vf-stem" id="vf-auto1033"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 28"></path></g><g class="vf-notehead" id="vf-auto1035"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><g class="vf-flag" id="vf-auto1032"><text stroke="none" font-size="30pt" x="30.98" y="53"></text></g><rect x="17" y="25" width="42.98" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg> | Quaver | Eighth note | 1/8 | 480 | — |
| <svg aria-label="semiquaver" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1037"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1038"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1039"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1040"><g class="vf-stem" id="vf-auto1042"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 28"></path></g><g class="vf-notehead" id="vf-auto1044"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><g class="vf-flag" id="vf-auto1041"><text stroke="none" font-size="30pt" x="30.98" y="53"></text></g><rect x="17" y="25" width="42.98" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg> | Semiquaver | Sixteenth note | 1/16 | 240 | `PPQN.SemiQuaver` |
| <svg aria-label="demisemiquaver" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1046"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1047"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1048"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1049"><g class="vf-stem" id="vf-auto1051"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 28"></path></g><g class="vf-notehead" id="vf-auto1053"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><g class="vf-flag" id="vf-auto1050"><text stroke="none" font-size="30pt" x="30.98" y="53"></text></g><rect x="17" y="25" width="42.98" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg> | Demisemiquaver | Thirty-second note | 1/32 | 120 | — |
| <svg aria-label="hemidemisemiquaver" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="50" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1055"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1056"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1057"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1058"><g class="vf-stem" id="vf-auto1060"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 28"></path></g><g class="vf-notehead" id="vf-auto1062"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><g class="vf-flag" id="vf-auto1059"><text stroke="none" font-size="30pt" x="30.98" y="53"></text></g><rect x="17" y="25" width="42.98" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg> | Hemidemisemiquaver | Sixty-fourth note | 1/64 | 60 | — |

OpenDAW's PPQN system uses **960 pulses per quarter note** (see [Chapter 02](./02-timing-and-tempo.md)). The named constants — `PPQN.Bar`, `PPQN.Quarter`, `PPQN.SemiQuaver` — cover the durations the SDK references directly; other durations are typically computed (e.g. `PPQN.Quarter >>> 1` for an eighth, `PPQN.Quarter >>> 3` for a 32nd). Engravings are rendered with VexFlow using the SMuFL Bravura font.

### Snap-to-Grid Resolutions

OpenDAW Studio (the full DAW UI) ships with a snap menu that maps directly onto these note durations. The labels are useful shorthand worth knowing even if you're building your own UI:

| Studio label | Meaning | PPQN | Notes |
|---|---|---|---|
| `Smart` | Auto-scales with zoom | varies | clamped to `[1/16, Bar]` by default |
| `Bar` | Whole bar (signature-aware) | varies (3840 in 4/4) | uses the active time signature |
| `1/2` | Half note (minim) | 1920 | |
| `1/4` | Quarter note (crotchet) | 960 | |
| `1/8` | Eighth note (quaver) | 480 | |
| `1/8T` | Eighth-note **triplet** | 320 | `PPQN.Quarter / 3` |
| `1/16` | Sixteenth (semiquaver) | 240 | |
| `1/16T` | Sixteenth-note **triplet** | 160 | `PPQN.SemiQuaver * 2 / 3` |
| `1/32` | Thirty-second (demisemiquaver) | 120 | |
| `1/32T` | Thirty-second-note **triplet** | 80 | |
| `1/64` | Sixty-fourth (hemidemisemiquaver) | 60 | |
| `1/128` | One-twenty-eighth | 30 | |
| `Off` | No snap (1 PPQN resolution) | 1 | |

The SDK doesn't bundle a snap module — Studio implements it on top of `quantizeRound`, `quantizeFloor`, `quantizeCeil` from `@opendaw/lib-std`. For your own UI, mirror this list (or trim it) and pick one of those quantize helpers.

### Triplets and Other Tuplets

<svg aria-label="triplet" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="60" viewBox="0 0 140 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1064"><path fill="none" d="M0 40.5L140 40.5"></path><path fill="none" d="M0 50.5L140 50.5"></path><path fill="none" d="M0 60.5L140 60.5"></path><path fill="none" d="M0 70.5L140 70.5"></path><path fill="none" d="M0 80.5L140 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1065"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1066"><rect x="140" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1067"><g class="vf-notehead" id="vf-auto1071"><text stroke="none" font-size="30pt" x="17" y="60"></text></g><rect x="17" y="40.76" width="15.48" height="28.8" opacity="0" pointer-events="auto"></rect></g><g class="vf-stavenote" id="vf-auto1072"><g class="vf-notehead" id="vf-auto1076"><text stroke="none" font-size="30pt" x="49.961" y="60"></text></g><rect x="49.961" y="40.76" width="15.48" height="28.8" opacity="0" pointer-events="auto"></rect></g><g class="vf-stavenote" id="vf-auto1077"><g class="vf-notehead" id="vf-auto1081"><text stroke="none" font-size="30pt" x="82.922" y="60"></text></g><rect x="82.922" y="40.76" width="15.48" height="28.8" opacity="0" pointer-events="auto"></rect></g><g class="vf-beam" id="vf-auto1083"><g class="vf-stem" id="vf-auto1069"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 25.75"></path></g><g class="vf-stem" id="vf-auto1074"><path stroke-width="1.5" fill="none" d="M64.691 60L64.691 25.75"></path></g><g class="vf-stem" id="vf-auto1079"><path stroke-width="1.5" fill="none" d="M97.652 60L97.652 25.75"></path></g><path stroke="none" d="M30.98 25L30.98 30L97.902 30L97.902 25Z"></path></g><g class="vf-tuplet" id="vf-auto1084"><text stroke="none" font-size="30pt" x="50.191" y="30.5"></text><rect width="65.922" opacity="0" pointer-events="auto"></rect></g></svg>

OpenDAW doesn't have a dedicated triplet API, but its choice of **960 pulses per quarter note** is deliberately divisible by both 2 and 3: `960 = 2⁶ × 3 × 5`. That means triplets, quintuplets, and septuplets all land on integer PPQN values without quantization error.

| Tuplet | Each note's PPQN | How to compute |
|---|---|---|
| Eighth-note triplet (3 in 1 quarter) | 320 | `PPQN.Quarter / 3` |
| Quarter-note triplet (3 in 1 half-note) | 640 | `(PPQN.Quarter * 2) / 3` |
| Sixteenth-note triplet (3 in 1 eighth) | 160 | `PPQN.SemiQuaver * 2 / 3` |
| Quintuplet (5 in 1 quarter) | 192 | `PPQN.Quarter / 5` |

Set note durations directly to these values when constructing `NoteEventBox` instances — no special tuplet flag is needed. Studio's snap menu exposes the eighth/sixteenth/thirty-second triplet variants directly as `1/8T`, `1/16T`, `1/32T`.

### Dotted Notes

<svg aria-label="dotted-quaver" role="img" pointer-events="none" stroke-width="1" stroke-dasharray="none" fill="black" stroke="black" shadowColor="black" font-family="Bravura,Academico" font-size="10pt" font-weight="normal" font-style="normal" height="60" viewBox="0 0 80 100" xmlns="http://www.w3.org/2000/svg"><g class="vf-stave" id="vf-auto1064"><path fill="none" d="M0 40.5L80 40.5"></path><path fill="none" d="M0 50.5L80 50.5"></path><path fill="none" d="M0 60.5L80 60.5"></path><path fill="none" d="M0 70.5L80 70.5"></path><path fill="none" d="M0 80.5L80 80.5"></path></g><g class="vf-stavebarline" id="vf-auto1065"><rect y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavebarline" id="vf-auto1066"><rect x="80" y="40" width="1" height="41" stroke="none"></rect></g><g class="vf-stavenote" id="vf-auto1067"><g class="vf-stem" id="vf-auto1069"><path stroke-width="1.5" fill="none" d="M31.73 60L31.73 28"></path></g><g class="vf-notehead" id="vf-auto1071"><text stroke="none" font-size="30pt" x="17" y="60"></text><text stroke="none" font-family="Bravura, Academico" font-size="30pt" x="63.48" y="55"></text></g><g class="vf-flag" id="vf-auto1068"><text stroke="none" font-size="30pt" x="30.98" y="53"></text></g><rect x="17" y="25" width="68.2" height="44.56" opacity="0" pointer-events="auto"></rect></g></svg>

A **dot** after a note adds half its duration: a dotted quaver lasts `1.5 × eighth = 720 PPQN`. There's no SDK constant for dotted durations and Studio's snap menu doesn't include them, but they fall out of arithmetic on existing constants:

| Note | PPQN | Computation |
|---|---|---|
| Dotted minim (dotted half) | 2880 | `PPQN.Quarter * 3` |
| Dotted crotchet (dotted quarter) | 1440 | `PPQN.Quarter + PPQN.Quarter / 2` |
| Dotted quaver (dotted eighth) | 720 | `PPQN.Quarter * 3 / 4` |
| Dotted semiquaver (dotted sixteenth) | 360 | `PPQN.SemiQuaver * 3 / 2` |

## Core DAW Concepts

### 1. Timeline
The horizontal representation of time where audio clips, MIDI notes, and automation are placed. In a DAW, the timeline isn't measured in seconds - it's measured in **musical time**.

### 2. Tracks
Horizontal lanes stacked vertically, each holding audio clips or MIDI data. Each track typically represents one instrument or audio source.

### 3. Clips/Regions
Chunks of audio or MIDI data placed on a track at specific timeline positions.

### 4. Transport
Controls for playing, stopping, recording, and navigating through the timeline.

## Why OpenDAW?

OpenDAW is a headless (UI-less) audio engine that runs in the browser. It provides:

- **Audio processing** via Web Audio API and AudioWorklets
- **Precise timing** using a pulse-based system (PPQN)
- **Data management** through a box graph system
- **Sample loading and peaks generation** for waveform visualization
- **Multi-track mixing** and routing

**Headless** means OpenDAW handles all the audio processing, timing, and data management, but **you build the UI**. This gives you complete control over how your DAW looks and feels.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                       Your UI                            │
│  (Timeline, Waveforms, Transport Controls, Mixer, etc.) │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  OpenDAW Engine                          │
├─────────────────────────────────────────────────────────┤
│  • Box Graph (Data Model)                               │
│  • PPQN Timing System                                   │
│  • Sample Manager                                        │
│  • Audio Worklets (Processing)                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Web Audio API / Browser                     │
└─────────────────────────────────────────────────────────┘
```

## Key Components You'll Work With

### 1. Project
The main entry point - holds the entire DAW session.

### 2. Box Graph
OpenDAW's data model. Everything (tracks, clips, effects, automation) is represented as "boxes" connected in a graph.

### 3. PPQN System
How OpenDAW measures time. Instead of seconds, positions are measured in **pulses** (where 1 quarter note = 960 pulses).

### 4. Sample Manager
Handles loading audio files and generating peaks (waveform data for visualization).

### 5. Engine
The playback engine that processes audio in real-time.

## What You'll Build

When building a DAW UI with OpenDAW, you'll create:

1. **Timeline Visualization** - Shows bars, beats, and clips positioned using PPQN
2. **Waveform Rendering** - Displays audio peaks on canvas
3. **Transport Controls** - Play, pause, stop buttons
4. **Track List** - Shows all tracks with volume/pan controls
5. **Clip Management** - Adding, moving, and editing audio regions

The following documentation will guide you through each of these components in detail.

## Next Steps

Continue to the next document to learn about **PPQN Fundamentals** - the timing system at the heart of OpenDAW.
