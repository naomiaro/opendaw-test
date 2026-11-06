<!-- Not posted. Waiting for a read. The note link below needs the note pushed to main first. -->

# "With Effects" monitoring reaches the output twice: is the main-mix route intended?

**Build:** https://opendaw.studio, build `adc1d47d-eda2-406c-a1ef-87a7bbd61f83` (2026-11-04), Chrome, macOS, 48 kHz.

With monitoring set to With Effects, the live input leaves the engine on both worklet outputs: output 1 (the monitor
return) and output 0 (the main mix). Both reach the destination. Delay compensation moves only the main-mix copy, so with
a latent device anywhere in the project the two arrive that far apart, also when the device is on a muted track, since
mute does not change compensation.

**Steps**

1. New Project, Add audio track.
2. Track menu → Monitoring. Set Mode to With Effects.
3. Watch the main meter while the input has signal. Tick Mute in the dialog: the main meter keeps moving.
4. Add a second audio track, add Autotune to it, mute that track. The footer reads `PDC 26.7ms`.

**Measured.** A 0.3-peak burst stream replaced the microphone, and worklet outputs 0 and 1 were recorded side by side,
so no acoustic path is involved.

| Mode | Project | Output 0 (main) | Output 1 (monitor) | Output 0 minus output 1 |
|---|---|---|---|---|
| Off | one armed track | 0 | 0 | |
| Direct | one armed track | 0 | 0 | |
| With Effects | one armed track | 0.3 | 0.3 | 0 frames |
| With Effects, Mute ticked | one armed track | 0.3 | 0.3, tapped before the mute gain | 0 frames |
| With Effects | plus a muted track with Autotune | 0.3 | 0.3 | **+1280 frames (26.67 ms)** |

Without a latent device the two copies coincide, which by addition doubles the level (+6 dB). I did not measure the sum at
the destination.

**To hear it:** with headphones and a real microphone, replace the Autotune with a Werkstatt whose script starts with
`// @latency 99`, keep that track muted, and speak. In With Effects a second, later copy is audible, and it goes away in
Direct.

**Where it happens** (read at `@opendaw/studio-sdk@0.0.181`): `audio_region_player.rs:358` sums the input into the armed
tape's output, `wiring.rs:825` routes the strip to the output bus, `copy_monitor_outputs` (`lib.rs:2171`) copies the same
strip to the second output, and `BrowserMonitor.ts:135` connects that to the destination.

`plans/done/advanced-monitoring.md:317` lists "Effects monitoring not in main mix" as a test, and
`plans/delay-compensation.md:153` says a monitored unit "hears its input through compensation as well". So I can't tell
which behaviour you intend, and I'm asking rather than assuming this is a defect.

Note with the probe: https://github.com/naomiaro/opendaw-test/blob/main/debug/2026-11-05-effects-monitoring-two-routes/note.md
