import type { AuditFamily } from "./auditExpectations";

export interface CellMeasurement {
  family: AuditFamily;
  bpm: number;
  rate: number;
  onsets: number[]; // detected
  expected: number[];
  seamStep?: number; // seam family only
  calibrationSec?: number; // detector bias measured on the control row (subtracted)
}

export interface CellVerdict {
  family: AuditFamily;
  bpm: number;
  rate: number;
  matched: number;
  missing: number;
  extra: number;
  maxDeviationSec: number;
  meanDeviationSec: number;
  status: "pass" | "investigate";
}

const PAIRING_THRESHOLD_SEC = 0.05; // 50 ms

/**
 * Kuhn's algorithm (augmenting paths): find a maximum bipartite matching
 * restricted to the given adjacency list. `adjacency[e]` is the sorted list
 * of detected indices expected[e] may pair with, already filtered to a
 * distance threshold by the caller. Deterministic: expected indices are
 * tried in ascending order, and each expected's candidate list is iterated
 * in the order the caller provides (sorted by (dist, detectedIdx) — see
 * `findOptimalMatching`), so ties resolve the same way on every call.
 *
 * O(V * E) — V = expected.length, E = total adjacency entries.
 */
function maxBipartiteMatching(
  expectedCount: number,
  adjacency: number[][]
): Map<number, number> {
  const matchOfDetected = new Map<number, number>(); // detectedIdx -> expectedIdx

  function tryAugment(eIdx: number, visited: Set<number>): boolean {
    for (const dIdx of adjacency[eIdx]) {
      if (visited.has(dIdx)) continue;
      visited.add(dIdx);
      const currentOwner = matchOfDetected.get(dIdx);
      if (currentOwner === undefined || tryAugment(currentOwner, visited)) {
        matchOfDetected.set(dIdx, eIdx);
        return true;
      }
    }
    return false;
  }

  for (let e = 0; e < expectedCount; e++) {
    tryAugment(e, new Set());
  }

  const matching = new Map<number, number>(); // expectedIdx -> detectedIdx
  for (const [dIdx, eIdx] of matchOfDetected) {
    matching.set(eIdx, dIdx);
  }
  return matching;
}

/**
 * Find the one-to-one matching that (1) maximizes the number of matched
 * pairs, then (2) minimizes the maximum deviation among matched pairs —
 * in polynomial time.
 *
 * Algorithm:
 * 1. Collect all candidate (expectedIdx, detectedIdx, dist) pairs with
 *    dist <= tolerance.
 * 2. Compute the size of the maximum matching (M_max) over ALL candidates
 *    via Kuhn's augmenting-path algorithm.
 * 3. Binary-search the smallest threshold t (among the sorted unique
 *    candidate distances) such that the maximum matching restricted to
 *    pairs with dist <= t still has size M_max. Any smaller threshold
 *    must drop below M_max matches, so this t is exactly the minimum
 *    achievable maximum deviation for a max-size matching.
 * 4. Return the maximum matching computed at that threshold.
 *
 * Order-independent: candidate pairs and per-expected adjacency lists are
 * sorted by (dist, detectedIdx) before matching, so the result depends
 * only on the onset values, never on input array order. Note: when
 * multiple max-size, min-max-deviation matchings exist, this deterministic
 * tie-break order can affect which one is chosen (and therefore
 * meanDeviationSec) — max matched count and minimized max deviation are
 * guaranteed, mean deviation among equally-optimal matchings is not.
 */
function findOptimalMatching(
  expected: number[],
  detected: number[],
  tolerance: number
): Map<number, number> {
  type Candidate = { e: number; d: number; dist: number };
  const candidates: Candidate[] = [];
  for (let e = 0; e < expected.length; e++) {
    for (let d = 0; d < detected.length; d++) {
      const dist = Math.abs(detected[d] - expected[e]);
      if (dist <= tolerance) candidates.push({ e, d, dist });
    }
  }
  if (candidates.length === 0) return new Map();

  candidates.sort((a, b) => a.dist - b.dist || a.d - b.d);

  const buildAdjacency = (cands: Candidate[]): number[][] => {
    const adjacency: number[][] = Array.from({ length: expected.length }, () => []);
    for (const c of cands) adjacency[c.e].push(c.d);
    return adjacency;
  };

  // Step 2: maximum matching size over all candidates.
  const fullMatching = maxBipartiteMatching(expected.length, buildAdjacency(candidates));
  const maxMatchCount = fullMatching.size;
  if (maxMatchCount === 0) return new Map();

  // Step 3: binary search the smallest distance threshold that still
  // achieves maxMatchCount, over the sorted unique candidate distances.
  const uniqueDists = Array.from(new Set(candidates.map((c) => c.dist))).sort((a, b) => a - b);

  const matchCountAtThreshold = (t: number): Map<number, number> => {
    const restricted = candidates.filter((c) => c.dist <= t);
    return maxBipartiteMatching(expected.length, buildAdjacency(restricted));
  };

  let lo = 0;
  let hi = uniqueDists.length - 1;
  let best = fullMatching; // threshold = uniqueDists[uniqueDists.length - 1] (all candidates)
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = uniqueDists[mid];
    const matching = matchCountAtThreshold(t);
    if (matching.size >= maxMatchCount) {
      best = matching;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return best;
}

/**
 * Judge a cell's audio alignment using optimal min-max pairing.
 *
 * Algorithm:
 * 1. Subtract calibrationSec from each detected onset if provided.
 * 2. Find optimal one-to-one matching that minimizes maximum deviation (≤ PAIRING_THRESHOLD_SEC).
 * 3. Count matched, missing (unpaired expected), and extra (unpaired detected).
 * 4. Calculate max and mean deviations for matched pairs.
 * 5. Status logic:
 *    - If seamStep is defined: status = "investigate" iff seamStep > toleranceSec
 *    - Otherwise: status = "pass" if no missing/extra and maxDeviation <= tolerance
 *    - Otherwise: status = "investigate"
 *
 * Order-independent: the pairing result depends only on the onsets and expected values,
 * not the order they appear in the input arrays.
 */
export function judgeCell(m: CellMeasurement, toleranceSec: number): CellVerdict {
  // Step 1: Apply calibration bias subtraction
  const calibration = m.calibrationSec ?? 0;
  const adjustedOnsets = m.onsets.map((o) => o - calibration);

  // Step 2: Optimal matching that minimizes maximum deviation
  const matching = findOptimalMatching(
    m.expected,
    adjustedOnsets,
    PAIRING_THRESHOLD_SEC
  );

  // Step 3: Count matches
  const matched = matching.size;
  const missing = m.expected.length - matched;
  const extra = adjustedOnsets.length - matched;

  // Step 4: Calculate deviations
  const deviations: number[] = [];
  for (const [eIdx, dIdx] of matching) {
    const deviation = Math.abs(adjustedOnsets[dIdx] - m.expected[eIdx]);
    deviations.push(deviation);
  }

  const maxDeviationSec = deviations.length > 0 ? Math.max(...deviations) : 0;
  const meanDeviationSec =
    deviations.length > 0
      ? deviations.reduce((a, b) => a + b, 0) / deviations.length
      : 0;

  // Step 5: Determine status
  let status: "pass" | "investigate";

  if (m.seamStep !== undefined) {
    // Seam special case: status is "investigate" iff seamStep > toleranceSec
    status = m.seamStep > toleranceSec ? "investigate" : "pass";
  } else {
    // Normal case: "pass" if no missing/extra and max deviation <= tolerance
    status =
      missing === 0 && extra === 0 && maxDeviationSec <= toleranceSec
        ? "pass"
        : "investigate";
  }

  return {
    family: m.family,
    bpm: m.bpm,
    rate: m.rate,
    matched,
    missing,
    extra,
    maxDeviationSec,
    meanDeviationSec,
    status,
  };
}

/**
 * Cross-rate discriminator: assess whether a family+bpm exhibits rate-dependent behavior.
 *
 * "consistent" when all rates have similar max deviations (within spreadToleranceSec).
 * "rate-dependent" when the per-rate max deviations vary by more than spreadToleranceSec
 * (indicating a rate-dependent bug).
 */
export function assessRateConsistency(
  cells: CellVerdict[],
  spreadToleranceSec: number
): "consistent" | "rate-dependent" {
  if (cells.length === 0) return "consistent";

  const maxDeviations = cells.map((c) => c.maxDeviationSec);
  const minDeviation = Math.min(...maxDeviations);
  const maxDeviation = Math.max(...maxDeviations);
  const spread = maxDeviation - minDeviation;

  return spread > spreadToleranceSec ? "rate-dependent" : "consistent";
}
