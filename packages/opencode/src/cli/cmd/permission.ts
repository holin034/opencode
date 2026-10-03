import type { Argv } from "yargs"
import { Effect } from "effect"
import { EOL } from "os"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Permission } from "@/permission"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

export const PermissionCommand = cmd({
  command: "permission",
  describe: "manage stored permission approvals",
  builder: (yargs: Argv) => yargs.command(PermissionListCommand).command(PermissionRemoveCommand).demandCommand(),
  async handler() {},
})

export const PermissionListCommand = effectCmd({
  command: "list",
  describe: 'list stored "always allow" approvals for the current project',
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.permission.list")(function* (args) {
    const items = yield* Permission.Service.use((svc) => svc.approvals())
    if (args.format === "json") {
      console.log(JSON.stringify(items, null, 2))
      return
    }
    if (items.length === 0) return
    console.log(formatTable(items))
  }),
})

export const PermissionRemoveCommand = effectCmd({
  command: "remove <id>",
  aliases: ["rm"],
  describe: 'remove a stored "always allow" approval so it is asked again',
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "approval ID to remove (see `permission list`)",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.permission.remove")(function* (args) {
    const svc = yield* Permission.Service
    const id = PermissionSaved.ID.make(args.id)
    const items = yield* svc.approvals()
    if (!items.some((item) => item.id === id)) return yield* fail(`Approval not found in this project: ${args.id}`)
    yield* svc.removeApprovals(id)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Approval ${args.id} removed` + UI.Style.TEXT_NORMAL)
  }),
})

function formatTable(items: ReadonlyArray<PermissionSaved.Info>): string {
  const idWidth = Math.max(2, ...items.map((item) => item.id.length))
  const actionWidth = Math.max(10, ...items.map((item) => item.action.length))
  const header = `${"ID".padEnd(idWidth)}  ${"Permission".padEnd(actionWidth)}  Pattern`
  const lines = [header, "─".repeat(header.length)]
  for (const item of items) {
    lines.push(`${item.id.padEnd(idWidth)}  ${item.action.padEnd(actionWidth)}  ${item.resource}`)
  }
  return lines.join(EOL)
}
