// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PianoKeyboard } from "./PianoKeyboard";

describe("PianoKeyboard", () => {
  it("labels each C with the SDK's name, so the key labelled C3 plays key 60", () => {
    const onNoteOn = vi.fn();
    render(<PianoKeyboard activeNotes={new Set()} onNoteOn={onNoteOn} onNoteOff={() => {}} />);

    fireEvent.mouseDown(screen.getByText("C3"));
    expect(onNoteOn).toHaveBeenLastCalledWith(60);

    fireEvent.mouseDown(screen.getByText("C2"));
    expect(onNoteOn).toHaveBeenLastCalledWith(48);

    fireEvent.mouseDown(screen.getByText("C4"));
    expect(onNoteOn).toHaveBeenLastCalledWith(72);
  });
});
