import { expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { toolInlineInfo, toolFrame, toolScroll, toolView, toolSnapshot } from "@/cli/cmd/run/tool"
import { replaySession } from "@/cli/cmd/run/session-replay"
import { reduceSessionData, createSessionData } from "@/cli/cmd/run/session-data"
import type { SessionMessages } from "@/cli/cmd/run/session.shared"

const part: ToolPart = {
  id: "part",
  messageID: "msg",
  sessionID: "session",
  callID: "call",
  type: "tool",
  tool: "grep",
  state: {
    status: "completed",
    input: { pattern: "needle", path: "src" },
    metadata: { matches: 2 },
    title: "",
    output: "src/a:needle",
    time: { start: 1, end: 11 },
  },
}

test("built-in mini inline and scrollback formatting", () => {
  const commit = {
    kind: "tool",
    source: "tool",
    phase: "final",
    text: "src/a:needle",
    tool: "grep",
    toolState: "completed",
    part,
  } as const
  const frame = toolFrame(commit, commit.text)
  expect({
    inline: toolInlineInfo(part),
    view: toolView("grep"),
    start: toolScroll("start", frame),
    progress: toolScroll("progress", frame),
    final: toolScroll("final", frame),
    snapshot: toolSnapshot(commit, commit.text),
  }).toMatchSnapshot()
})

test("built-in mini live update and replay", () => {
  const info = {
    id: "msg",
    sessionID: "session",
    role: "assistant",
    parentID: "user",
    agent: "build",
    mode: "chat",
    modelID: "test",
    providerID: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 11 },
  } as const
  const replay = replaySession({
    messages: [{ info, parts: [part] }] as SessionMessages,
    permissions: [],
    questions: [],
    thinking: false,
    limits: {},
  })
  const live = reduceSessionData({
    data: createSessionData(),
    event: { id: "event", type: "message.part.updated", properties: { part, sessionID: "session", time: 11 } },
    sessionID: "session",
    thinking: false,
    limits: {},
  })
  expect({ replay: replay.commits, live }).toMatchSnapshot()
})

test("external mini inline, scrollback and failure share identity", () => {
  const external = {
    ...part,
    tool: "my_server_search_items",
    metadata: { toolPresentation: { kind: "mcp", server: "my_server", tool: "search_items" } },
    state: { ...part.state, input: { query: "needle" } },
  }
  const commit = {
    kind: "tool",
    source: "tool",
    phase: "final",
    text: "result",
    tool: external.tool,
    part: external,
  } as const
  expect(toolInlineInfo(external).title).toBe("my_server > search_items [query=needle]")
  expect(toolScroll("start", toolFrame(commit, "result"))).toBe("⚙ my_server > search_items [query=needle]")
  expect(toolScroll("progress", toolFrame(commit, "result"))).toBe("result")
  expect(toolScroll("final", toolFrame(commit, "result"))).toBe(
    "my_server > search_items [query=needle] completed · 10ms",
  )
  const failed = { ...commit, toolState: "error", toolError: "boom" } as const
  expect(toolScroll("final", toolFrame(failed, ""))).toBe("✖ my_server > search_items [query=needle] failed: boom")
  expect(toolInlineInfo({ ...external, tool: "grep" }).title).toBe("my_server > search_items [query=needle]")
})

test("external mini replay retains presentation and fallback visibility", () => {
  const external = {
    ...part,
    tool: "write",
    metadata: { toolPresentation: { kind: "custom", namespace: "files", tool: "save" } },
    state: { ...part.state, input: { path: "src/a.ts" } },
  }
  const info = {
    id: "msg",
    sessionID: "session",
    role: "assistant",
    parentID: "user",
    agent: "build",
    mode: "chat",
    modelID: "test",
    providerID: "test",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 11 },
  } as const
  const replay = replaySession({
    messages: [{ info, parts: [external] }] as SessionMessages,
    permissions: [],
    questions: [],
    thinking: false,
    limits: {},
  })
  const calls = replay.commits.filter((commit) => commit.kind === "tool")
  expect(calls.length).toBeGreaterThan(0)
  for (const commit of calls) {
    expect(toolScroll("start", toolFrame(commit, "result"))).toBe("⚙ files > save [path=src/a.ts]")
    expect(toolSnapshot(commit, "result")).toBeUndefined()
  }
  expect(toolView("write", external.metadata.toolPresentation)).toEqual({ output: true, final: true })
})
