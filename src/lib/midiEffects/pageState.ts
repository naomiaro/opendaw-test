/**
 * The MIDI effects demo's chain state: one device at a time behind the tabs, or a stack of chips.
 * The page holds ONE chain mode at a time, so two devices never sound while the tabs claim one.
 * `desiredChain` is what `reconcileChain` is asked to make true.
 */
import type { DeviceId } from "./devices";

export type Tab = "dry" | DeviceId;

export interface PageState {
  mode: "single" | "stack";
  tab: Tab;
  stack: readonly DeviceId[];
}

export const INITIAL_STATE: PageState = { mode: "single", tab: "dry", stack: [] };

export type PageAction =
  | { type: "selectTab"; tab: Tab }
  | { type: "addToStack"; id: DeviceId }
  | { type: "removeFromStack"; id: DeviceId }
  | { type: "moveInStack"; from: number; to: number }
  | { type: "clearStack" };

function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

export function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "selectTab":
      return state.mode === "stack" ? state : { ...state, tab: action.tab };
    case "addToStack": {
      if (state.stack.includes(action.id)) return state;
      const carried = state.mode === "single" && state.tab !== "dry" ? [state.tab] : state.stack;
      if (carried.includes(action.id)) return state;
      return { mode: "stack", tab: state.tab, stack: [...carried, action.id] };
    }
    case "removeFromStack": {
      const stack = state.stack.filter((id) => id !== action.id);
      return stack.length === 0 ? INITIAL_STATE : { ...state, stack };
    }
    case "moveInStack":
      return { ...state, stack: arrayMove(state.stack, action.from, action.to) };
    case "clearStack":
      return INITIAL_STATE;
  }
}

/** The devices the chain should hold, in order. */
export function desiredChain(state: PageState): readonly DeviceId[] {
  if (state.mode === "stack") return state.stack;
  return state.tab === "dry" ? [] : [state.tab];
}
