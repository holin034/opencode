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
afterEach(() => { app?.renderer.destroy(); app = undefined })

function part(tool: string, input: Record<string, unknown>, metadata: Record<string, unknown> = {}): ToolPart {
  return {
    id: "part", messageID: "msg", sessionID: "session", callID: "call", type: "tool", tool,
    state: { status: "completed", input, metadata, title: "", output: "result", time: { start: 1, end: 2 } },
  }
}

async function renderTool(value: ToolPart) {
  const [output, setOutput] = createSignal(false)
  const sync = { data: { permission: {} } } as unknown as ReturnType<typeof useSync>
  const theme = { theme: resolveTheme(allThemes().opencode, "dark") } as ReturnType<typeof useTheme>
  app = await testRender(() => (
    <TestTuiContexts>
      <LocationProvider>
        <ThemeContext.Provider value={theme}>
          <SyncContext.Provider value={sync}>
            <SessionToolContext.Provider value={{
              width: 90, sessionID: "session", conceal: () => false, thinkingMode: () => "show",
              showThinking: () => false, showTimestamps: () => false, showDetails: () => true,
              showGenericToolOutput: output, diffWrapMode: () => "word", providers: () => new Map(),
              sync, tui: createTuiResolvedConfig({}),
            }}>
              <SessionToolPart last={true} part={value} message={{} as AssistantMessage} />
            </SessionToolContext.Provider>
          </SyncContext.Provider>
        </ThemeContext.Provider>
      </LocationProvider>
    </TestTuiContexts>
  ), { width: 90, height: 25 })
  await app.renderOnce()
  await app.renderOnce()
  return { app, setOutput, frame: () => app!.captureCharFrame().split("\n").map(x => x.trimEnd()).join("\n").trimEnd() }
}

test("actual built-in inline dispatch stays unchanged", async () => {
  const view = await renderTool(part("grep", { pattern: "needle", path: "src" }, { matches: 2 }))
  expect(view.frame()).toMatchSnapshot()
})

test("actual built-in block dispatch stays unchanged", async () => {
  const view = await renderTool(part("bash", { command: "printf hello" }, { output: "hello" }))
  expect(view.frame()).toMatchSnapshot()
})
