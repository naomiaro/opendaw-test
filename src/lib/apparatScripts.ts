// src/lib/apparatScripts.ts

// ---------------------------------------------------------------------------
// Showcase instrument scripts for the Apparat demo.
//
// An Apparat script is a `Processor` class the engine instantiates on the
// AudioWorklet thread. The engine zero-fills the output buffers each block,
// so voices ADD into them. `sampleRate` is a worklet-scope global.
//
//   noteOn(pitch, velocity, cent, id)  — start a voice (id is unique per note)
//   noteOff(id)                        — release the voice with that id
//   process(output, block)             — render [block.s0, block.s1) into output ([outL, outR])
//   paramChanged(label, value)         — a // @param value changed (already mapped)
//   reset()                            — transport reset: fade out fast, drop state
// ---------------------------------------------------------------------------

export interface ShowcaseInstrument {
  name: string;
  description: string;
  script: string;
}

export const SHOWCASE_INSTRUMENTS: ShowcaseInstrument[] = [
  {
    name: "Simple Sine",
    description: "Polyphonic sine with attack/release envelope — the canonical starter",
    script: `// @label Simple Sine
// @param attack 0.01 0.001 1.0 exp s
// @param release 0.3 0.01 2.0 exp s

class Processor {
  voices = []
  attack = 0.01
  release = 0.3

  paramChanged(label, value) {
    if (label === "attack") this.attack = value
    if (label === "release") this.release = value
  }

  noteOn(pitch, velocity, cent, id) {
    this.voices.push({
      id, velocity,
      freq: 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12),
      phase: 0, gain: 0, gate: true, releaseTime: this.release
    })
  }

  noteOff(id) {
    const voice = this.voices.find(v => v.id === id)
    if (voice) voice.gate = false
  }

  reset() {
    for (const voice of this.voices) {
      voice.gate = false
      voice.releaseTime = 0.005
    }
  }

  process(output, block) {
    const [outL, outR] = output
    const attackRate = 1 / (this.attack * sampleRate)
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]
      const releaseRate = 1 / (voice.releaseTime * sampleRate)
      for (let s = block.s0; s < block.s1; s++) {
        if (voice.gate) {
          voice.gain += (voice.velocity - voice.gain) * attackRate
        } else {
          voice.gain -= voice.gain * releaseRate
          if (voice.gain < 0.001) {
            this.voices.splice(i, 1)
            break
          }
        }
        const sample = Math.sin(voice.phase * Math.PI * 2) * voice.gain * 0.3
        outL[s] += sample
        outR[s] += sample
        voice.phase += voice.freq / sampleRate
      }
    }
  }
}`,
  },
  {
    name: "Supersaw",
    description: "Five detuned saws per voice through a one-pole lowpass, spread across the stereo field",
    script: `// @label Supersaw
// @param detune 14 0 50 linear ct
// @param cutoff 2500 100 12000 exp Hz
// @param release 0.35 0.01 2.0 exp s

const SAWS = 5

class Processor {
  voices = []
  detune = 14
  cutoff = 2500
  release = 0.35

  paramChanged(label, value) {
    if (label === "detune") this.detune = value
    if (label === "cutoff") this.cutoff = value
    if (label === "release") this.release = value
  }

  noteOn(pitch, velocity, cent, id) {
    const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
    const oscs = []
    for (let k = 0; k < SAWS; k++) {
      const spread = (k - (SAWS - 1) / 2) / ((SAWS - 1) / 2) // -1..1
      oscs.push({
        phase: Math.random(),
        freq: freq * Math.pow(2, (spread * this.detune) / 1200),
        panL: Math.cos(((spread + 1) / 4) * Math.PI),
        panR: Math.sin(((spread + 1) / 4) * Math.PI)
      })
    }
    this.voices.push({ id, velocity, oscs, gain: 0, gate: true, lpL: 0, lpR: 0, releaseTime: this.release })
  }

  noteOff(id) {
    const voice = this.voices.find(v => v.id === id)
    if (voice) voice.gate = false
  }

  reset() {
    for (const voice of this.voices) {
      voice.gate = false
      voice.releaseTime = 0.005
    }
  }

  process(output, block) {
    const [outL, outR] = output
    const attackRate = 1 / (0.004 * sampleRate)
    const alpha = 1 - Math.exp((-2 * Math.PI * this.cutoff) / sampleRate)
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]
      const releaseRate = 1 / (voice.releaseTime * sampleRate)
      for (let s = block.s0; s < block.s1; s++) {
        if (voice.gate) {
          voice.gain += (voice.velocity - voice.gain) * attackRate
        } else {
          voice.gain -= voice.gain * releaseRate
          if (voice.gain < 0.001) {
            this.voices.splice(i, 1)
            break
          }
        }
        let sumL = 0
        let sumR = 0
        for (const osc of voice.oscs) {
          const saw = 2 * osc.phase - 1
          sumL += saw * osc.panL
          sumR += saw * osc.panR
          osc.phase += osc.freq / sampleRate
          if (osc.phase >= 1) osc.phase -= 1
        }
        const scale = (voice.gain * 0.6) / SAWS
        voice.lpL += alpha * (sumL * scale - voice.lpL)
        voice.lpR += alpha * (sumR * scale - voice.lpR)
        outL[s] += voice.lpL
        outR[s] += voice.lpR
      }
    }
  }
}`,
  },
  {
    name: "FM Bell",
    description: "Two-operator FM with a decaying modulation index — classic metallic bell tones",
    script: `// @label FM Bell
// @param ratio 3.5 0.25 8.0
// @param brightness 4 0 12
// @param decay 1.5 0.1 5.0 exp s

const TWO_PI = Math.PI * 2

class Processor {
  voices = []
  ratio = 3.5
  brightness = 4
  decay = 1.5

  paramChanged(label, value) {
    if (label === "ratio") this.ratio = value
    if (label === "brightness") this.brightness = value
    if (label === "decay") this.decay = value
  }

  noteOn(pitch, velocity, cent, id) {
    this.voices.push({
      id, velocity,
      freq: 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12),
      carPhase: 0, modPhase: 0, env: 1, gate: true, decayTime: this.decay
    })
  }

  noteOff(id) {
    const voice = this.voices.find(v => v.id === id)
    if (voice) voice.gate = false
  }

  reset() {
    for (const voice of this.voices) {
      voice.gate = false
      voice.decayTime = 0.005
    }
  }

  process(output, block) {
    const [outL, outR] = output
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]
      // A bell rings freely while held; the release just hurries the decay.
      const time = voice.gate ? voice.decayTime : Math.min(voice.decayTime, 0.15)
      const coef = Math.exp(-1 / (time * sampleRate))
      for (let s = block.s0; s < block.s1; s++) {
        voice.env *= coef
        if (voice.env < 0.001) {
          this.voices.splice(i, 1)
          break
        }
        const mod = Math.sin(voice.modPhase * TWO_PI) * this.brightness * voice.env
        const sample = Math.sin(voice.carPhase * TWO_PI + mod) * voice.env * voice.velocity * 0.35
        outL[s] += sample
        outR[s] += sample
        voice.carPhase += voice.freq / sampleRate
        voice.modPhase += (voice.freq * this.ratio) / sampleRate
      }
    }
  }
}`,
  },
  {
    name: "Karplus Pluck",
    description: "Karplus-Strong plucked string — a filtered noise burst circulating in a delay line",
    script: `// @label Karplus Pluck
// @param damping 0.3 0 0.9
// @param brightness 0.7 0.05 1.0

class Processor {
  voices = []
  damping = 0.3
  brightness = 0.7

  paramChanged(label, value) {
    if (label === "damping") this.damping = value
    if (label === "brightness") this.brightness = value
  }

  noteOn(pitch, velocity, cent, id) {
    const freq = 440 * Math.pow(2, (pitch - 69 + cent / 100) / 12)
    const length = Math.max(2, Math.round(sampleRate / freq))
    const buffer = new Float32Array(length) // per-note allocation is fine; per-block is not
    let lp = 0
    const filter = 0.15 + 0.85 * this.brightness
    for (let i = 0; i < length; i++) {
      lp += filter * (Math.random() * 2 - 1 - lp)
      buffer[i] = lp * velocity
    }
    this.voices.push({ id, buffer, pos: 0, gate: true, killed: false, peak: 1, heard: 0 })
  }

  noteOff(id) {
    const voice = this.voices.find(v => v.id === id)
    if (voice) voice.gate = false
  }

  reset() {
    // Fast-fade contract: pin the feedback low so the string dies in milliseconds.
    for (const voice of this.voices) voice.killed = true
  }

  process(output, block) {
    const [outL, outR] = output
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i]
      const feedback = voice.killed ? 0.5 : voice.gate ? 0.999 - this.damping * 0.02 : 0.98
      const buffer = voice.buffer
      const length = buffer.length
      let peak = 0
      for (let s = block.s0; s < block.s1; s++) {
        const current = buffer[voice.pos]
        const next = buffer[(voice.pos + 1) % length]
        buffer[voice.pos] = (current + next) * 0.5 * feedback
        voice.pos = (voice.pos + 1) % length
        const abs = current < 0 ? -current : current
        if (abs > peak) peak = abs
        outL[s] += current * 0.8
        outR[s] += current * 0.8
      }
      // The engine splits quanta at event boundaries, so a block can be a few
      // samples long (or empty). Judge removal on a decaying running peak over
      // real samples, never on one short block sitting near a zero-crossing.
      if (block.s1 > block.s0) {
        voice.heard += block.s1 - block.s0
        voice.peak = Math.max(peak, voice.peak * 0.5)
      }
      if (voice.heard >= length * 3 && voice.peak < 0.0005) this.voices.splice(i, 1)
    }
  }
}`,
  },
];
