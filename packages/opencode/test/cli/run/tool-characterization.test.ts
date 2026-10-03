import { expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolInlineInfo, toolFrame, toolScroll, toolView, toolSnapshot } from "@/cli/cmd/run/tool"
import { replaySession } from "@/cli/cmd/run/session-replay"
import { reduceSessionData, createSessionData } from "@/cli/cmd/run/session-data"
import type { SessionMessages } from "@/cli/cmd/run/session.shared"

const part: ToolPart = {
  id: "part", messageID: "msg", sessionID: "session", callID: "call", type: "tool", tool: "grep",
  state: { status: "completed", input: { pattern: "needle", path: "src" }, metadata: { matches: 2 }, title: "", output: "src/a:needle", time: { start: 1, end: 11 } },
}

test("built-in mini inline and scrollback formatting", () => {
  const commit = { kind: "tool", source: "tool", phase: "final", text: "src/a:needle", tool: "grep", toolState: "completed", part } as const
  const frame = toolFrame(commit, commit.text)
  expect({ inline: toolInlineInfo(part), view: toolView("grep"), start: toolScroll("start", frame), progress: toolScroll("progress", frame), final: toolScroll("final", frame), snapshot: toolSnapshot(commit, commit.text) }).toMatchSnapshot()
})

test("built-in mini live update and replay", () => {
  const info = { id: "msg", sessionID: "session", role: "assistant", parentID: "user", agent: "build", mode: "chat", modelID: "test", providerID: "test", path: { cwd: "/tmp", root: "/tmp" }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, completed: 11 } } as const
  const replay = replaySession({ messages: [{ info, parts: [part] }] as SessionMessages, permissions: [], questions: [], thinking: false, limits: {} })
  const live = reduceSessionData({ data: createSessionData(), event: { type: "message.part.updated", properties: { part } }, sessionID: "session", thinking: false, limits: {} })
  expect({ replay: replay.commits, live }).toMatchSnapshot()
})
