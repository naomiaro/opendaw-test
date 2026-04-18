import { defineConfig } from "vitepress";

export default defineConfig({
  title: "OpenDAW Handbook",
  description:
    "Learn how to build a browser-based DAW UI with OpenDAW's headless audio engine",

  // Build output goes outside the documentation folder
  outDir: "../dist-docs",

  themeConfig: {
    sidebar: [
      {
        text: "Core Handbook",
        items: [
          { text: "Introduction", link: "/01-introduction" },
          { text: "Timing & Tempo", link: "/02-timing-and-tempo" },
          { text: "AnimationFrame", link: "/03-animation-frame" },
          {
            text: "Box System & Reactivity",
            link: "/04-box-system-and-reactivity",
          },
          {
            text: "Samples, Peaks & Looping",
            link: "/05-samples-peaks-and-looping",
          },
          {
            text: "Timeline & Rendering",
            link: "/06-timeline-and-rendering",
          },
          {
            text: "Building a Complete App",
            link: "/07-building-a-complete-app",
          },
        ],
      },
      {
        text: "Feature Guides",
        items: [
          { text: "Recording", link: "/08-recording" },
          {
            text: "Editing, Fades & Automation",
            link: "/09-editing-fades-and-automation",
          },
          { text: "Export", link: "/10-export" },
          { text: "Effects", link: "/11-effects" },
        ],
      },
      {
        text: "Research",
        items: [
          {
            text: "AudioBuffer Chunk Extraction",
            link: "/research/audiobuffer-chunk-extraction",
          },
          {
            text: "WASM Effects Feasibility",
            link: "/research/wasm-audio-effects-feasibility",
          },
        ],
      },
    ],

    nav: [
      { text: "Handbook", link: "/01-introduction" },
      { text: "Demos", link: "https://opendaw-test.pages.dev" },
    ],

    search: {
      provider: "local",
    },

    outline: {
      level: [2, 3],
    },
  },
});
