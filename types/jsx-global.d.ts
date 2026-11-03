// @dnd-kit's declarations (core 6.3, sortable 10.0) name the global `JSX` namespace that
// React 19's types no longer provide. Aliased to React's own here so those files check;
// a later dnd-kit that imports `React.JSX` itself makes this redundant, not wrong.
import type { JSX as ReactJSX } from "react";

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}
