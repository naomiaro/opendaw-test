# Loudness meter harness — other browsers

The Playwright MCP drives Chrome. These two scripts run the same harness page in the installed
Firefox and Safari, each with a real click on Run, and print the result table when the run ends.
Every script runs directly under Node ≥ 23 type stripping, from the repo root, against a running
dev server (`npm run dev -- --port 5180 --host 127.0.0.1 --strictPort`):

```
node scripts/audit/loudness/drive-firefox.ts "https://localhost:5180/loudness-meter-audit-debug-demo.html?case=all" [timeoutSeconds]
node scripts/audit/loudness/drive-safari.ts  "https://localhost:5180/loudness-meter-audit-debug-demo.html?case=all" [timeoutSeconds]
```

| script | how it reaches the browser |
|---|---|
| `drive-firefox.ts` | WebDriver BiDi over the WebSocket Firefox opens with `--remote-debugging-port`, in a fresh profile; no geckodriver |
| `drive-safari.ts` | the system `safaridriver` (classic WebDriver); Safari > Develop > Allow Remote Automation must be on |
| `report.ts` | the page expressions and the printing both share |

A full run is about twelve minutes; the default timeout is 900 s, so pass a larger one for
`?case=all` (1100 is enough). Keep the browser window uncovered: a hidden tab stops receiving the
meter's readings and its cases are marked invalid. The summary is saved by the page itself to
`.verify-output/loudness-audit-<timestamp>.json`, whichever browser ran it.

Run one browser at a time. A second window on top of the first can hide its tab.
