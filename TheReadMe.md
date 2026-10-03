**Change:** MCP calls show `server > tool`, custom-file calls show
`namespace > export`, followed by bounded summaries of notable
arguments. Renderer recognition and generic presentation are shared
between the full TUI and `--mini`. Each interface retains its drawing.

**Checks:** Run each command from the repository root:

(cd packages/core && bun test test/tool-presentation.test.ts test/ripgrep.test.ts test/filesystem/search.test.ts)
(cd packages/tui && bun test test/cli/tui/tool-rendering.test.tsx)
(cd packages/opencode && bun test test/cli/run/tool-characterization.test.ts test/tool/grep.test.ts test/tool/glob.test.ts)

**Results:** At commit
`f919b2278fa626ff7abf426a86499f0658c421f9`, all 28 tests above passed,
including unchanged built-in snapshots and generic output interactions.
All 30 repository type-check tasks passed. Additional implementation
tests passed for origin persistence through failures and interruption,
and unchanged model-facing results.

**RFC differences:** Origin uses top-level `part.metadata.toolPresentation`
and is removed before metadata reaches the provider. No major scope changes.

**Limits:** Historical calls without origin metadata display their raw
name. Argument summaries use a fixed allowlist. Unapproved fields are
omitted. Plugin-hook namespace declarations and nested code-mode
presentation are outside this change.

**Team integration:** Issue 12 was combined with issue 1’s search
truncation change without conflicts. The checks above passed on that
combined version.
