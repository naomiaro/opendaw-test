import { useState, useEffect, useRef, useCallback } from "react";
import { Project } from "@opendaw/studio-core";
import type { Terminable } from "@opendaw/lib-std";

interface MutableObservableValue<T> {
  getValue(): T;
  setValue(value: T): void;
  subscribe(callback: (obs: { getValue(): T }) => void): Terminable;
  terminate(): void;
}

/**
 * Available engine preference paths
 *
 * Metronome settings:
 * - ["metronome", "enabled"] - boolean
 * - ["metronome", "gain"] - number (0-1)
 * - ["metronome", "beatSubDivision"] - 1 | 2 | 4 | 8
 *
 * Recording settings:
 * - ["recording", "countInBars"] - 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
 *
 * Playback settings:
 * - ["playback", "timestampEnabled"] - boolean
 * - ["playback", "pauseOnLoopDisabled"] - boolean
 * - ["playback", "truncateNotesAtRegionEnd"] - boolean
 */

type MetronomeEnabledPath = ["metronome", "enabled"];
type MetronomeGainPath = ["metronome", "gain"];
type MetronomeBeatSubDivisionPath = ["metronome", "beatSubDivision"];
type RecordingCountInBarsPath = ["recording", "countInBars"];
type PlaybackTimestampEnabledPath = ["playback", "timestampEnabled"];
type PlaybackPauseOnLoopDisabledPath = ["playback", "pauseOnLoopDisabled"];
type PlaybackTruncateNotesPath = ["playback", "truncateNotesAtRegionEnd"];

// Export value types for use in components
export type MetronomeBeatSubDivisionValue = 1 | 2 | 4 | 8;
export type CountInBarsValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type PreferencePath =
  | MetronomeEnabledPath
  | MetronomeGainPath
  | MetronomeBeatSubDivisionPath
  | RecordingCountInBarsPath
  | PlaybackTimestampEnabledPath
  | PlaybackPauseOnLoopDisabledPath
  | PlaybackTruncateNotesPath;

type PreferenceValue<P extends PreferencePath> =
  P extends MetronomeEnabledPath ? boolean :
  P extends MetronomeGainPath ? number :
  P extends MetronomeBeatSubDivisionPath ? 1 | 2 | 4 | 8 :
  P extends RecordingCountInBarsPath ? 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 :
  P extends PlaybackTimestampEnabledPath ? boolean :
  P extends PlaybackPauseOnLoopDisabledPath ? boolean :
  P extends PlaybackTruncateNotesPath ? boolean :
  never;

/**
 * Hook for accessing and modifying engine preferences
 *
 * Provides a React-friendly interface to OpenDAW's engine preferences API.
 * Automatically creates mutable observable values and cleans them up on unmount.
 *
 * @param project - The OpenDAW project instance (can be null during initialization)
 * @param path - The preference path as a tuple, e.g., ["metronome", "enabled"]
 * @returns A tuple of [currentValue, setValue] similar to useState
 *
 * @example
 * ```typescript
 * // Metronome enabled
 * const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(
 *   project,
 *   ["metronome", "enabled"]
 * );
 *
 * // Count-in bars
 * const [countInBars, setCountInBars] = useEnginePreference(
 *   project,
 *   ["recording", "countInBars"]
 * );
 *
 * // Metronome gain
 * const [metronomeGain, setMetronomeGain] = useEnginePreference(
 *   project,
 *   ["metronome", "gain"]
 * );
 * ```
 */
export function useEnginePreference<P extends PreferencePath>(
  project: Project | null,
  path: P
): [PreferenceValue<P> | undefined, (value: PreferenceValue<P>) => void] {
  const [value, setValue] = useState<PreferenceValue<P> | undefined>(undefined);
  const observableRef = useRef<MutableObservableValue<PreferenceValue<P>> | null>(null);

  useEffect(() => {
    if (!project) return;

    // Create mutable observable value for this preference path
    // The path is spread as arguments: ["metronome", "enabled"] -> ("metronome", "enabled")
    // The SDK method has overloads for specific path pairs, but our generic P
    // has already been validated at the call site. Cast the result to our typed interface.
    // Must call directly on preferences object to preserve `this` binding (uses private fields).
    const observable = (project.engine.preferences as unknown as {
      createMutableObservableValue(section: string, key: string): MutableObservableValue<PreferenceValue<P>>;
    }).createMutableObservableValue(path[0], path[1]);

    observableRef.current = observable;

    // Initialize state from current value
    setValue(observable.getValue());

    // Subscribe to changes - callback receives the observable, need to call getValue()
    const subscription = observable.subscribe((obs) => {
      setValue(obs.getValue());
    });

    return () => {
      subscription.terminate();
      observable.terminate();
      observableRef.current = null;
    };
  }, [project, path[0], path[1]]);

  const setPreference = useCallback((newValue: PreferenceValue<P>) => {
    if (observableRef.current) {
      observableRef.current.setValue(newValue);
    }
  }, []);

  return [value, setPreference];
}

/**
 * Hook for accessing multiple engine preferences at once
 *
 * Useful when you need several preferences in a component.
 *
 * @example
 * ```typescript
 * const {
 *   metronomeEnabled,
 *   setMetronomeEnabled,
 *   countInBars,
 *   setCountInBars
 * } = useMetronomePreferences(project);
 * ```
 */
export function useMetronomePreferences(project: Project | null) {
  const [metronomeEnabled, setMetronomeEnabled] = useEnginePreference(
    project,
    ["metronome", "enabled"]
  );
  const [metronomeGain, setMetronomeGain] = useEnginePreference(
    project,
    ["metronome", "gain"]
  );
  const [beatSubDivision, setBeatSubDivision] = useEnginePreference(
    project,
    ["metronome", "beatSubDivision"]
  );
  const [countInBars, setCountInBars] = useEnginePreference(
    project,
    ["recording", "countInBars"]
  );

  return {
    metronomeEnabled,
    setMetronomeEnabled,
    metronomeGain,
    setMetronomeGain,
    beatSubDivision,
    setBeatSubDivision,
    countInBars,
    setCountInBars
  };
}

/**
 * Hook for accessing playback preferences
 *
 * @example
 * ```typescript
 * const {
 *   pauseOnLoopDisabled,
 *   setPauseOnLoopDisabled
 * } = usePlaybackPreferences(project);
 * ```
 */
export function usePlaybackPreferences(project: Project | null) {
  const [timestampEnabled, setTimestampEnabled] = useEnginePreference(
    project,
    ["playback", "timestampEnabled"]
  );
  const [pauseOnLoopDisabled, setPauseOnLoopDisabled] = useEnginePreference(
    project,
    ["playback", "pauseOnLoopDisabled"]
  );
  const [truncateNotesAtRegionEnd, setTruncateNotesAtRegionEnd] = useEnginePreference(
    project,
    ["playback", "truncateNotesAtRegionEnd"]
  );

  return {
    timestampEnabled,
    setTimestampEnabled,
    pauseOnLoopDisabled,
    setPauseOnLoopDisabled,
    truncateNotesAtRegionEnd,
    setTruncateNotesAtRegionEnd
  };
}
