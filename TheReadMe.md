From the repository root:

```bash
bun install
bun run dev
```

**Issue 12**:
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

**Issue 4**:

# Change notes: persist "always allow" (Issue #4)

## Behavior
- Replying `always` now writes to the existing `permission` table via `PermissionSaved.add`, scoped to the project (`ctx.project.id`). It no longer lives in per-instance memory.
- `Permission.ask` is two-stage (per design_graph):
  1. Evaluate the caller/config ruleset. `deny` is final (`DeniedError`); `allow` proceeds.
  2. Only if undecided, evaluate stored approvals for the project. A match proceeds without prompt; otherwise the request stays pending.
- Stored approvals are never merged into the config ruleset, so a config deny always wins.
- `once` and `reject` store nothing. A stored rule for an unknown permission is just an unmatched rule and never blocks startup.
- Design decisions: scope = project; precedence = config deny > config allow > stored allow > prompt; shape changes = rows are plain `(action, resource)` strings, so no versioning was added.

## Files changed (packages/)
- `opencode/src/permission/index.ts`: depends on `PermissionSaved.node`; `State.approved` removed; two-stage `ask`; `reply` persists `always`; new `approvals()` / `removeApprovals(id)`. Re-exports `Permission.Approval` / `Permission.ApprovalID` (aliases of `PermissionSaved.Info` / `PermissionSaved.ID`) so callers depend on `Permission` only. `removeApprovals(id)` only removes an approval belonging to the current project; another project's id is a no-op.
- `schema/src/v1/permission.ts`: removed unused `Approval` export (and `Project` import).
- `opencode/src/server/routes/instance/httpapi/groups/permission.ts`, `handlers/permission.ts`: `GET /permission/approval`, `DELETE /permission/approval/:id`. They use `Permission.Approval` / `Permission.ApprovalID`, with no direct `PermissionSaved` import.
- `opencode/src/cli/cmd/permission.ts` (new) + `opencode/src/index.ts`: `opencode permission list [--format json]` and `opencode permission remove <id>` (aliases `delete`, `rm`; project-scoped).
- `opencode/src/cli/cmd/run/permission.shared.ts` + its test: copy changed from "until OpenCode is restarted" to "always ... in this project".
- `tui/src/routes/session/permission.tsx`: same copy change in the TUI prompt (2 strings, no test exists for them). Prettier-clean; `packages/tui` typecheck was not re-run after the Prettier rewrite.
- `opencode/test/session/tools.test.ts`: fake `Permission` service gained the two new methods (needed to typecheck).

**Issue 1**:

**Change:** `Ripgrep.grep` and `Ripgrep.glob` now return a shared `SearchResult<T>` with `{ items, truncated }` instead of only an array. The grep tool, glob tool, and `/find` route use the truncation value computed by ripgrep instead of guessing from `result.length == limit`. Each caller still owns its own limit, while ripgrep owns the decision of whether the result was actually truncated.

**Checks:** Run each command from the repository root:  
`(cd packages/core && bun test test/ripgrep.test.ts test/filesystem/search.test.ts)`  
`(cd packages/opencode && bun test test/tool/grep.test.ts test/tool/glob.test.ts)`  
`bun run typecheck`  

The focused checks cover 0 matches, exactly the limit, and one over the limit. They also verify that grep and glob agree at the same limit and that `/find` keeps its existing response body while exposing truncation separately.

**Results:** The full repository typecheck passed with all 30 tasks successful. The focused truncation checks confirm that 0 matches reports `truncated = false`, exactly the limit reports `truncated = false`, and one over the limit returns only the limit and reports `truncated = true`.

**RFC differences:** The final implementation introduced a shared `SearchResult<T>` type for `{ items, truncated }`, following reviewer feedback. The return-type change also required updating additional callers that still treated the result as an array, including filesystem search, core grep/glob tools, the ripgrep debug command, and existing tests. The main design did not change where the callers own their limits and ripgrep owns truncation detection.

**Limits:** The change only affects grep, glob, and the `/find` text-search path. `/find/file` is unchanged. Existing callers that do not need truncation information continue to receive arrays through their wrappers, and the `/find` response body stays backward compatible.

**Team integration:** Issue #1 was merged into the team’s `main` branch. The combined version passed the repository typecheck with 30 successful tasks.


We tested the latest main at 37351a39d with all four features merged. The Core, OpenCode, and TUI suites passed 4,925 tests in all, along with all 30 type checks and the focused tests for each feature. An extra Schema package check then failed four tests. Two event-manifest tests still expect 55 server events while the code has 58, and that mismatch was already in the course snapshot. The other two fail because this project sits in a folder named "Design Pattern", and the tests turn the space into %20 and cannot open the folder. None of our four features change those files and create no error, and the errors come from the original codebase.