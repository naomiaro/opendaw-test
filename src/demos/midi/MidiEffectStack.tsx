/**
 * The stack: one chip per device on the chain, sortable by drag (pointer and keyboard through
 * dnd-kit's sensors), an add menu for the devices not yet stacked, and a clear button. A click on a
 * chip's body expands its card beneath the row. The order drawn is the box graph's (`entries`),
 * never the drag's: `onDragEnd` asks the page to move the device and the row follows the chain.
 */
import React, { useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, DropdownMenu, Flex, Text } from "@radix-ui/themes";
import { UUID } from "@opendaw/lib-std";
import { DEVICES, DEVICE_IDS, type DeviceId } from "@/lib/midiEffects/devices";
import type { ChainEntry } from "./useMidiChain";

export interface MidiEffectStackProps {
  entries: readonly ChainEntry[];
  onMove(from: number, to: number): void;
  onRemove(id: DeviceId): void;
  onAdd(id: DeviceId): void;
  onClear(): void;
  renderCard(entry: ChainEntry): React.ReactNode;
}

const chipKey = (entry: ChainEntry): string => UUID.toString(entry.box.address.uuid);

const Chip: React.FC<{ entry: ChainEntry; expanded: boolean; onToggle(): void; onRemove(): void }> = ({ entry, expanded, onToggle, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: chipKey(entry) });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "flex", alignItems: "stretch", gap: 0,
        border: `1px solid ${expanded ? "var(--mc-amber)" : "var(--mc-line-bright)"}`,
        background: "var(--mc-panel)", borderRadius: 4,
        opacity: entry.enabled ? (isDragging ? 0.6 : 1) : 0.45,
        minWidth: 120,
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${DEVICES[entry.id].label}`}
        style={{ cursor: "grab", border: "none", borderRight: "1px solid var(--mc-line)", background: "transparent", color: "var(--mc-label)", padding: "6px 8px", touchAction: "none" }}
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{ flex: 1, border: "none", background: "transparent", color: "var(--mc-text)", textAlign: "left", padding: "6px 10px", cursor: "pointer", font: "inherit" }}
      >
        <Text size="2" weight="bold">{DEVICES[entry.id].label}</Text>
        {!entry.enabled && <Text size="1" color="gray" style={{ display: "block" }}>disabled</Text>}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${DEVICES[entry.id].label}`}
        style={{ border: "none", borderLeft: "1px solid var(--mc-line)", background: "transparent", color: "var(--mc-label)", padding: "6px 8px", cursor: "pointer" }}
      >
        ×
      </button>
    </div>
  );
};

export const MidiEffectStack: React.FC<MidiEffectStackProps> = ({ entries, onMove, onRemove, onAdd, onClear, renderCard }) => {
  const [expandedId, setExpandedId] = useState<DeviceId | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const keys = entries.map(chipKey);
  const missing = DEVICE_IDS.filter((id) => !entries.some((e) => e.id === id));
  const expanded = entries.find((e) => e.id === expandedId) ?? null;

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  };

  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" align="center" wrap="wrap">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={keys} strategy={horizontalListSortingStrategy}>
            {entries.map((entry) => (
              <Chip
                key={chipKey(entry)}
                entry={entry}
                expanded={entry.id === expandedId}
                onToggle={() => setExpandedId(entry.id === expandedId ? null : entry.id)}
                onRemove={() => {
                  if (expandedId === entry.id) setExpandedId(null);
                  onRemove(entry.id);
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
        {missing.length > 0 && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="soft" size="2">+ add</Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {missing.map((id) => (
                <DropdownMenu.Item key={id} onSelect={() => onAdd(id)}>{DEVICES[id].label}</DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
        {entries.length > 0 && (
          <Button variant="ghost" size="2" color="gray" onClick={onClear}>Clear stack</Button>
        )}
      </Flex>
      {entries.length > 1 && (
        <Text size="1" color="gray">
          Signal flows left to right. Drag a handle to reorder, or focus one and use Space, the arrow keys, then Space.
        </Text>
      )}
      {expanded && renderCard(expanded)}
    </Flex>
  );
};
