// Exact transcription of TapeDeviceProcessor pitch path @ studio-core 0.0.152
// for the touching-seam scenario of shared-source-double-process-debug-demo.tsx.
// Two NoStretch regions, same 60s 440Hz 0.5-amp sine (decoded to 48k), BPM 120.
"use strict";

const SR = 48000;
const RenderQuantum = 128;
const Quarter = 960;
const BPM = 120;
const FREQ = 440;
const AMP = 0.5;
const VOICE_FADE_DURATION = 0.020;
const fadeLengthSamples = Math.round(VOICE_FADE_DURATION * SR); // 960

const secondsToPulses = (seconds, bpm) => seconds * bpm / 60.0 * Quarter;
const pulsesToSeconds = (pulses, bpm) => (pulses * 60.0 / Quarter) / bpm;
const samplesToPulses = (samples, bpm, sr) => secondsToPulses(samples / sr, bpm);

// "decoded" source data: pure sine at 48k (decodeAudioData resamples 44.1k->48k)
const FILE_SECONDS = 60;
const numberOfFrames = FILE_SECONDS * SR;
const src = new Float64Array(numberOfFrames);
for (let n = 0; n < numberOfFrames; n++) src[n] = AMP * Math.sin(2 * Math.PI * FREQ * n / SR);
const dataSampleRate = SR;

// ---- PitchVoice (verbatim port) ----
const VS = { Active: 0, Fading: 1, Done: 2 };
class PitchVoice {
  constructor(uuid, output, fadeLength, playbackRate, offset, blockOffset) {
    this.sourceUuid = uuid;
    this.output = output;
    this.fadeLength = fadeLength;
    this.playbackRate = playbackRate;
    this.readPosition = offset;
    this.blockOffset = blockOffset;
    this.fadeProgress = 0.0;
    this.fadeOutBlockOffset = 0;
    this.lastFinalAmplitude = 1.0;
    if (this.readPosition >= numberOfFrames) { this.state = VS.Done; this.fadeDirection = 0; }
    else if (offset === 0) { this.state = VS.Active; this.fadeDirection = 0; }
    else { this.state = VS.Fading; this.fadeDirection = 1.0; }
  }
  done() { return this.state === VS.Done; }
  isFadingOut() { return this.state === VS.Fading && this.fadeDirection < 0; }
  startFadeOut(blockOffset) {
    if (this.state !== VS.Done && !(this.state === VS.Fading && this.fadeDirection < 0)) {
      this.state = VS.Fading;
      this.fadeDirection = -1.0;
      this.fadeProgress = this.fadeLength * (1.0 - this.lastFinalAmplitude);
      this.fadeOutBlockOffset = blockOffset;
    }
  }
  setPlaybackRate(rate) { this.playbackRate = rate; }
  process(bufferStart, bufferCount, fadingGainBuffer, quantumBase, log) {
    const fadeLength = this.fadeLength;
    const playbackRate = this.playbackRate;
    const fadeOutThreshold = numberOfFrames - fadeLength * playbackRate;
    const blockOffset = this.blockOffset;
    const fadeOutBlockOffset = this.fadeOutBlockOffset;
    let state = this.state, fadeDirection = this.fadeDirection;
    let readPosition = this.readPosition, fadeProgress = this.fadeProgress;
    let lastFinalAmplitude = this.lastFinalAmplitude;
    for (let i = 0; i < bufferCount; i++) {
      if (state === VS.Done) break;
      if (i < blockOffset) continue;
      const j = bufferStart + i;
      let amplitude;
      if (state === VS.Fading && fadeDirection > 0) {
        amplitude = fadeProgress / fadeLength;
        if (++fadeProgress >= fadeLength) { state = VS.Active; fadeProgress = 0.0; fadeDirection = 0.0; }
      } else if (state === VS.Fading && fadeDirection < 0) {
        if (i < fadeOutBlockOffset) { amplitude = 1.0; }
        else {
          amplitude = 1.0 - fadeProgress / fadeLength;
          if (++fadeProgress >= fadeLength) { state = VS.Done; break; }
        }
      } else { amplitude = 1.0; }
      const finalAmplitude = amplitude * fadingGainBuffer[i];
      lastFinalAmplitude = finalAmplitude;
      const readInt = readPosition | 0;
      if (readInt >= 0 && readInt < numberOfFrames - 1) {
        const alpha = readPosition - readInt;
        const sL = src[readInt];
        this.output[quantumBase + j] += (sL + alpha * (src[readInt + 1] - sL)) * finalAmplitude;
        if (log) log.push({ globalSample: quantumBase + j, voice: this.sourceUuid, amp: finalAmplitude, read: readPosition });
      }
      readPosition += playbackRate;
      if (state === VS.Active && readPosition >= fadeOutThreshold) {
        state = VS.Fading; fadeDirection = -1.0; fadeProgress = 0.0;
      }
    }
    this.state = state; this.fadeDirection = fadeDirection;
    this.readPosition = readPosition; this.fadeProgress = fadeProgress;
    this.lastFinalAmplitude = lastFinalAmplitude;
    this.blockOffset = 0; this.fadeOutBlockOffset = 0;
  }
}

// ---- locateLoops (verbatim) ----
function* locateLoops({ position, complete, loopOffset, loopDuration }, from, to) {
  const offset = position - loopOffset;
  const seekMin = Math.max(position, from);
  const seekMax = Math.min(complete, to);
  let passIndex = Math.floor((seekMin - offset) / loopDuration);
  let rawStart = offset + passIndex * loopDuration;
  while (rawStart < seekMax) {
    const rawEnd = rawStart + loopDuration;
    const resultStart = Math.max(rawStart, seekMin);
    const resultEnd = Math.min(rawEnd, seekMax);
    yield {
      index: passIndex++, rawStart, rawEnd,
      resultStart, resultEnd,
      resultStartValue: rawStart < resultStart ? (resultStart - rawStart) / loopDuration : 0.0,
      resultEndValue: rawEnd > resultEnd ? (resultEnd - rawStart) / loopDuration : 1.0,
    };
    rawStart = rawEnd;
  }
}

// ---- scenario ----
function simulate(startSeconds, seamSeconds, renderSeconds, verboseWindow) {
  const seamPPQN = secondsToPulses(seamSeconds, BPM);
  const fullPPQN = secondsToPulses(FILE_SECONDS, BPM);
  const regions = [
    { uuid: "A", position: 0, duration: seamPPQN, get complete() { return this.position + this.duration; }, loopOffset: 0, loopDuration: fullPPQN },
    { uuid: "B", position: seamPPQN, duration: fullPPQN - seamPPQN, get complete() { return this.position + this.duration; }, loopOffset: seamPPQN, loopDuration: fullPPQN },
  ];
  const numSamples = Math.ceil(renderSeconds * SR);
  const out = new Float64Array(numSamples + RenderQuantum);
  const pitchVoices = new Map(); // uuid -> voice
  let fadingVoices = [];
  const unitGain = new Float64Array(RenderQuantum).fill(1.0);
  const gainBuffer = new Float64Array(RenderQuantum).fill(1.0);
  const events = [];

  let p0 = secondsToPulses(startSeconds, BPM); // setPosition (exact float; integer here)
  let quantumBase = 0;
  while (quantumBase < numSamples) {
    const s0 = 0, sn = RenderQuantum, s1 = RenderQuantum;
    const p1 = p0 + samplesToPulses(sn, BPM, SR);
    const pn = p1 - p0;
    // iterateRange(p0, p1): regions with complete > p0 && position < p1
    const visited = [];
    for (const region of regions) {
      if (region.complete <= p0 || region.position >= p1) continue;
      visited.push(region.uuid);
      for (const cycle of locateLoops(region, p0, p1)) {
        // NoStretch branch of #processPassPitch
        const r0 = (cycle.resultStart - p0) / pn;
        const r1 = (cycle.resultEnd - p0) / pn;
        const bp0 = s0 + sn * r0;
        const bp1 = s0 + sn * r1;
        const bpn = (bp1 - bp0) | 0;
        const elapsedSeconds = pulsesToSeconds(cycle.resultStart - cycle.rawStart, BPM);
        const offset = elapsedSeconds * dataSampleRate;
        const playbackRate = dataSampleRate / SR;
        // updateOrCreatePitchVoice
        const existing = pitchVoices.get(region.uuid) ?? null;
        if (existing === null) {
          pitchVoices.set(region.uuid, new PitchVoice(region.uuid, out, fadeLengthSamples, playbackRate, offset, 0));
          events.push({ at: quantumBase, ev: `create ${region.uuid} offset=${offset} bp0=${bp0} bpn=${bpn}` });
        } else {
          const drift = Math.abs(existing.readPosition - offset);
          if (drift > fadeLengthSamples) {
            existing.startFadeOut(0);
            fadingVoices.push(existing);
            pitchVoices.set(region.uuid, new PitchVoice(region.uuid, out, fadeLengthSamples, playbackRate, offset, 0));
            events.push({ at: quantumBase, ev: `drift-replace ${region.uuid} drift=${drift}` });
          } else { existing.setPlaybackRate(playbackRate); }
        }
        gainBuffer.fill(1.0, 0, Math.max(0, bpn)); // no region fades in this scenario
        const voice = pitchVoices.get(region.uuid) ?? null;
        if (voice !== null) {
          voice.process(bp0 | 0, bpn, gainBuffer, quantumBase, null);
          if (voice.done()) { pitchVoices.delete(region.uuid); events.push({ at: quantumBase, ev: `done-in-pitch ${region.uuid}` }); }
        }
      }
    }
    // removeByPredicate: evict voices for unvisited regions
    for (const [uuid, voice] of [...pitchVoices.entries()]) {
      if (!visited.includes(uuid)) {
        voice.startFadeOut(0);
        fadingVoices.push(voice);
        pitchVoices.delete(uuid);
        events.push({ at: quantumBase, ev: `evict->fading ${uuid} readPos=${voice.readPosition}` });
      }
    }
    for (const voice of fadingVoices) voice.process(s0, s1 - s0, unitGain, quantumBase, null);
    fadingVoices = fadingVoices.filter(v => !v.done());
    p0 = p1;
    quantumBase += RenderQuantum;
  }

  // metrics (mirror page math)
  const seamIdxFloat = (seamSeconds - startSeconds) * SR;
  function maxDeltaInWindow(aSec, bSec) {
    const i0 = Math.max(1, Math.floor((aSec - startSeconds) * SR));
    const i1 = Math.min(numSamples, Math.ceil((bSec - startSeconds) * SR));
    let md = 0, at = i0;
    for (let i = i0; i < i1; i++) {
      const d = Math.abs(out[i] - out[i - 1]);
      if (d > md) { md = d; at = i - 1; }
    }
    return { md, at };
  }
  function peakInWindow(aSec, bSec) {
    const i0 = Math.max(0, Math.floor((aSec - startSeconds) * SR));
    const i1 = Math.min(numSamples, Math.ceil((bSec - startSeconds) * SR));
    let pk = 0, at = i0;
    for (let i = i0; i < i1; i++) { const v = Math.abs(out[i]); if (v > pk) { pk = v; at = i; } }
    return { pk, at };
  }
  const pre = maxDeltaInWindow(seamSeconds - 0.05, seamSeconds - 0.02);
  const seam = maxDeltaInWindow(seamSeconds - 0.005, seamSeconds + 0.005);
  const prePeak = peakInWindow(seamSeconds - 0.05, seamSeconds - 0.02);
  const fadeWinPeak = peakInWindow(seamSeconds, seamSeconds + 0.020);
  // sliding-envelope min over crossfade region (2.5ms windows, half stride)
  function minEnvelope(aSec, bSec, windowMs = 2.5) {
    const w = Math.round(windowMs / 1000 * SR), stride = Math.floor(w / 2);
    const i0 = Math.max(0, Math.floor((aSec - startSeconds) * SR));
    const i1 = Math.min(numSamples, Math.ceil((bSec - startSeconds) * SR));
    let minPk = Infinity, at = i0;
    for (let s = i0; s + w <= i1; s += stride) {
      let pk = 0;
      for (let i = s; i < s + w; i++) { const v = Math.abs(out[i]); if (v > pk) pk = v; }
      if (pk < minPk) { minPk = pk; at = s + (w >> 1); }
    }
    return { minPk, at };
  }
  const env = minEnvelope(seamSeconds, seamSeconds + 0.025);
  console.log(`--- start=${startSeconds}s seam=${seamSeconds}s (seam at slice sample ${seamIdxFloat}, in-block offset ${seamIdxFloat % 128}) ---`);
  console.log(`pre-seam peak        ${prePeak.pk.toFixed(4)}`);
  console.log(`expected clean |d|   ${(2 * Math.PI * FREQ * AMP / SR).toFixed(5)}`);
  console.log(`pre-seam max |d|     ${pre.md.toFixed(5)}`);
  console.log(`seam-band max |d|    ${seam.md.toFixed(5)} at slice sample ${seam.at} (tau = ${((seam.at - seamIdxFloat) / SR * 1000).toFixed(3)} ms)`);
  console.log(`voice-fade-window pk ${fadeWinPeak.pk.toFixed(4)}`);
  console.log(`min envelope [seam, seam+25ms] (2.5ms win): ${env.minPk.toFixed(4)} (${(20 * Math.log10(env.minPk / 0.5)).toFixed(1)} dB) at +${((env.at - seamIdxFloat) / SR * 1000).toFixed(2)} ms`);
  for (const e of events) console.log(`  [q@${e.at}] ${e.ev}`);
  if (verboseWindow) {
    const c = Math.round(seamIdxFloat);
    console.log("samples around seam (idx rel seam: value, clean, gainEst):");
    for (let i = c - 3; i <= c + 3; i++) {
      const t = (startSeconds * SR + i);
      const clean = AMP * Math.sin(2 * Math.PI * FREQ * t / SR);
      const g = Math.abs(clean) > 1e-4 ? (out[i] / clean).toFixed(4) : "  -  ";
      console.log(`  ${String(i - c).padStart(4)}: ${out[i].toFixed(6).padStart(10)}  clean ${clean.toFixed(6).padStart(10)}  g=${g}`);
    }
    console.log("samples at +60..+72 and +480, +960, +1030 (crossfade structure):");
    for (const i of [c + 60, c + 61, c + 62, c + 63, c + 64, c + 65, c + 66, c + 70, c + 72, c + 240, c + 480, c + 720, c + 960, c + 1024, c + 1030]) {
      const t = (startSeconds * SR + i);
      const clean = AMP * Math.sin(2 * Math.PI * FREQ * t / SR);
      const g = Math.abs(clean) > 1e-4 ? (out[i] / clean).toFixed(4) : "  -  ";
      console.log(`  ${String(i - c).padStart(4)}: ${out[i].toFixed(6).padStart(10)}  clean ${clean.toFixed(6).padStart(10)}  g=${g}`);
    }
  }
  return out;
}

// OFFLINE scan geometry: render starts 0.1 s before seam (renderOfflineSlice)
simulate(29.9, 30.0, 0.2, true);
simulate(30.4, 30.5, 0.2, true);
// LIVE geometry: playback starts at 28.0 s
simulate(28.0, 30.0, 2.6, true);
simulate(28.0, 30.5, 3.1, true);
