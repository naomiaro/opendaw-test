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
 * Find optimal one-to-one matching that minimizes maximum deviation.
 *
 * Uses recursive backtracking to explore all possible matchings.
 * For each expected onset, decides which detected onset to pair it with (or skip).
 * Prioritizes by: (1) maximize number of matched pairs, (2) minimize max deviation.
 *
 * Order-independent: result depends only on the onsets and expected values, not their order.
 */
function findOptimalMatching(
  expected: number[],
  detected: number[],
  tolerance: number
): Map<number, number> {
  // Build adjacency: for each expected, list valid detected indices
  const validDetected: number[][] = [];
  for (let e = 0; e < expected.length; e++) {
    validDetected[e] = [];
    for (let d = 0; d < detected.length; d++) {
      if (Math.abs(detected[d] - expected[e]) <= tolerance) {
        validDetected[e].push(d);
      }
    }
  }

  let bestMatching: Map<number, number> = new Map();
  let bestMatchCount = 0;
  let bestMaxDev = Infinity;

  function backtrack(
    eIdx: number,
    currentMatching: Map<number, number>,
    usedDetected: Set<number>,
    currentMaxDev: number
  ) {
    if (eIdx === expected.length) {
      // All expected processed
      const matchCount = currentMatching.size;

      // Prefer: more matches, or same matches but lower max deviation
      if (
        matchCount > bestMatchCount ||
        (matchCount === bestMatchCount && currentMaxDev < bestMaxDev)
      ) {
        bestMatchCount = matchCount;
        bestMaxDev = currentMaxDev;
        bestMatching = new Map(currentMatching);
      }
      return;
    }

    // Try matching expected[eIdx] with each valid detected
    for (const dIdx of validDetected[eIdx]) {
      if (!usedDetected.has(dIdx)) {
        const distance = Math.abs(detected[dIdx] - expected[eIdx]);
        const newMaxDev = Math.max(currentMaxDev, distance);

        currentMatching.set(eIdx, dIdx);
        usedDetected.add(dIdx);

        backtrack(eIdx + 1, currentMatching, usedDetected, newMaxDev);

        currentMatching.delete(eIdx);
        usedDetected.delete(dIdx);
      }
    }

    // Also try not matching this expected (skip it)
    backtrack(eIdx + 1, currentMatching, usedDetected, currentMaxDev);
  }

  backtrack(0, new Map(), new Set(), 0);

  return bestMatching;
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
