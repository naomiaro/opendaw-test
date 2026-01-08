import React from "react";
import { Flex, Text, Progress, Button, Separator } from "@radix-ui/themes";

export interface ExportProgressProps {
  /**
   * Whether an export is currently in progress
   */
  isExporting: boolean;

  /**
   * Current status message to display
   */
  status: string;

  /**
   * Export progress percentage (0-100)
   */
  progress: number;

  /**
   * Handler to cancel the export
   */
  onCancel: () => void;

  /**
   * Whether to show a separator above the component
   */
  showSeparator?: boolean;
}

/**
 * Reusable component for displaying audio export progress
 *
 * Shows status text, progress bar, and cancel button during export operations.
 * Automatically hides when not exporting and no status message is present.
 *
 * @example
 * ```tsx
 * <ExportProgress
 *   isExporting={isExporting}
 *   status={exportStatus}
 *   progress={exportProgress}
 *   onCancel={handleAbortExport}
 * />
 * ```
 */
export function ExportProgress({
  isExporting,
  status,
  progress,
  onCancel,
  showSeparator = true
}: ExportProgressProps) {
  // Don't render if nothing to show
  if (!status && !isExporting) {
    return null;
  }

  return (
    <>
      {showSeparator && <Separator size="4" />}
      <Flex direction="column" gap="2" align="center" style={{ width: "100%" }}>
        <Text size="2" weight="medium">
          {status}
        </Text>
        {isExporting && (
          <>
            <Progress value={progress} style={{ width: "100%" }} />
            <Flex gap="3" align="center">
              <Text size="1" color="gray">
                {progress}% complete
              </Text>
              <Button
                size="1"
                variant="soft"
                color="red"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </>
  );
}
