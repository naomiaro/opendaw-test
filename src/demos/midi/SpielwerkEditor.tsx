/**
 * The Spielwerk script editor: a code textarea, a Compile button, Cmd/Ctrl+Enter inside the
 * textarea, the compiler's error under it, and a "Restore previous" link when a loaded script
 * replaced unsaved text. It never compiles on its own: a recompile cuts the instrument's sounding
 * voices, so compiling is the visitor's act.
 */
import React, { useCallback, useState } from "react";
import { Button, Callout, Flex, Text } from "@radix-ui/themes";

export interface SpielwerkEditorProps {
  source: string;
  onChange(source: string): void;
  /** Rejects with the compiler's error. */
  onCompile(source: string): Promise<void>;
  busy: boolean;
  /** The text a load replaced; null when there is nothing to restore. */
  restorable: string | null;
  onRestore(): void;
}

const EDITOR_STYLE: React.CSSProperties = {
  width: "100%",
  minHeight: 320,
  resize: "vertical",
  boxSizing: "border-box",
  padding: "12px 14px",
  background: "var(--mc-panel)",
  color: "var(--mc-text)",
  border: "1px solid var(--mc-line-bright)",
  borderRadius: 4,
  fontFamily: "var(--mc-mono)",
  fontSize: 12.5,
  lineHeight: 1.55,
  tabSize: 4,
  whiteSpace: "pre",
  overflowWrap: "normal",
  overflowX: "auto",
};

export const SpielwerkEditor: React.FC<SpielwerkEditorProps> = ({ source, onChange, onCompile, busy, restorable, onRestore }) => {
  const [error, setError] = useState<string | null>(null);

  const compile = useCallback(() => {
    setError(null);
    onCompile(source).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [onCompile, source]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      compile();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd } = target;
      const next = `${source.slice(0, selectionStart)}  ${source.slice(selectionEnd)}`;
      onChange(next);
      requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
    }
  };

  return (
    <Flex direction="column" gap="2">
      <textarea
        aria-label="Spielwerk script"
        value={source}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={EDITOR_STYLE}
      />
      <Flex gap="3" align="center" wrap="wrap">
        <Button size="2" onClick={compile} disabled={busy}>Compile</Button>
        <Text size="1" color="gray">or Cmd/Ctrl+Enter in the editor. Compiling restarts the pattern: the engine drops the sounding voices on a chain change.</Text>
        {restorable !== null && (
          <Button size="1" variant="ghost" color="gray" onClick={onRestore}>Restore previous</Button>
        )}
      </Flex>
      {error !== null && (
        <Callout.Root color="red" size="1">
          <Callout.Text style={{ fontFamily: "var(--mc-mono)", whiteSpace: "pre-wrap" }}>{error}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
};
