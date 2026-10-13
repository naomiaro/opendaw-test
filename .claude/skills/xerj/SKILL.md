---
name: xerj
description: Reference coding with XERJ — retrieve how the indexed peer projects (openDAW, signal, Tone.js, wavesurfer.js, signalsmith-stretch) and this repo solved a problem before writing code; definition-first code search (xerj code / xerj search / xerj def)
---

Use XERJ before writing non-trivial code against the SDK or a Web Audio mechanism, and instead of grep when the code is not in the open files. The node must be running (see CLAUDE.md "Reference coding with XERJ"); the key is `$XERJ_API_KEY`.

- `xerj code webdaw "<what you need, in plain words>"` — the reference corpus: openDAW (AGPL: approach only, never copy), signal, Tone.js, wavesurfer.js, signalsmith-stretch. Returns the defining passage with `project/file:line`. Add `--lang typescript` or `--lang rust` (the engine lives in Rust): unfiltered queries let unrelated languages in.
- `xerj search "<plain words>" --prefix opendaw-test` — this repo, ranked passages, definitions first.
- `xerj def "<symbol>" --prefix opendaw-test` — go-to-definition in this repo (file:line + signature). Add `--lang typescript` or `--kind function` to narrow.
- `xerj corpus index webdaw` — re-index after the clones change; `xerj autoindex /Users/naomiaro/Code/opendaw-test --prefix opendaw-test` re-indexes this repo (incremental).
- MCP: `xerj_code_search` / `xerj_search` give the same passages without a shell.

Read the returned passage, adapt it, cite the `project/file:line` in the code comment or PR text, and check the licence line the corpus printed. If nothing relevant comes back, say so and work normally; forcing a weak match in is worse than no retrieval. The default embedder is lexical: phrase the query with the words the code would use.
