// @vitest-environment jsdom
import "@/lib/testing/domSetup";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Theme } from "@radix-ui/themes";
import { SpielwerkEditor } from "./SpielwerkEditor";

function show(overrides: Partial<React.ComponentProps<typeof SpielwerkEditor>> = {}) {
  const props = {
    source: "class Processor {}",
    onChange: vi.fn(),
    onCompile: vi.fn(() => Promise.resolve()),
    busy: false,
    restorable: null,
    onRestore: vi.fn(),
    ...overrides,
  };
  const view = render(<Theme><SpielwerkEditor {...props} /></Theme>);
  return { ...view, props };
}

describe("SpielwerkEditor", () => {
  it("the Compile button compiles the current text", async () => {
    const user = userEvent.setup();
    const { props } = show({ source: "// a\nclass Processor {}" });
    await user.click(screen.getByRole("button", { name: "Compile" }));
    expect(props.onCompile).toHaveBeenCalledWith("// a\nclass Processor {}");
  });

  it("Cmd/Ctrl+Enter inside the editor compiles", async () => {
    const user = userEvent.setup();
    const { props } = show();
    screen.getByRole("textbox").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(props.onCompile).toHaveBeenCalledTimes(1);
  });

  it("Cmd/Ctrl+Enter on the page body does not compile", async () => {
    const user = userEvent.setup();
    const { props } = show();
    document.body.focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(props.onCompile).not.toHaveBeenCalled();
  });

  it("typing reports the new text and never compiles by itself", async () => {
    const user = userEvent.setup();
    const { props } = show({ source: "" });
    await user.type(screen.getByRole("textbox"), "x");
    expect(props.onChange).toHaveBeenCalledWith("x");
    expect(props.onCompile).not.toHaveBeenCalled();
  });

  it("a rejected compile shows its message", async () => {
    const user = userEvent.setup();
    show({ onCompile: vi.fn(() => Promise.reject(new Error("Malformed @param: 'x'"))) });
    await user.click(screen.getByRole("button", { name: "Compile" }));
    expect(await screen.findByText("Malformed @param: 'x'")).toBeDefined();
  });

  it("Tab inserts four spaces and Shift+Tab is left to the browser", async () => {
    const user = userEvent.setup();
    const { props } = show({ source: "" });
    const editor = screen.getByRole("textbox");
    editor.focus();
    await user.keyboard("{Tab}");
    expect(props.onChange).toHaveBeenCalledWith("    ");
    // fireEvent.keyDown returns false when a handler called preventDefault
    expect(fireEvent.keyDown(editor, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("Escape leaves the editor", async () => {
    const user = userEvent.setup();
    show();
    const editor = screen.getByRole("textbox");
    editor.focus();
    await user.keyboard("{Escape}");
    expect(document.activeElement).not.toBe(editor);
  });

  it("Cmd/Ctrl+Enter while busy does not compile", async () => {
    const user = userEvent.setup();
    const { props } = show({ busy: true });
    screen.getByRole("textbox").focus();
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(props.onCompile).not.toHaveBeenCalled();
  });

  it("restore previous brings back the replaced text", async () => {
    const user = userEvent.setup();
    const { props, rerender } = show({ restorable: "the old text" });
    await user.click(screen.getByRole("button", { name: "Restore previous" }));
    expect(props.onRestore).toHaveBeenCalledTimes(1);
    rerender(<Theme><SpielwerkEditor {...props} restorable={null} /></Theme>);
    expect(screen.queryByRole("button", { name: "Restore previous" })).toBeNull();
  });
});
