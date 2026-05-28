import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(defineConfig({
  title: "OpenDAW Handbook",
  description:
    "Learn how to build a browser-based DAW UI with OpenDAW's headless audio engine",

  // Serve under /docs/ on the same Cloudflare Pages domain as the demos
  base: "/docs/",

  // Build into dist/docs/ so the Vite demo build (dist/) and docs coexist
  outDir: "../dist/docs",

  // Map README.md → index.html so /docs/ works, while keeping README.md for GitHub
  rewrites: {
    "README.md": "index.md",
    "internals/README.md": "internals/index.md",
  },

  head: [
    [
      "script",
      {
        "data-goatcounter": "https://opendaw-handbook.goatcounter.com/count",
        async: "",
        src: "//gc.zgo.at/count.js",
      },
    ],
  ],

  sitemap: {
    hostname: "https://opendaw-test.pages.dev",
    transformItems: (items) =>
      items.map((item) => ({ ...item, url: `docs/${item.url}` })),
  },

  themeConfig: {
    sidebar: [
      {
        text: "Core Handbook",
        items: [
          { text: "Quick Start", link: "/quick-start" },
          { text: "System Architecture", link: "/00-system-architecture" },
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
          { text: "MIDI Deep Dive", link: "/16-midi" },
          { text: "Modular Devices", link: "/17-modular-devices" },
          { text: "Time & Pitch", link: "/18-time-and-pitch" },
        ],
      },
      {
        text: "Appendix",
        items: [
          {
            text: "Browser Compatibility",
            link: "/12-browser-compatibility",
          },
          { text: "Troubleshooting & FAQ", link: "/13-troubleshooting" },
          { text: "Glossary", link: "/14-glossary" },
          {
            text: "Performance & Debugging",
            link: "/15-performance-and-debugging",
          },
        ],
      },
      {
        text: "Internals (Contributors)",
        items: [
          { text: "Overview", link: "/internals/" },
          { text: "Engine Processor", link: "/internals/01-engine-processor" },
          { text: "Box System", link: "/internals/02-box-system" },
          {
            text: "Cross-Thread Protocols",
            link: "/internals/03-cross-thread-protocols",
          },
          { text: "Sample Loading", link: "/internals/04-sample-loading" },
          {
            text: "Devices and Effects",
            link: "/internals/05-devices-and-effects",
          },
          {
            text: "Project and Persistence",
            link: "/internals/06-project-and-persistence",
          },
          {
            text: "Repo Layout and Dev Workflow",
            link: "/internals/07-dev-workflow",
          },
        ],
      },
    ],

    nav: [
      { text: "Handbook", link: "/01-introduction" },
      { text: "Demos", link: "https://opendaw-test.pages.dev" },
      {
        text: "Changelogs",
        link: "https://github.com/naomiaro/opendaw-test/tree/main/changelogs",
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/naomiaro/opendaw-test",
      },
    ],

    search: {
      provider: "local",
    },

    outline: {
      level: [2, 3],
    },
  },

  mermaid: {
    theme: "default",
  },
}));
