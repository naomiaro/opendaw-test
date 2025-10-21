# openDAW Headless App

This is a template to run the openDAW SDK with the least possible number of dependencies.

## Create certificates to get https on localhost (one time only)

`mkcert localhost`

## Installation and Run

* `npm install`
* `npm run dev`



## Example

1. 4 Tape Tracks - Bass & Drums, Guitar, Piano & Synth, and Vocals all playing simultaneously
2. Custom Audio Loading - Loads MP3 files from your public/audio folder
3. Custom Sample Provider - Converts AudioBuffers to OpenDAW's format
4. Three Transport Controls:
    - Play (Blue) - Starts playback from beginning or resumes from pause
    - Pause (Orange) - Pauses and maintains the exact playback position
    - Stop (Red) - Stops and resets to the beginning

  How It Works:

  - The pause button calculates the current playback position using audioContext.currentTime
  and converts it to PPQN (Pulse Per Quarter Note)
  - When resuming from pause, it uses engine.setPosition() to restore the exact position before
   starting playback again
  - All audio tracks are scheduled as AudioRegionBox instances with corresponding AudioFileBox
  references

