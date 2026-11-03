# Task 8 report: semantics table script

Implemented scripts/audit/midi-effect-semantics/table.ts (formatRows, runLine, rowDeltas, acceptPath(rate, root), writeAccepted) plus table.test.ts and the SCRIPTS entry.
- RED: first vitest run failed on the missing ./table.ts module (no tests collected). GREEN: `npx vitest run scripts/audit` 24 passed; `npm run typecheck` exit 0.
- Real envelope 1793740770955 prints 8 rows and the run line (holds 4 deviation 3 broken 1). Unknown token prints "no midisem summary" and exits 1. --accept NOT run for real; tested via writeAccepted with a temp root (first write, replace diff, refusal, FORCED).
- Decision: rowDeltas pairs by place only when read.length equals predicted.length (readable predicted notes only); otherwise prints "—". Index pairing on mismatched lists produced a bogus 3750 ms delta on the real data.
- Decision: runLine counts error rows under "error" only, not under their rule class. Render ms rounded to integer.
- Diff lines printed: [FORCED], "no previous register", added/removed/changed lists, or "no differences".
