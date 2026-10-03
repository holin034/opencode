import { Session } from "@/session/session"
import { MessageV2 } from "../../../session/message-v2"
import { SessionID } from "../../../session/schema"
import { effectCmd, fail } from "../../effect-cmd"
import { UI } from "../../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"
import { sanitize } from "./sanitize"
import { FORMATS, isFormat } from "./render"

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "export session data as JSON or Markdown",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session id to export",
        type: "string",
      })
      .option("sanitize", {
        describe: "redact sensitive transcript and file data",
        type: "boolean",
      })
      .option("format", {
        describe: `output format (${Object.keys(FORMATS).join(", ")})`,
        type: "string",
        default: "json",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: { sessionID?: string; sanitize?: boolean; format: string }) {
  // Checked before the session picker and outside the catch-all below, which would
  // otherwise report this as "Session not found".
  const format = args.format
  if (!isFormat(format))
    return yield* fail(`Invalid format "${format}". Valid formats: ${Object.keys(FORMATS).join(", ")}`)

  const svc = yield* Session.Service
  let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined
  process.stderr.write(`Exporting session: ${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    prompts.intro("Export session", { output: process.stderr })

    const sessions = yield* svc.list()

    if (sessions.length === 0) {
      prompts.log.error("No sessions found", { output: process.stderr })
      prompts.outro("Done", { output: process.stderr })
      return
    }

    sessions.sort((a, b) => b.time.updated - a.time.updated)

    const selectedSession = yield* Effect.promise(() =>
      prompts.autocomplete({
        message: "Select session to export",
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )

    if (prompts.isCancel(selectedSession)) {
      return yield* Effect.die(new UI.CancelledError())
    }

    sessionID = selectedSession

    prompts.outro("Exporting session...", { output: process.stderr })
  }

  // Match legacy try/catch — catches both typed failures and defects
  // (Session.Service.get throws NotFoundError as a defect, not a typed E).
  return yield* Effect.gen(function* () {
    const sessionInfo = yield* svc.get(sessionID!)
    const messages = yield* svc.messages({ sessionID: sessionInfo.id })

    const exportData = { info: sessionInfo, messages }

    process.stdout.write(FORMATS[format](args.sanitize ? sanitize(exportData) : exportData))
    process.stdout.write(EOL)
  }).pipe(Effect.catchCause(() => fail(`Session not found: ${sessionID!}`)))
})
