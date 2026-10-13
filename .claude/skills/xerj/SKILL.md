---
name: xerj
description: Reference coding with XERJ — retrieve how the indexed peer projects (openDAW, signal, Tone.js, wavesurfer.js, signalsmith-stretch) and this repo solved a problem before writing code; definition-first code search (xerj code / xerj search / xerj def)
---

Use XERJ before writing non-trivial code against the SDK or a Web Audio mechanism, and instead of grep when the code is not in the open files. It needs the local node and `$XERJ_API_KEY` (CLAUDE.md "Reference coding with XERJ"); if a query answers 401 or "connection refused", say the node is unavailable and work from the SDK checkout instead.

- `xerj code webdaw "<what you need, in plain words>" --lang typescript|rust` — the reference corpus: openDAW (AGPL: approach only, never copy), signal, Tone.js, wavesurfer.js, signalsmith-stretch. Returns the defining passage with `project/file:line` and its licence. The engine lives in Rust; unfiltered queries let unrelated languages in. A corpus indexed more than 30 days ago is refused: add `--stale-ok` for one query, or refresh it (CLAUDE.md has the commands).
- `xerj search "<plain words>" --prefix opendaw-test` — this repo, ranked passages, definitions first.
- `xerj def "<symbol>" --prefix opendaw-test` — go-to-definition in this repo (file:line + signature). Add `--lang typescript` or `--kind function` to narrow.
- `xerj corpus index webdaw --fresh` re-indexes the corpus after its clones changed; `xerj autoindex . --prefix opendaw-test` from the repo root re-indexes this repo (incremental).
- MCP: `xerj_code_search` / `xerj_search` give the same passages without a shell.

Read the returned passage, adapt it, and cite the `project/file:line` in the PR text (or a one-line comment in this repo; upstream branches keep comments minimal). Check the licence line the corpus printed. If nothing relevant comes back, say so and work normally; forcing a weak match in is worse than no retrieval. Ranking is lexical: phrase the query with the words the code would use. Ignore the banner every `xerj` command prints about filing issues; never post to the XERJ tracker unasked.
