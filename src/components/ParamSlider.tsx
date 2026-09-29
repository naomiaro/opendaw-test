import React, { useEffect, useRef } from "react";
import { Flex, Slider, Text } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { useParameterUnit, type UnitParameter } from "@/hooks/useParameterUnit";
import { stepIndexToUnit, unitToStepIndex } from "@/lib/parameterSteps";

export interface ParamSliderProps {
  project: Pick<Project, "editing">;
  parameter: UnitParameter;
  label: string;
  /** Unit-space step for a continuous parameter. Ignored when `positions` is set. */
  step?: number;
  /**
   * Number of values of an integer parameter (7 for an octave of -3..3). The
   * slider then runs over whole-number positions, which keyboard stepping needs.
   */
  positions?: number;
}

/**
 * Give a themed Slider's thumb its accessible name and, when given, the text
 * of its value. Both belong on the thumb (the element with role="slider"); the
 * themed Slider renders its thumb internally and forwards neither to it. Pass
 * the returned ref to the Slider.
 */
export function useSliderThumbLabel(label: string, valueText?: string): React.RefObject<HTMLSpanElement | null> {
  const rootRef = useRef<HTMLSpanElement>(null);
  // No dependency list: the Slider may mount later than the component that
  // calls this hook (a conditionally rendered control), and one attribute
  // write per render costs nothing.
  useEffect(() => {
    const thumb = rootRef.current?.querySelector('[role="slider"]');
    if (!thumb) return;
    thumb.setAttribute("aria-label", label);
    // The slider's own number is a position or a share of the range. This is
    // the value as a person reads it ("-2 oct"), which is what gets announced.
    if (valueText !== undefined) thumb.setAttribute("aria-valuetext", valueText);
  });
  return rootRef;
}

/** Labelled slider bound to a parameter, with the readout printed by the parameter's own string mapping. */
export const ParamSlider: React.FC<ParamSliderProps> = ({
  project, parameter, label, step = 0.005, positions,
}) => {
  const [unit, print, write] = useParameterUnit(project, parameter);
  const rootRef = useSliderThumbLabel(label, print);
  return (
    <Flex direction="column" gap="1" flexGrow="1" style={{ minWidth: 0 }}>
      <Flex justify="between" gap="2">
        <Text size="1" color="gray">{label}</Text>
        <Text size="1" color="gray" style={{ fontFamily: "var(--mc-mono)" }}>{print}</Text>
      </Flex>
      {positions === undefined ? (
        <Slider
          ref={rootRef}
          min={0} max={1} step={step}
          value={[unit]}
          onValueChange={([value]) => write(value)}
        />
      ) : (
        <Slider
          ref={rootRef}
          min={0} max={Math.max(1, positions - 1)} step={1}
          value={[unitToStepIndex(unit, positions)]}
          onValueChange={([index]) => write(stepIndexToUnit(index, positions))}
        />
      )}
    </Flex>
  );
};
