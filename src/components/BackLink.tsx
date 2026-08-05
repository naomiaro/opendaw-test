import React from "react";

/**
 * BackLink component - navigation back to the demo index, styled as a
 * mastering-console transport key: hairline-bordered arrow key plus a
 * letter-spaced mono micro-label. Quiet at rest, amber on hover/focus.
 */
export const BackLink: React.FC = () => {
  return (
    <div style={{ width: "100%", marginBottom: 12 }}>
      <style>{`
        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #948c7d;
          text-decoration: none;
          transition: color 120ms ease;
        }
        .back-link-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border: 1px solid #3d3729;
          border-radius: 2px;
          font-size: 13px;
          font-weight: 400;
          color: #8b8273;
          transition: transform 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .back-link:hover { color: #d8d2c8; }
        .back-link:hover .back-link-key {
          color: #e8a33d;
          border-color: #e8a33d;
          transform: translateX(-2px);
        }
        .back-link:focus-visible {
          outline: 2px solid #e8a33d;
          outline-offset: 3px;
          border-radius: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .back-link, .back-link-key { transition: none; }
          .back-link:hover .back-link-key { transform: none; }
        }
      `}</style>
      <a className="back-link" href="/">
        <span className="back-link-key" aria-hidden="true">&larr;</span>
        <span>Back to demos</span>
      </a>
    </div>
  );
};
