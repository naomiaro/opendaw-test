#!/usr/bin/env python3
"""Compare detected beats (from audio-analyzer rhythm_analysis) against expected
times (from scripts/expected-beats.ts). Used by the audio-verify skill.

Usage:
  node scripts/expected-beats.ts > /tmp/expected.json
  python3 scripts/compare-beats.py /tmp/expected.json <list> "60.01, 60.42, ..."

<list> is one of: gridTimes | fileTimes | fileTimesRigid | rigidClickTimes.

Prints JSON: n, median_ms, p90_ms, max_ms of nearest-expected distances.
The metric saturates at half the median inter-beat interval (~244 ms at
123 BPM): misalignment reads as ~120-244 ms, never seconds.
"""
import json
import sys

if len(sys.argv) != 4:
    sys.exit(__doc__)

expected = json.load(open(sys.argv[1]))
exp = expected[sys.argv[2]]

detected = [float(t.strip().rstrip("s")) for t in sys.argv[3].split(",") if t.strip()]
if not detected:
    sys.exit("no detected beats given")

dists_ms = sorted(min(abs(t - e) for e in exp) * 1000 for t in detected)
n = len(dists_ms)
median = dists_ms[n // 2] if n % 2 else (dists_ms[n // 2 - 1] + dists_ms[n // 2]) / 2
print(json.dumps({
    "n": n,
    "median_ms": round(median, 1),
    "p90_ms": round(dists_ms[min(n - 1, int(n * 0.9))], 1),
    "max_ms": round(dists_ms[-1], 1),
}))
