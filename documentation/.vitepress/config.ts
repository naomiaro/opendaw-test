import { defineConfig } from "vitepress";

export default defineConfig({
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
  },

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
});
