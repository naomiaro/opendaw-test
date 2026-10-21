/** The frame-driver choice a demo page makes from its URL, SDK-free so it is tested in Node. */
export type FrameDriverKind = "window" | "hidden-safe" | "throttled";

/** The option wins; else `?frameDriver=`; else the SDK's own frame path. */
export function resolveFrameDriver(option: FrameDriverKind | undefined, search: string): FrameDriverKind {
  if (option !== undefined) return option;
  const param = new URLSearchParams(search).get("frameDriver");
  if (param === "window" || param === "hidden-safe" || param === "throttled") return param;
  if (param !== null) throw new Error(`invalid ?frameDriver= "${param}" — window, hidden-safe or throttled`);
  return "window";
}

/** `?frameEvery=N` for the throttled driver: every Nth real frame; 2 when absent. */
export function resolveFrameEvery(search: string): number {
  const param = new URLSearchParams(search).get("frameEvery");
  if (param === null) return 2;
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ?frameEvery= "${param}" — an integer of 1 or more`);
  return n;
}
