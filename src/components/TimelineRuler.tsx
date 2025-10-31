import React from "react";
import { Text } from "@radix-ui/themes";

interface TimelineRulerProps {
  maxDuration: number;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ maxDuration }) => {
  const totalSeconds = Math.ceil(maxDuration);

  return (
    <div style={{
      display: "flex",
      flexDirection: "row",
      gap: 0,
      alignItems: "stretch",
      borderBottom: "1px solid var(--gray-6)"
    }}>
      {/* Left spacer matching controls width */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "200px",
        padding: "12px",
        backgroundColor: "var(--gray-3)",
        borderRight: "1px solid var(--gray-6)",
        boxSizing: "border-box"
      }}
      ></div>

      {/* Timeline ruler aligned with waveforms */}
      <div style={{
        flex: 1,
        height: "24px",
        position: "relative",
        borderBottom: "1px solid var(--gray-8)",
        backgroundColor: "var(--gray-2)",
        boxSizing: "border-box"
      }}>
        {/* Generate tick marks every second */}
        {Array.from({ length: totalSeconds + 1 }, (_, i) => {
          const seconds = i;
          const percent = (seconds / maxDuration) * 100;
          const isMajorTick = seconds % 5 === 0;

          return (
            <div
              key={seconds}
              style={{
                position: "absolute",
                left: `${percent}%`,
                bottom: 0,
                height: isMajorTick ? "12px" : "6px",
                width: "1px",
                backgroundColor: isMajorTick ? "var(--gray-10)" : "var(--gray-7)"
              }}
            />
          );
        })}

        {/* Time labels at major intervals (every 5 seconds) */}
        {Array.from(
          { length: Math.floor(totalSeconds / 5) + 1 },
          (_, i) => i * 5
        ).map((seconds) => {
          const percent = (seconds / maxDuration) * 100;
          return (
            <div
              key={`label-${seconds}`}
              style={{
                position: "absolute",
                left: `${percent}%`,
                top: "-6px",
                transform: "translateX(-50%)"
              }}
            >
              <Text size="1" color="gray" style={{ fontWeight: "500" }}>
                {seconds}
              </Text>
            </div>
          );
        })}
      </div>
    </div>
  );
};
