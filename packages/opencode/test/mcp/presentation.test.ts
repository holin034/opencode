import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { ToolPresentation } from "@opencode-ai/core/util/tool-presentation"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(MCP.node))
it.instance("MCP catalog retains configured origin and tool results", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const protocol = new Server({ name: "protocol-name", version: "1.0.0" }, { capabilities: { tools: {} } })
        protocol.setRequestHandler(ListToolsRequestSchema, () =>
          Promise.resolve({
            tools: [
              { name: "search_items", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
            ],
          }),
        )
        protocol.setRequestHandler(CallToolRequestSchema, () =>
          Promise.resolve({ content: [{ type: "text", text: "original result\n" }] }),
        )
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        })
        await protocol.connect(transport)
        const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
        return {
          url: http.url.toString(),
          close: async () => {
            await http.stop(true)
            await protocol.close()
          },
        }
      }),
      (server) => Effect.promise(server.close),
    )
    const mcp = yield* MCP.Service
    yield* mcp.add("my_server.v2", { type: "remote", url: server.url, oauth: false })
    const tools = yield* mcp.tools()
    const entry = tools[McpCatalog.toolName("my_server.v2", "search_items")]
    expect(entry.server).toBe("my_server.v2")
    const origin = { kind: "mcp", server: entry.server, tool: entry.def.name }
    expect(ToolPresentation.describe("my_server_v2_search_items", { query: "needle" }, origin).name).toBe(
      "my_server.v2 > search_items",
    )
    const tool = McpCatalog.convertTool(entry.def, entry.client, entry.timeout)
    const result = yield* Effect.promise(async () =>
      tool.execute?.(
        { query: "needle" },
        { toolCallId: "call", messages: [], abortSignal: new AbortController().signal },
      ),
    )
    expect(result).toMatchObject({ content: [{ type: "text", text: "original result\n" }] })
    expect(result).not.toHaveProperty("toolPresentation")
    yield* mcp.disconnect("my_server.v2")
  }),
)
