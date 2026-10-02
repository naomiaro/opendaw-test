# The SDK's loudness meter against the EBU test signals

Verified against: `@opendaw/studio-sdk` 0.0.173.
Harness: [`loudness-meter-audit-debug-demo.html`](../../loudness-meter-audit-debug-demo.html).

## Bring-up probe (2026-10-02)

Before the harness was built, a throwaway page checked the two things it rests on: that
restarting the engine worklet empties the meter, and that a tone on a Tape track reaches the
engine's output at its synthesized level, sample for sample. It played a 1 kHz tone at
−23 dBFS twice and an fs/4 tone at half scale and 45° once, each for five seconds on a
restarted worklet, at 48 kHz.

```
sample rate 48000
tone-1: first reading integrated -120.00
tone-1: delivered level L -23.001 R -23.001 dBFS
tone-1: delivered sample peak -23.001 dBFS
tone-1: delivered length 5.013 s
tone-1: SDK integrated -23.34 LUFS, SDK peak -23.00 dB
tone-1: readings 351, hidden false
tone-2: first reading integrated -120.00
tone-2: delivered level L -23.001 R -23.001 dBFS
tone-2: delivered sample peak -23.001 dBFS
tone-2: delivered length 5.013 s
tone-2: SDK integrated -23.34 LUFS, SDK peak -23.00 dB
tone-2: readings 357, hidden false
peak: first reading integrated -120.00
peak: delivered level L -6.022 R -6.022 dBFS
peak: delivered sample peak -9.032 dBFS
peak: delivered length 5.013 s
peak: SDK integrated -2.85 LUFS, SDK peak -9.03 dB
peak: readings 357, hidden false
peak: analytic sample peak -9.031 dBFS
```

- A restarted worklet reads integrated −120.00 before anything plays: yes, on all three runs,
  the second and third of which followed a run that had left the previous meter at −23.34.
- A −23 dBFS tone arrives at −23.00 dBFS on both channels: yes (−23.001).
- An fs/4 tone at 45° arrives with its sample peak unchanged (−9.03 dBFS): yes (−9.032
  delivered, −9.031 synthesized).

The delivered length reads 5.013 s for a 5.000 s tone because the tap places the start and
the end to one 1024-frame chunk each.
