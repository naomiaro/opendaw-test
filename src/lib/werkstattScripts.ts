// src/lib/werkstattScripts.ts

// ---------------------------------------------------------------------------
// Showcase effect scripts
// ---------------------------------------------------------------------------

export interface ShowcaseEffect {
  name: string;
  description: string;
  script: string;
}

export const SHOWCASE_EFFECTS: ShowcaseEffect[] = [
  {
    name: "Tremolo",
    description: "Amplitude modulation via LFO",
    script: `// @param rate 4 0.5 20 exp Hz
// @param depth 0.5

class Processor {
  rate = 4
  depth = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.rate / sampleRate
    for (let i = s0; i < s1; i++) {
      const lfo = 1 - this.depth * (0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI))
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] * lfo
      outR[i] = srcR[i] * lfo
    }
  }
}`,
  },
  {
    name: "Ring Modulator",
    description: "Amplitude multiplication with a sine carrier",
    script: `// @param frequency 440 20 20000 exp Hz
// @param mix 0.5

class Processor {
  frequency = 440
  mix = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
    if (label === "mix") this.mix = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.frequency / sampleRate
    for (let i = s0; i < s1; i++) {
      const mod = Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const wet = this.mix
      const dry = 1 - wet
      outL[i] = srcL[i] * dry + srcL[i] * mod * wet
      outR[i] = srcR[i] * dry + srcR[i] * mod * wet
    }
  }
}`,
  },
  {
    name: "Lowpass Filter",
    description: "Classic 2nd-order biquad IIR lowpass",
    script: `// @param cutoff 1000 20 20000 exp Hz
// @param resonance 0.707 0.1 20 exp

class Processor {
  cutoff = 1000
  resonance = 0.707
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0
  xL1 = 0; xL2 = 0; yL1 = 0; yL2 = 0
  xR1 = 0; xR2 = 0; yR1 = 0; yR2 = 0

  constructor() { this.recalc() }

  paramChanged(label, value) {
    if (label === "cutoff") this.cutoff = value
    if (label === "resonance") this.resonance = value
    this.recalc()
  }

  recalc() {
    const w0 = 2 * Math.PI * this.cutoff / sampleRate
    const alpha = Math.sin(w0) / (2 * this.resonance)
    const cosw0 = Math.cos(w0)
    const a0 = 1 + alpha
    this.b0 = ((1 - cosw0) / 2) / a0
    this.b1 = (1 - cosw0) / a0
    this.b2 = this.b0
    this.a1 = (-2 * cosw0) / a0
    this.a2 = (1 - alpha) / a0
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      const xL = srcL[i]
      outL[i] = this.b0*xL + this.b1*this.xL1 + this.b2*this.xL2 - this.a1*this.yL1 - this.a2*this.yL2
      this.xL2 = this.xL1; this.xL1 = xL; this.yL2 = this.yL1; this.yL1 = outL[i]
      const xR = srcR[i]
      outR[i] = this.b0*xR + this.b1*this.xR1 + this.b2*this.xR2 - this.a1*this.yR1 - this.a2*this.yR2
      this.xR2 = this.xR1; this.xR1 = xR; this.yR2 = this.yR1; this.yR1 = outR[i]
    }
  }
}`,
  },
  {
    name: "Chorus",
    description: "Modulated delay line chorus effect",
    script: `// @param rate 1.5 0.1 10 exp Hz
// @param depth 0.5
// @param mix 0.5

class Processor {
  rate = 1.5
  depth = 0.5
  mix = 0.5
  phase = 0
  bufL = new Float32Array(4096)
  bufR = new Float32Array(4096)
  writePos = 0

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
    if (label === "mix") this.mix = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const maxDelay = 2048
    const phaseInc = this.rate / sampleRate
    const mask = 4095
    for (let i = s0; i < s1; i++) {
      this.bufL[this.writePos & mask] = srcL[i]
      this.bufR[this.writePos & mask] = srcR[i]
      const lfo = 0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const delaySamples = 256 + lfo * this.depth * maxDelay
      const readPos = this.writePos - delaySamples
      const idx = Math.floor(readPos) & mask
      const frac = readPos - Math.floor(readPos)
      const idx1 = (idx + 1) & mask
      const wetL = this.bufL[idx] * (1 - frac) + this.bufL[idx1] * frac
      const wetR = this.bufR[idx] * (1 - frac) + this.bufR[idx1] * frac
      outL[i] = srcL[i] * (1 - this.mix) + wetL * this.mix
      outR[i] = srcR[i] * (1 - this.mix) + wetR * this.mix
      this.writePos++
    }
  }
}`,
  },
  {
    name: "Phaser",
    description: "All-pass filter chain with LFO modulation",
    script: `// @param rate 0.5 0.1 10 exp Hz
// @param depth 0.5
// @param stages 4 2 12 int

class Processor {
  rate = 0.5
  depth = 0.5
  stages = 4
  phase = 0
  apL = new Float64Array(12)
  apR = new Float64Array(12)

  paramChanged(label, value) {
    if (label === "rate") this.rate = value
    if (label === "depth") this.depth = value
    if (label === "stages") this.stages = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    const phaseInc = this.rate / sampleRate
    for (let i = s0; i < s1; i++) {
      const lfo = 0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      const minFreq = 200
      const maxFreq = 4000
      const freq = minFreq + lfo * this.depth * (maxFreq - minFreq)
      const coeff = (Math.tan(Math.PI * freq / sampleRate) - 1) / (Math.tan(Math.PI * freq / sampleRate) + 1)
      let sL = srcL[i]
      let sR = srcR[i]
      for (let s = 0; s < this.stages; s++) {
        const inL = sL
        sL = coeff * inL + this.apL[s]
        this.apL[s] = inL - coeff * sL
        const inR = sR
        sR = coeff * inR + this.apR[s]
        this.apR[s] = inR - coeff * sR
      }
      outL[i] = 0.5 * (srcL[i] + sL)
      outR[i] = 0.5 * (srcR[i] + sR)
    }
  }
}`,
  },
];

// ---------------------------------------------------------------------------
// Test signal generator scripts
// ---------------------------------------------------------------------------

export const SINE_GENERATOR_SCRIPT = `// @param frequency 440 20 2000 exp Hz

class Processor {
  frequency = 440
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
  }

  process({src, out}, block) {
    const [, ] = src
    const [outL, outR] = out
    if (!(block.flags & 4)) return
    const phaseInc = this.frequency / sampleRate
    for (let i = block.s0; i < block.s1; i++) {
      const sample = 0.3 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = sample
      outR[i] = sample
    }
  }
}`;

export const NOISE_GENERATOR_SCRIPT = `class Processor {
  seed = 1

  process({src, out}, block) {
    const [, ] = src
    const [outL, outR] = out
    if (!(block.flags & 4)) return
    for (let i = block.s0; i < block.s1; i++) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
      const sample = 0.3 * (this.seed / 0x7fffffff * 2 - 1)
      outL[i] = sample
      outR[i] = sample
    }
  }
}`;

// ---------------------------------------------------------------------------
// API Reference examples
// ---------------------------------------------------------------------------

export interface ApiExample {
  id: string;
  title: string;
  description: string;
  script: string | null;
}

export const API_EXAMPLES: ApiExample[] = [
  {
    id: "processor-class",
    title: "The Processor Class",
    description:
      "Every Werkstatt script must define a Processor class with a process() method. " +
      "The first argument provides src (input channels) and out (output channels) as Float32Array arrays. " +
      "The second argument provides s0 (first sample index, inclusive) and s1 (last sample index, exclusive).",
    script: `class Processor {
  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i]
      outR[i] = srcR[i]
    }
  }
}`,
  },
  {
    id: "param-declarations",
    title: "Parameter Declarations",
    description:
      "Declare parameters with // @param comments. The SDK creates UI knobs and calls paramChanged(label, value) when they change. " +
      "Formats: default (0-1, no type keyword), linear (min-max), exp (exponential), int (integer), bool (on/off).",
    script: `// @param gain 1.0
// @param mix 0.5 0 1 linear
// @param cutoff 1000 20 20000 exp Hz
// @param steps 4 1 16 int
// @param bypass false

class Processor {
  gain = 1
  mix = 0.5
  cutoff = 1000
  steps = 4
  bypass = 0

  paramChanged(label, value) {
    this[label] = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    for (let i = s0; i < s1; i++) {
      outL[i] = srcL[i] * this.gain
      outR[i] = srcR[i] * this.gain
    }
  }
}`,
  },
  {
    id: "block-object",
    title: "The Block Object",
    description:
      "The second argument to process() contains timing and transport info: " +
      "s0/s1 (sample range), index (block counter), bpm (tempo), p0/p1 (PPQN position), " +
      "flags (bitmask: 1=transporting, 2=discontinuous, 4=playing, 8=bpmChanged).",
    script: `// @param depth 0.5

class Processor {
  depth = 0.5
  phase = 0

  paramChanged(label, value) {
    if (label === "depth") this.depth = value
  }

  process({src, out}, block) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    // Tempo-synced tremolo: rate = 1/4 note = bpm/60 Hz
    const rate = block.bpm / 60
    const phaseInc = rate / sampleRate
    for (let i = block.s0; i < block.s1; i++) {
      const lfo = 1 - this.depth * (0.5 + 0.5 * Math.sin(this.phase * 2 * Math.PI))
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] * lfo
      outR[i] = srcR[i] * lfo
    }
  }
}`,
  },
  {
    id: "sample-rate",
    title: "The sampleRate Global",
    description:
      "sampleRate is the only global variable available in a Werkstatt script. " +
      "It reflects the AudioContext sample rate (typically 44100 or 48000). " +
      "Use it to compute phase increments, filter coefficients, and delay times.",
    script: `// @param frequency 440 20 2000 exp Hz

class Processor {
  frequency = 440
  phase = 0

  paramChanged(label, value) {
    if (label === "frequency") this.frequency = value
  }

  process({src, out}, {s0, s1}) {
    const [srcL, srcR] = src
    const [outL, outR] = out
    // Phase increment = frequency / sampleRate
    // One full cycle (0 to 1) = one period of the wave
    const phaseInc = this.frequency / sampleRate
    for (let i = s0; i < s1; i++) {
      const osc = 0.2 * Math.sin(this.phase * 2 * Math.PI)
      this.phase = (this.phase + phaseInc) % 1.0
      outL[i] = srcL[i] + osc
      outR[i] = srcR[i] + osc
    }
  }
}`,
  },
  {
    id: "safety",
    title: "Safety Constraints",
    description:
      "Werkstatt scripts run in an AudioWorklet thread. " +
      "No DOM access, no fetch/setTimeout/imports. " +
      "Never allocate memory inside process() \u2014 no new, no array/object literals, no closures, no string concatenation (causes GC pauses). " +
      "Output is validated every block: NaN or amplitude > 1000 (~60dB) silences the processor. " +
      "JavaScript only \u2014 no WASM.",
    script: null,
  },
];
