import { afterEach, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import type { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2"
import { SessionToolContext, SessionToolPart } from "../../../src/routes/session"
import { ThemeContext, useTheme, allThemes, resolveTheme } from "../../../src/context/theme"
import { SyncContext, useSync } from "../../../src/context/sync"
import { LocationProvider } from "../../../src/context/location"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TestTuiContexts } from "../../fixture/tui-environment"

let app: Awaited<ReturnType<typeof testRender>> | undefined
afterEach(() => {
  app?.renderer.destroy()
  app = undefined
})

function part(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}): ToolPart {
  return {
    id: "part",
    messageID: "msg",
    sessionID: "session",
    callID: "call",
    type: "tool",
    tool,
    state: { status: "completed", input, metadata, title: "", output: "result", time: { start: 1, end: 2 } },
  }
}

async function renderTool(value: ToolPart) {
  const [output, setOutput] = createSignal(false)
  const sync = { data: { permission: {} } } as unknown as ReturnType<typeof useSync>
  const theme = { theme: resolveTheme(allThemes().opencode, "dark") } as ReturnType<typeof useTheme>
  app = await testRender(
    () => (
      <TestTuiContexts>
        <LocationProvider>
          <ThemeContext.Provider value={theme}>
            <SyncContext.Provider value={sync}>
              <SessionToolContext.Provider
                value={{
                  width: 90,
                  sessionID: "session",
                  conceal: () => false,
                  thinkingMode: () => "show",
                  showThinking: () => false,
                  showTimestamps: () => false,
                  showDetails: () => true,
                  showGenericToolOutput: output,
                  diffWrapMode: () => "word",
                  providers: () => new Map(),
                  sync,
                  tui: createTuiResolvedConfig({}),
                }}
              >
                <SessionToolPart last={true} part={value} message={{} as AssistantMessage} />
              </SessionToolContext.Provider>
            </SyncContext.Provider>
          </ThemeContext.Provider>
        </LocationProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 25 },
  )
  await app.renderOnce()
  await app.renderOnce()
  return {
    app,
    setOutput,
    frame: () =>
      app!
        .captureCharFrame()
        .split("\n")
        .map((x) => x.trimEnd())
        .join("\n")
        .trimEnd(),
  }
}

test("actual built-in inline dispatch stays unchanged", async () => {
  const view = await renderTool(part("grep", { pattern: "needle", path: "src" }, { matches: 2 }))
  expect(view.frame()).toMatchSnapshot()
})

test("actual built-in block dispatch stays unchanged", async () => {
  const view = await renderTool(part("bash", { command: "printf hello" }, { output: "hello" }))
  expect(view.frame()).toMatchSnapshot()
})

test("external identity, output toggle and expansion use actual generic component", async () => {
  const value = part("my_server_search_items", { query: "needle", token: "secret" })
  value.metadata = { toolPresentation: { kind: "mcp", server: "my_server", tool: "search_items" } }
  if (value.state.status === "completed") value.state.output = "first\nsecond\nthird\nfourth\nfifth"
  const view = await renderTool(value)
  expect(view.frame()).toContain("my_server > search_items [query=needle]")
  expect(view.frame()).not.toContain("secret")
  expect(view.frame()).not.toContain("first")
  view.setOutput(true)
  await view.app.renderOnce()
  expect(view.frame()).toContain("# my_server > search_items [query=needle]")
  expect(view.frame()).toContain("first")
  expect(view.frame()).not.toContain("fifth")
  expect(view.frame()).toContain("Click to expand")
  await view.app.mockMouse.click(10, 3)
  await view.app.renderOnce()
  expect(view.frame()).toContain("fifth")
  expect(view.frame()).toContain("Click to collapse")
  await view.app.mockMouse.click(10, 3)
  await view.app.renderOnce()
  expect(view.frame()).not.toContain("fifth")
  view.setOutput(false)
  await view.app.renderOnce()
  expect(view.frame()).not.toContain("first")
})

test("external tools with a built-in name use generic rendering", async () => {
  const value = part("grep", { query: "needle" })
  value.metadata = { toolPresentation: { kind: "custom", namespace: "grep", tool: "default" } }
  const view = await renderTool(value)
  expect(view.frame()).toContain("grep > default [query=needle]")
})

test("unknown failed call without metadata still renders", async () => {
  const value = part("never_seen", { nested: { query: "needle" } })
  value.state = { status: "error", input: value.state.input, error: "failed", time: { start: 1, end: 2 } }
  const view = await renderTool(value)
  expect(view.frame()).toContain("never_seen [nested.query=needle]")
})
