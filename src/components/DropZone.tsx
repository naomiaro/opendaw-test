import React, { useCallback, useRef, useState } from "react";

export interface DropZoneProps {
  /**
   * Single-file mode: called with the first dropped or browsed file.
   * `skippedCount` is how many additional files were in the same drop and
   * ignored (0 for a single file). Provide exactly one of onFile / onFiles.
   */
  onFile?: (file: File, skippedCount: number) => void;
  /**
   * Multi-file mode: called with every dropped or browsed file; the consumer
   * filters and caps. Also sets `multiple` on the browse input.
   */
  onFiles?: (files: File[]) => void;
  /** Called when a drop carried no file at all (a link, image, or text drag). */
  onInvalidDrop?: () => void;
  /** File-input accept filter. Defaults to the audio formats browsers decode. */
  accept?: string;
  ariaLabel: string;
  /** Ignores drops/clicks and shows a wait cursor while the consumer is busy. */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Console-themed drag-and-drop file target: dashed frame that brightens to
 * amber while a drag hovers it. Owns the hidden file input (click or
 * Enter/Space browses), the dragleave child-crossing guard, and multi-file
 * truncation. Clicks on buttons rendered inside the children are ignored, so
 * zones can host their own controls (see the convolver's Remove button).
 */
export const DropZone: React.FC<DropZoneProps> = ({
  onFile,
  onFiles,
  onInvalidDrop,
  accept = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aif,.aiff",
  ariaLabel,
  disabled = false,
  children,
}) => {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const takeFiles = useCallback((files: FileList) => {
    if (files.length === 0) {
      onInvalidDrop?.();
      return;
    }
    if (onFiles) {
      onFiles(Array.from(files));
    } else {
      onFile?.(files.item(0)!, files.length - 1);
    }
  }, [onFile, onFiles, onInvalidDrop]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setActive(false);
    if (disabled) return;
    takeFiles(event.dataTransfer.files);
  }, [disabled, takeFiles]);

  const onBrowse = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) takeFiles(files);
    event.target.value = "";
  }, [takeFiles]);

  return (
    <div
      className={
        "mc-dropzone"
        + (active ? " mc-dropzone--active" : "")
        + (disabled ? " mc-dropzone--disabled" : "")
      }
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onDragOver={event => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={event => {
        // Crossing into a child fires dragleave too — only clear when the
        // pointer actually left the zone.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setActive(false);
        }
      }}
      onDrop={onDrop}
      onClick={event => {
        // Buttons hosted inside the zone keep their own behavior
        if (!disabled && (event.target as HTMLElement).closest("button") === null) {
          inputRef.current?.click();
        }
      }}
      onKeyDown={event => {
        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault();
          if (!disabled) inputRef.current?.click();
        }
      }}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={onFiles !== undefined}
        style={{ display: "none" }}
        onChange={onBrowse}
      />
    </div>
  );
};
