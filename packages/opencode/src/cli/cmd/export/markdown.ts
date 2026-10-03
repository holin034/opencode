import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Renderer } from "./render"

// Reads only from the data it is given. Redaction already happened in sanitize,
// so this file must never look up session data on its own.
export const renderMarkdown: Renderer = (data) => {
  const header = [
    `# ${data.info.title}`,
    "",
    `- **Session:** ${data.info.id}`,
    `- **Created:** ${new Date(data.info.time.created).toISOString()}`,
    `- **Updated:** ${new Date(data.info.time.updated).toISOString()}`,
    `- **Directory:** ${data.info.directory}`,
  ].join("\n")
  if (data.messages.length === 0) return `${header}\n\n_No messages._\n`
  return [header, ...data.messages.map(message)].join("\n\n---\n\n") + "\n"
}

function message(msg: SessionV1.WithParts) {
  const body = msg.parts.map(part).filter((text) => text !== "")
  return [heading(msg.info), ...body].join("\n\n")
}

function heading(info: SessionV1.Info) {
  if (info.role === "user") return "## User"
  const title = `## Assistant _(${info.agent} · ${info.providerID}/${info.modelID})_`
  if (!info.error) return title
  return `${title}\n\n**Error:** ${info.error.name}${"message" in info.error.data ? `: ${info.error.data.message}` : ""}`
}

function part(p: SessionV1.Part): string {
  switch (p.type) {
    case "text":
      return p.text
    case "reasoning":
      return quote(`_Thinking:_ ${p.text}`)
    case "file":
      return `**File:** \`${p.filename ?? p.url}\` (${p.mime})`
    case "agent":
      return `**Agent:** @${p.name}`
    case "subtask":
      return `**Subtask** (${p.agent}): ${p.description}\n\n${quote(p.prompt)}`
    case "tool":
      return tool(p)
    case "patch":
      return `**Changed files:** ${p.files.map((file) => `\`${file}\``).join(", ")}`
    case "retry":
      return `_Retry ${p.attempt}: ${p.error.data.message}_`
    case "compaction":
      return `_Context compacted${p.auto ? " automatically" : ""}._`
    // Bookkeeping for undo and token accounting, not part of the conversation.
    case "step-start":
    case "step-finish":
    case "snapshot":
      return ""
    default: {
      const unhandled: never = p
      return unhandled
    }
  }
}

function tool(p: SessionV1.ToolPart) {
  const title = `**Tool: ${p.tool}** (${p.state.status})`
  const input = fence(JSON.stringify(p.state.input, null, 2), "json")
  if (p.state.status === "completed") return `${title}: ${p.state.title}\n\n${input}\n\n${fence(p.state.output)}`
  if (p.state.status === "error") return `${title}\n\n${input}\n\n**Error:**\n\n${fence(p.state.error)}`
  return `${title}\n\n${input}`
}

function quote(text: string) {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
}

// The fence must be longer than any backtick run inside the text, or tool output
// containing ``` would close the block early.
function fence(text: string, lang = "") {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const ticks = "`".repeat(longest + 1)
  return `${ticks}${lang}\n${text}\n${ticks}`
}
