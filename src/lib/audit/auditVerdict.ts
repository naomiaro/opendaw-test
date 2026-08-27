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
 * Judge a cell's audio alignment using nearest-neighbor pairing.
 *
 * Algorithm:
 * 1. Subtract calibrationSec from each detected onset if provided.
 * 2. Pair each expected onset with the closest detected onset within PAIRING_THRESHOLD_SEC.
 * 3. Each detected onset pairs with at most one expected.
 * 4. Count matched, missing (unpaired expected), and extra (unpaired detected).
 * 5. Calculate max and mean deviations for matched pairs.
 * 6. Status logic:
 *    - If seamStep is defined: status = "investigate" iff seamStep > toleranceSec
 *    - Otherwise: status = "pass" if no missing/extra and maxDeviation <= tolerance
 *    - Otherwise: status = "investigate"
 */
export function judgeCell(m: CellMeasurement, toleranceSec: number): CellVerdict {
  // Step 1: Apply calibration bias subtraction
  const calibration = m.calibrationSec ?? 0;
  const adjustedOnsets = m.onsets.map((o) => o - calibration);

  // Step 2-3: Nearest-neighbor pairing
  const usedDetected = new Set<number>();
  const deviations: number[] = [];
  let matched = 0;

  for (const expectedTime of m.expected) {
    let closestDetectedIdx = -1;
    let closestDistance = PAIRING_THRESHOLD_SEC;

    // Find the closest unused detected onset
    for (let i = 0; i < adjustedOnsets.length; i++) {
      if (usedDetected.has(i)) continue;
      const distance = Math.abs(adjustedOnsets[i] - expectedTime);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDetectedIdx = i;
      }
    }

    // If found a match within threshold, record it
    if (closestDetectedIdx !== -1) {
      usedDetected.add(closestDetectedIdx);
      matched++;
      deviations.push(closestDistance);
    }
  }

  // Step 4: Count unpaired
  const missing = m.expected.length - matched;
  const extra = adjustedOnsets.length - matched;

  // Step 5: Calculate statistics
  const maxDeviationSec =
    deviations.length > 0 ? Math.max(...deviations) : 0;
  const meanDeviationSec =
    deviations.length > 0
      ? deviations.reduce((a, b) => a + b, 0) / deviations.length
      : 0;

  // Step 6: Determine status
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
