/**
 * The Arpeggio's eighteen walks as pure arithmetic: which position of the expanded pool (held notes × octaves) a walk
 * step plays. The modes and their order are `ArpeggioDeviceBoxAdapter.Modes`; the behaviour is the manual's table
 * (`manual/.../arpeggio.md`, "1. Walk") and the crate's `walk_index` (`device-arpeggio/src/lib.rs:306-345`),
 * which the semantics audit checks against a render. The divisions floor and the remainders are Euclidean, as the
 * crate's `div_euclid` and `rem_euclid`; a walk step is not negative, but the hash also takes Random Once's key -1, as
 * two's complement. The random modes follow a 64-bit hash of (seed, step, salt) only: a step plays the same note
 * whatever played before it.
 */

const U64 = 64;
const mul = (a: bigint, b: bigint): bigint => BigInt.asUintN(U64, a * b);

/** The crate's `hash` (`device-arpeggio/src/lib.rs:220-230`): the high 32 bits of a 64-bit mix. */
export function walkHash(seed: number, step: number, salt: number): number {
  let value = mul(BigInt(seed), 0xd6e8feb86659fd93n)
    ^ mul(BigInt.asUintN(U64, BigInt(step)), 0x9e3779b97f4a7c15n)
    ^ mul(BigInt(salt), 0xc2b2ae3d27d4eb4fn);
  value ^= value >> 30n;
  value = mul(value, 0xbf58476d1ce4e5b9n);
  value ^= value >> 27n;
  value = mul(value, 0x94d049bb133111ebn);
  value ^= value >> 31n;
  return Number(value >> 32n);
}

const SALT_RANDOM = 1;
const SALT_OTHER = 2;
const SALT_WALK = 4;
const SALT_SHUFFLE = 100;

const remainder = (a: number, b: number): number => ((a % b) + b) % b;

/** Ping-pong, the turning notes once. */
function pingPong(step: number, count: number): number {
  if (count < 2) return 0;
  const cycle = count * 2 - 2;
  const at = remainder(step, cycle);
  return at < count ? at : cycle - at;
}

/** Ping-pong, the turning notes twice. */
function pingPongHeld(step: number, count: number): number {
  const at = remainder(step, count * 2);
  return at < count ? at : count * 2 - 1 - at;
}

/** Outside in: first, last, second, second to last. */
const inward = (at: number, count: number): number => (at % 2 === 0 ? at / 2 : count - 1 - (at - 1) / 2);

/** Position `at` of a seeded permutation of `count`, the shuffle keyed by `key`. */
function shuffled(seed: number, key: number, count: number, at: number): number {
  const order = Array.from({ length: count }, (_, slot) => slot);
  for (let slot = count - 1; slot >= 1; slot--) {
    const other = walkHash(seed, key, SALT_SHUFFLE + slot) % (slot + 1);
    [order[slot], order[other]] = [order[other], order[slot]];
  }
  return order[at % count];
}

/** Every block of eight steps plays four moves up, two stays and two moves down in a seeded order, so it climbs two per block. */
function drunkWalk(seed: number, step: number, count: number): number {
  const blockSize = 8;
  const block = Math.floor(step / blockSize);
  const moves = [1, 1, 1, 1, 0, 0, -1, -1];
  for (let slot = moves.length - 1; slot >= 1; slot--) {
    const other = walkHash(seed, block, SALT_WALK + slot) % (slot + 1);
    [moves[slot], moves[other]] = [moves[other], moves[slot]];
  }
  const within = moves.slice(0, remainder(step, blockSize)).reduce((sum, move) => sum + move, 0);
  return remainder(block * 2 + within, count);
}

/** Even steps are random; an odd step avoids both of its random neighbours. */
function randomOther(seed: number, step: number, count: number): number {
  const random = (at: number): number => walkHash(seed, at, SALT_OTHER);
  if (count === 2) return remainder(random(0) + step, 2);
  if (remainder(step, 2) === 0) return random(step) % count;
  const left = random(step - 1) % count;
  const right = random(step + 1) % count;
  const low = Math.min(left, right);
  const high = Math.max(left, right);
  const excluded = low === high ? 1 : 2;
  let value = random(step) % (count - excluded);
  if (value >= low) value += 1;
  if (excluded === 2 && value >= high) value += 1;
  return value;
}

/** The position in the expanded pool of `count` entries for `step`. */
export function walkIndex(mode: number, seed: number, step: number, count: number): number {
  if (count < 2) return 0;
  const at = remainder(step, count);
  const half = Math.floor(step / 2);
  switch (mode) {
    case 1: return count - 1 - at; // Down
    case 2: return pingPong(step, count); // UpDown
    case 3: return count - 1 - pingPong(step, count); // DownUp
    case 4: return pingPongHeld(step, count); // Up & Down
    case 5: return count - 1 - pingPongHeld(step, count); // Down & Up
    case 6: return inward(at, count); // Converge
    case 7: return inward(count - 1 - at, count); // Diverge
    case 8: { // Con & Diverge
      if (count < 3) return inward(at, count);
      const cycle = count * 2 - 2;
      const phase = remainder(step, cycle);
      return phase < count ? inward(phase, count) : inward(cycle - phase, count);
    }
    case 9: { // Pinky Up
      const phase = remainder(step, (count - 1) * 2);
      return phase % 2 === 0 ? phase / 2 : count - 1;
    }
    case 10: return remainder(step, 2) === 1 ? count - 1 : pingPong(half, count - 1); // Pinky UpDown
    case 11: { // Thumb Up
      const phase = remainder(step, (count - 1) * 2);
      return phase % 2 === 0 ? 0 : 1 + (phase - 1) / 2;
    }
    case 12: return remainder(step, 2) === 0 ? 0 : 1 + pingPong(half, count - 1); // Thumb UpDown
    case 13: return walkHash(seed, step, SALT_RANDOM) % count; // Random
    case 14: return randomOther(seed, step, count); // Random Other
    case 15: return shuffled(seed, Math.floor(step / count), count, at); // Shuffle
    case 16: return shuffled(seed, -1, count, at); // Random Once
    case 17: return drunkWalk(seed, step, count); // Walk
    default: return at; // Up
  }
}
