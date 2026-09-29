import React, { useEffect, useRef } from "react";
import { Flex, Slider, Text } from "@radix-ui/themes";
import type { Project } from "@opendaw/studio-core";
import { useParameterUnit, type UnitParameter } from "@/hooks/useParameterUnit";
import { stepIndexToUnit, unitToStepIndex } from "@/lib/parameterSteps";

export interface ParamSliderProps {
  project: Project;
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
 * Give a themed Slider's thumb its accessible name. The name belongs on the
 * thumb (the element with role="slider"); the themed Slider renders its thumb
 * internally and forwards no label to it. Pass the returned ref to the Slider.
 */
export function useSliderThumbLabel(label: string): React.RefObject<HTMLSpanElement | null> {
  const rootRef = useRef<HTMLSpanElement>(null);
  // No dependency list: the Slider may mount later than the component that
  // calls this hook (a conditionally rendered control), and one attribute
  // write per render costs nothing.
  useEffect(() => {
    rootRef.current?.querySelector('[role="slider"]')?.setAttribute("aria-label", label);
  });
  return rootRef;
}

/** Labelled slider bound to a parameter, with the readout printed by the parameter's own string mapping. */
export const ParamSlider: React.FC<ParamSliderProps> = ({
  project, parameter, label, step = 0.005, positions,
}) => {
  const [unit, print, write] = useParameterUnit(project, parameter);
  const rootRef = useSliderThumbLabel(label);
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
