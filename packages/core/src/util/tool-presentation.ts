/** Display-only identity. Never include this in provider metadata or tool results. */
export type ToolOrigin =
  | { kind: "mcp"; server: string; tool: string }
  | { kind: "custom"; namespace: string; tool: string }

// Recognition is shared; each interface continues to own its drawing rules.
const renderers = {
  bash: { tui: "bash", mini: "bash" },
  glob: { tui: "glob", mini: "glob" },
  read: { tui: "read", mini: "read" },
  grep: { tui: "grep", mini: "grep" },
  webfetch: { tui: "webfetch", mini: "webfetch" },
  websearch: { tui: "websearch", mini: "websearch" },
  write: { tui: "write", mini: "write" },
  edit: { tui: "edit", mini: "edit" },
  task: { tui: "task", mini: "task" },
  apply_patch: { tui: "apply_patch", mini: "apply_patch" },
  todowrite: { tui: "todowrite", mini: "todowrite" },
  question: { tui: "question", mini: "question" },
  skill: { tui: "skill", mini: "skill" },
  execute: { tui: "execute", mini: "generic" },
  invalid: { tui: "generic", mini: "invalid" },
  batch: { tui: "generic", mini: "batch" },
  list: { tui: "generic", mini: "list" },
  lsp: { tui: "generic", mini: "lsp" },
  plan_exit: { tui: "generic", mini: "plan_exit" },
} as const

export type ToolRenderer<Interface extends "tui" | "mini"> = (typeof renderers)[keyof typeof renderers][Interface]

export function renderer<Interface extends "tui" | "mini">(
  tool: string,
  ui: Interface,
  origin?: unknown,
): ToolRenderer<Interface> {
  if (readOrigin(origin)) return "generic"
  if (!knownTool(tool)) return "generic"
  return renderers[tool][ui]
}

function knownTool(tool: string): tool is keyof typeof renderers {
  return Object.hasOwn(renderers, tool)
}

export function describe(tool: string, input: unknown, origin?: unknown) {
  const source = readOrigin(origin)
  return {
    kind: source?.kind ?? (knownTool(tool) ? "builtin" : "unknown"),
    name: clean(source ? `${source.kind === "mcp" ? source.server : source.namespace} > ${source.tool}` : tool),
    summary: summarize(input),
  }
}

export function readOrigin(value: unknown): ToolOrigin | undefined {
  if (!value || typeof value !== "object") return undefined
  try {
    const kind = field(value, "kind")
    const tool = field(value, "tool")
    if (typeof tool !== "string" || !tool.trim()) return undefined
    if (kind === "mcp") {
      const server = field(value, "server")
      if (typeof server === "string" && server.trim()) return { kind, server, tool }
    }
    if (kind === "custom") {
      const namespace = field(value, "namespace")
      if (typeof namespace === "string" && namespace.trim()) return { kind, namespace, tool }
    }
  } catch {
    // Metadata is optional; malformed objects must not prevent rendering.
  }
  return undefined
}

const approved = [
  "operation",
  "action",
  "query",
  "pattern",
  "filePath",
  "path",
  "uri",
  "url",
  "resourceId",
  "limit",
  "offset",
] as const
const omitted = /password|passwd|secret|token|credential|authorization|cookie|apikey|privatekey|content|body|payload/i

function summarize(input: unknown) {
  const found: { key: (typeof approved)[number]; path: string; value: string }[] = []
  const seen = new Set<object>()
  let remaining = 64
  function visit(value: unknown, depth: number, prefix: string) {
    if (!value || typeof value !== "object" || depth > 3 || seen.has(value) || remaining <= 0) return
    seen.add(value)
    for (const key in value) {
      if (remaining-- <= 0) return
      if (!Object.hasOwn(value, key) || omitted.test(key.replace(/[^a-z]/gi, ""))) continue
      const item = field(value, key)
      const path = prefix ? `${prefix}.${key}` : key
      const notable = approved.find((name) => name === key)
      if (
        notable &&
        (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)))
      ) {
        found.push({ key: notable, path: clean(path), value: truncate(clean(String(item)), 80) })
      }
      visit(item, depth + 1, path)
    }
  }
  try {
    visit(input, 0, "")
  } catch {
    // In particular, tolerate proxies without invoking getters or serializers.
  }
  const values = found.sort((a, b) => approved.indexOf(a.key) - approved.indexOf(b.key)).slice(0, 3)
  if (!values.length) return ""
  return truncate(`[${values.map((item) => `${item.path}=${item.value}`).join(", ")}]`, 240)
}

function field(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function clean(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max - 1) + "…"
}

export * as ToolPresentation from "./tool-presentation"
