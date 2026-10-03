import { Session } from "@/session/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { renderMarkdown } from "./markdown"

export type SessionExportData = { info: Session.Info; messages: SessionV1.WithParts[] }
export type Renderer = (data: SessionExportData) => string

export const renderJson: Renderer = (data) => JSON.stringify(data, null, 2)

// Each output format is one entry. Renderers receive data that has already been
// sanitized when --sanitize is set, so they must not do any redaction themselves.
export const FORMATS = {
  json: renderJson,
  md: renderMarkdown,
} satisfies Record<string, Renderer>

export type Format = keyof typeof FORMATS

export function isFormat(value: string): value is Format {
  return Object.hasOwn(FORMATS, value)
}
