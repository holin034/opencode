import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { sanitize } from "../../src/cli/cmd/export/sanitize"
import { FORMATS, isFormat, renderJson } from "../../src/cli/cmd/export/render"
import { renderMarkdown } from "../../src/cli/cmd/export/markdown"
import raw from "../fixture/export-session.json"

// The fixture holds one session with every part type. Sensitive fields carry a
// `SECRET-` marker so redaction can be checked by searching the output.
const decodeInfo = Schema.decodeUnknownSync(Session.Info)
const decodeMessage = Schema.decodeUnknownSync(SessionV1.WithParts)

function fixture() {
  return {
    info: decodeInfo(raw.info) as Session.Info,
    messages: raw.messages.map((msg) => decodeMessage(msg) as SessionV1.WithParts),
  }
}

const PART_TYPES: string[] = [
  "text",
  "subtask",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
]

describe("export fixture", () => {
  test("covers every part type", () => {
    const types = new Set<string>(fixture().messages.flatMap((msg) => msg.parts.map((part) => part.type)))
    expect([...types].sort()).toEqual([...PART_TYPES].sort())
  })
})

describe("export sanitize", () => {
  test("output is unchanged", () => {
    expect(sanitize(fixture())).toMatchSnapshot()
  })

  test("only the known unredacted fields still contain secrets", () => {
    const found = JSON.stringify(sanitize(fixture())).match(/SECRET-[\w.-]+/g) ?? []
    // RetryPart.error and the tool "error" state are not redacted today.
    expect([...new Set(found)].sort()).toEqual(["SECRET-response-body", "SECRET-tool-error"])
  })

  test("does not modify its input", () => {
    const data = fixture()
    const before = JSON.stringify(data)
    sanitize(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe("export json", () => {
  test("output is unchanged", () => {
    expect(renderJson(fixture())).toMatchSnapshot()
  })

  test("round trips through the schemas import decodes with", () => {
    const data = fixture()
    const parsed = JSON.parse(JSON.stringify(data, null, 2))
    expect(decodeInfo(parsed.info)).toEqual(data.info)
    expect(parsed.messages.map((msg: unknown) => decodeMessage(msg))).toEqual(data.messages)
  })
})

function secrets(text: string) {
  return [...new Set(text.match(/SECRET-[\w.-]+/g) ?? [])].sort()
}

describe("export formats", () => {
  test("accepts only registered formats", () => {
    expect(Object.keys(FORMATS)).toEqual(["json", "md"])
    expect(isFormat("json")).toBe(true)
    expect(isFormat("md")).toBe(true)
    expect(isFormat("nope")).toBe(false)
    // Inherited object keys are not formats.
    expect(isFormat("toString")).toBe(false)
  })
})

describe("export markdown", () => {
  test("output is unchanged", () => {
    expect(renderMarkdown(fixture())).toMatchSnapshot()
  })

  test("shows the conversation readably", () => {
    const md = renderMarkdown(fixture())
    expect(md).toStartWith("# Fix login timeout in SECRET-acme auth service\n")
    expect(md).toContain("## User")
    expect(md).toContain("## Assistant _(build · anthropic/claude-sonnet-5-5)_")
    expect(md).toContain("**Tool: read** (completed)")
    expect(md).toContain("**Tool: bash** (error)")
    // Bookkeeping parts are left out.
    expect(md).not.toContain("SECRET-snapshot")
  })

  test("renders an empty session", () => {
    const md = renderMarkdown({ info: fixture().info, messages: [] })
    expect(md).toContain("# Fix login timeout")
    expect(md).toContain("_No messages._")
  })

  test("tool output containing a code fence stays inside its block", () => {
    const data = fixture()
    const tool = data.messages[1].parts.find((part) => part.type === "tool" && part.state.status === "completed")
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("fixture has no completed tool")
    tool.state.output = "before\n```\nafter"
    expect(renderMarkdown(data)).toContain("````\nbefore\n```\nafter\n````")
  })

  test("never reveals more than json when sanitized", () => {
    const data = sanitize(fixture())
    const md = secrets(renderMarkdown(data))
    const json = secrets(renderJson(data))
    expect(md.filter((secret) => !json.includes(secret))).toEqual([])
    // The tool error is not redacted by sanitize today, so it shows in both formats.
    expect(md).toEqual(["SECRET-tool-error"])
  })
})
