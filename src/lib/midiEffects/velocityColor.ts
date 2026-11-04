/** Velocity as a colour: a dim, low-saturation tint at 0 up to the console accent at 1, on a squared curve. */
export const VELOCITY_RAMP: { soft: [number, number, number]; loud: [number, number, number] } = {
  soft: [96, 78, 54],
  loud: [232, 163, 61], // CANVAS_COLORS.amber #e8a33d
};

export function velocityColor(velocity: number): string {
  const t = Math.max(0, Math.min(1, velocity));
  const k = t * t;
  const [r, g, b] = VELOCITY_RAMP.soft.map((s, i) => Math.round(s + (VELOCITY_RAMP.loud[i] - s) * k));
  return `rgb(${r}, ${g}, ${b})`;
}
