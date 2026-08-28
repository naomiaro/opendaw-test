<!-- DRAFT — pending user review, not posted -->

Datapoint from a cross-rate sample-rate/quantum-alignment audit (SDK 0.0.170): the
count-in boundary click reproduces live at 44.1 kHz with a real microphone recording
and real trusted clicks — 120 BPM, Click set to "Count-in only", count-in on, measured
via an `AudioNode.prototype.connect`-taped `AnalyserNode` on the destination connection
(`swipe-comping-demo.html`). Detected 5 distinct RMS-energy clusters at relative onsets
≈0, 452, 949, 1447, 1951 ms — uniform ~475–500 ms spacing matching the 120 BPM
quarter-note grid, i.e. the expected 4 count-in clicks plus one extra at the punch-in
downbeat.

A parallel attempt at 48 kHz was inconclusive — a browser-automation tooling limitation
in that session (the output-tap race was lost on every fresh 48 kHz page load), not a
measurement that found no leak. No claim is made about the click's presence or absence
at 48 kHz from this session; the mechanism described in the issue (a position/quantum
comparison, not a rate-specific constant) is expected to reproduce there too.

Full campaign note: https://github.com/naomiaro/opendaw-test/blob/main/debug/sample-rate-alignment-audit.md#step-2-367-known-positive-validation
