import React from "react";

/**
 * AudioAttribution component - the Cambridge-MT source-audio credit with its
 * full educational-use notice, styled as console fine print (the back-panel
 * plate on a piece of studio hardware). Place directly above <MoisesLogo />.
 *
 * `stems` is a singular noun interpolated as "{stems} stems from ..."
 * (e.g. "Drum", "Guitar", "Vocal", "Mix" — never "Drums").
 */
export const AudioAttribution: React.FC<{ stems: string }> = ({ stems }) => {
  return (
    <>
      <style>{`
        .audio-attribution {
          max-width: 800px;
          margin: 32px auto 0;
          padding: 14px 18px;
          border: 1px solid #2a2620;
          border-radius: 3px;
          background: #151310;
        }
        .audio-attribution-eyebrow {
          margin: 0 0 8px;
          font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #8b8273;
        }
        .audio-attribution-text {
          margin: 0;
          font-size: 12px;
          line-height: 1.6;
          color: #948c7d;
        }
        .audio-attribution-text strong {
          font-weight: 500;
          color: #d8d2c8;
        }
        .audio-attribution-text a {
          color: #e8a33d;
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-color: #5f594e;
          transition: text-decoration-color 120ms ease;
        }
        .audio-attribution-text a:hover {
          text-decoration-color: #e8a33d;
        }
        .audio-attribution-text a:focus-visible {
          outline: 2px solid #e8a33d;
          outline-offset: 2px;
          border-radius: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .audio-attribution-text a { transition: none; }
        }
      `}</style>
      <div className="audio-attribution">
        <p className="audio-attribution-eyebrow">Audio Attribution</p>
        <p className="audio-attribution-text">
          {stems} stems from <strong>Dark Ride&rsquo;s &lsquo;Deny Control&rsquo;</strong>. These
          files are provided for educational purposes only, and the material contained in them
          should not be used for any commercial purpose without the express permission of the
          copyright holders. Please refer to{" "}
          <a href="https://www.cambridge-mt.com" target="_blank" rel="noopener noreferrer">
            www.cambridge-mt.com
          </a>{" "}
          for further details.
        </p>
      </div>
    </>
  );
};
