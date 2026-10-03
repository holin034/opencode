import { describe, expect, test } from "bun:test"
import { ToolPresentation } from "../src/util/tool-presentation"

describe("tool presentation", () => {
  test("retains original external identity and interface-specific built-ins", () => {
    const origin = { kind: "mcp", server: "my_server.v2", tool: "search_items" }
    expect(ToolPresentation.describe("my_server_v2_search_items", { query: "needle" }, origin)).toEqual({
      kind: "mcp",
      name: "my_server.v2 > search_items",
      summary: "[query=needle]",
    })
    expect(ToolPresentation.describe("db", {}, { kind: "custom", namespace: "db", tool: "default" }).name).toBe(
      "db > default",
    )
    expect(ToolPresentation.describe("db_search", {}, { kind: "custom", namespace: "db", tool: "search" }).name).toBe(
      "db > search",
    )
    expect(ToolPresentation.renderer("bash", "tui", origin)).toBe("generic")
    expect(ToolPresentation.renderer("bash", "mini", origin)).toBe("generic")
    expect(ToolPresentation.renderer("bash", "mini")).toBe("bash")
    expect(ToolPresentation.renderer("execute", "tui")).toBe("execute")
    expect(ToolPresentation.renderer("execute", "mini")).toBe("generic")
    expect(ToolPresentation.renderer("lsp", "tui")).toBe("generic")
    expect(ToolPresentation.renderer("lsp", "mini")).toBe("lsp")
  })

  test("unknown, missing, malformed and prototype names are safe", () => {
    for (const origin of [
      undefined,
      null,
      {},
      { kind: "mcp", server: "x" },
      { kind: "custom", namespace: "", tool: "x" },
      [],
    ]) {
      expect(ToolPresentation.describe("never_seen", {}, origin)).toEqual({
        kind: "unknown",
        name: "never_seen",
        summary: "",
      })
    }
    for (const name of ["never_seen", "__proto__", "constructor", "toString"])
      expect(ToolPresentation.renderer(name, "mini")).toBe("generic")
  })

  test("nested primitives are prioritized; secrets and bodies are omitted", () => {
    const input = {
      limit: 10,
      args: {
        query: "needle",
        credentials: { path: "secret" },
        content: { operation: "secret" },
        body: { action: "secret" },
        payload: { uri: "secret" },
        api_key: "secret",
      },
      operation: "search",
      arbitrary: "hidden",
    }
    expect(ToolPresentation.describe("x", input).summary).toBe("[operation=search, args.query=needle, limit=10]")
    expect(input.args.query).toBe("needle")
    expect(ToolPresentation.describe("x", { query: { token: "secret" } }).summary).toBe("")
  })

  test("depth, traversal, value and total limits", () => {
    expect(
      ToolPresentation.describe("x", { a: { b: { c: { query: "visible", d: { action: "hidden" } } } } }).summary,
    ).toBe("[a.b.c.query=visible]")
    const input = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`ignored${i}`, i]))
    expect(ToolPresentation.describe("x", { ...input, query: "too late" }).summary).toBe("")
    const summary = ToolPresentation.describe("x", {
      operation: "x".repeat(200),
      query: "y".repeat(200),
      path: "z".repeat(200),
      limit: 1,
    }).summary
    expect(summary.length).toBe(240)
    expect(summary).toEndWith("…")
    expect(summary).not.toContain("x".repeat(80))
    expect(summary).not.toContain("limit")
  })

  test("arrays, cycles, getters and proxies never crash", () => {
    const cycle: Record<string, unknown> = { query: "yes" }
    cycle.self = cycle
    expect(ToolPresentation.describe("x", cycle).summary).toBe("[query=yes]")
    expect(ToolPresentation.describe("x", { requests: [{ query: "yes" }] }).summary).toBe("[requests.0.query=yes]")
    expect(
      ToolPresentation.describe("x", {
        get query() {
          throw new Error("must not run")
        },
      }).summary,
    ).toBe("")
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("bad proxy")
        },
      },
    )
    expect(ToolPresentation.describe("x", proxy).summary).toBe("")
  })

  test("normalizes display controls without modifying input", () => {
    const input = { query: "\x1b[31mred\x1b[0m\nnext\u202e" }
    expect(ToolPresentation.describe("\x1b[1mx\x1b[0m", input)).toEqual({
      kind: "unknown",
      name: "x",
      summary: "[query=red next ]",
    })
    expect(input.query).toContain("\x1b")
  })
})
