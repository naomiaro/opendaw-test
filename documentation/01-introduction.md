# Introduction to OpenDAW Architecture

## What is a DAW?

A **DAW (Digital Audio Workstation)** is software for recording, editing, and producing audio. Think of applications like Ableton Live, Logic Pro, or FL Studio.

## Core DAW Concepts

### 1. Timeline
The horizontal representation of time where audio clips, MIDI notes, and automation are placed. In a DAW, the timeline isn't measured in seconds - it's measured in **musical time**.

### 2. Tracks
Vertical lanes that hold audio clips or MIDI data. Each track typically represents one instrument or audio source.

### 3. Clips/Regions
Chunks of audio or MIDI data placed on the timeline at specific positions.

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
│                     Your React UI                        │
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
