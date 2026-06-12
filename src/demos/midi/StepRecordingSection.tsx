import React, { useEffect, useState, useCallback } from "react";
import { UUID } from "@opendaw/lib-std";
import { Project } from "@opendaw/studio-core";
import type { NoteEventCollectionBoxAdapter } from "@opendaw/studio-adapters";
import { PPQN } from "@opendaw/lib-dsp";
import { AnimationFrame } from "@opendaw/lib-dom";
import { NoteEventCollectionBox, NoteRegionBox } from "@opendaw/studio-boxes";
import { PianoKeyboard } from "./PianoKeyboard";
import {
  Text,
  Flex,
  Card,
  Checkbox,
  Select,
  Callout,
  Badge,
  Slider,
} from "@radix-ui/themes";

export type RecordedNote = {
  pitch: number;
  velocity: number;
  position: number; // PPQN
  duration: number; // PPQN
};

type StepRecordingTarget = {
  collection: NoteEventCollectionBoxAdapter;
  regionOffset: number; // region position in PPQN
};

/**
 * Find the "Step Recording" note region via the adapter layer.
 * Cast-free: isNoteRegion() narrows the adapter, optCollection yields the
 * typed NoteEventCollectionBoxAdapter.
 */
const findStepRecordingTarget = (project: Project): StepRecordingTarget | null => {
  for (const unit of project.rootBoxAdapter.audioUnits.adapters()) {
    for (const track of unit.tracks.values()) {
      for (const region of track.regions.adapters.values()) {
        if (region.label !== "Step Recording" || !region.isNoteRegion()) continue;
        const collectionOption = region.optCollection;
        if (collectionOption.isEmpty()) continue;
        return { collection: collectionOption.unwrap(), regionOffset: region.position };
      }
    }
  }
  return null;
};

/**
 * Step Recording Section
 */
export const StepRecordingSection: React.FC<{
  project: Project;
  onNotesCreated: (notes: RecordedNote[]) => void;
}> = ({ project, onNotesCreated }) => {
  const [stepEnabled, setStepEnabled] = useState(false);
  const [stepDuration, setStepDuration] = useState<string>("quarter");
  const [stepVelocity, setStepVelocity] = useState(100);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [createdNotes, setCreatedNotes] = useState<RecordedNote[]>([]);
  // Region/target resolution failures — cleared on the next successful note
  const [stepError, setStepError] = useState<string | null>(null);

  const durationMap: Record<string, number> = {
    "whole": PPQN.Quarter * 4,
    "half": PPQN.Quarter * 2,
    "quarter": PPQN.Quarter,
    "eighth": PPQN.Quarter / 2,
    "sixteenth": PPQN.Quarter / 4,
  };

  // Track position via animation frame
  useEffect(() => {
    const sub = AnimationFrame.add(() => {
      setCurrentPosition(project.engine.position.getValue());
    });
    return () => sub.terminate();
  }, [project]);

  const handleStepNote = useCallback((note: number) => {
    if (!stepEnabled) return;

    const duration = durationMap[stepDuration] ?? PPQN.Quarter;
    const position = currentPosition;
    const velocity = stepVelocity / 127;

    // Find the "Step Recording" note region via the adapter layer
    let target = findStepRecordingTarget(project);

    // Create a step recording region if none exists
    if (!target) {
      const firstUnit = project.rootBoxAdapter.audioUnits.adapters()[0];
      if (!firstUnit) {
        setStepError("No audio unit available to host the step recording region.");
        return;
      }
      const firstTrack = firstUnit.tracks.values()[0];
      if (!firstTrack) {
        setStepError("The instrument has no track to hold the step recording region.");
        return;
      }
      const trackBox = firstTrack.box;

      project.editing.modify(() => {
        const collection = NoteEventCollectionBox.create(project.boxGraph, UUID.generate());
        NoteRegionBox.create(project.boxGraph, UUID.generate(), (box: NoteRegionBox) => {
          box.regions.refer(trackBox.regions);
          box.events.refer(collection.owners);
          box.position.setValue(0);
          box.label.setValue("Step Recording");
        });
      });

      // Re-find after the transaction commits (adapters exist post-commit)
      target = findStepRecordingTarget(project);
    }

    if (!target) {
      setStepError("Could not create or find the step recording region.");
      return;
    }
    setStepError(null);
    const { collection, regionOffset } = target;

    project.editing.modify(() => {
      collection.createEvent({
        position: Math.round(Math.max(0, position - regionOffset)),
        duration,
        pitch: note,
        cent: 0,
        velocity,
        chance: 100,
        playCount: 1,
      });
    });

    // Advance position
    const newPos = position + duration;
    project.engine.setPosition(newPos);

    const recorded: RecordedNote = { pitch: note, velocity, position, duration };
    setCreatedNotes(prev => [...prev, recorded]);
    onNotesCreated([recorded]);
  }, [project, stepEnabled, stepDuration, stepVelocity, currentPosition, onNotesCreated]);

  return (
    <Card>
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center">
          <Text size="2" weight="bold" color="gray">Step Recording</Text>
          <Badge color={stepEnabled ? "green" : "gray"} size="2">
            {stepEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </Flex>

        <Callout.Root color="amber">
          <Callout.Text>
            Step recording lets you enter notes one at a time at the current playhead position.
            Each note automatically advances the playhead by the selected duration.
            The engine must be <strong>stopped</strong> (not playing) for step recording.
          </Callout.Text>
        </Callout.Root>

        <Flex gap="4" wrap="wrap" align="center">
          <Flex asChild align="center" gap="2">
            <Text as="label" size="2">
              <Checkbox
                checked={stepEnabled}
                onCheckedChange={checked => setStepEnabled(checked === true)}
              />
              Enable step recording
            </Text>
          </Flex>

          <Flex align="center" gap="2">
            <Text size="2" weight="medium">Duration:</Text>
            <Select.Root value={stepDuration} onValueChange={setStepDuration}>
              <Select.Trigger style={{ width: 130 }} />
              <Select.Content>
                <Select.Item value="whole">Whole</Select.Item>
                <Select.Item value="half">Half</Select.Item>
                <Select.Item value="quarter">Quarter</Select.Item>
                <Select.Item value="eighth">Eighth</Select.Item>
                <Select.Item value="sixteenth">16th</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex align="center" gap="2">
            <Text size="2" weight="medium">Velocity:</Text>
            <Slider
              value={[stepVelocity]}
              onValueChange={values => setStepVelocity(values[0])}
              min={1}
              max={127}
              step={1}
              style={{ width: 100 }}
            />
            <Text
              size="1"
              color="gray"
              style={{ fontFamily: "var(--mc-mono)", fontVariantNumeric: "tabular-nums", minWidth: 30 }}
            >
              {stepVelocity}
            </Text>
          </Flex>
        </Flex>

        {stepError && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{stepError}</Callout.Text>
          </Callout.Root>
        )}

        {stepEnabled && (
          <>
            <Text
              size="2"
              color="gray"
              style={{ fontFamily: "var(--mc-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              Position: {PPQN.pulsesToSeconds(currentPosition, project.timelineBox.bpm.getValue()).toFixed(2)}s
              ({currentPosition} PPQN)
            </Text>
            <Flex justify="center" style={{ overflow: "auto", padding: "8px 0" }}>
              <PianoKeyboard
                activeNotes={new Set()}
                onNoteOn={handleStepNote}
                onNoteOff={() => {}}
              />
            </Flex>
            {createdNotes.length > 0 && (
              <Text size="1" color="gray">
                {createdNotes.length} step note{createdNotes.length !== 1 ? "s" : ""} created
              </Text>
            )}
          </>
        )}
      </Flex>
    </Card>
  );
};
