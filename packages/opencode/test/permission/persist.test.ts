import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer, type Scope } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Permission } from "../../src/permission"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { SessionID } from "../../src/session/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// These tests exercise "always allow" persistence. Every `boot` builds a brand new
// service graph (fresh Permission/InstanceStore state, nothing cached in memory) on top
// of the same on-disk sqlite file, which is what an opencode restart looks like.

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(AppNodeBuilder.build(LayerNode.group([CrossSpawnSpawner.node])))

const env = (dbFile: string) =>
  AppNodeBuilder.build(
    LayerNode.group([Permission.node, PermissionSaved.node, EventV2Bridge.node, InstanceStore.node]),
    [
      [InstanceStore.bootstrapNode, noopBootstrap],
      [Database.node, Database.layerFromPath(dbFile)],
    ],
  )

/** Run `program` against a freshly started opencode that uses the database at `dbFile`. */
const boot = <A, E>(
  dbFile: string,
  program: Effect.Effect<A, E, Permission.Service | PermissionSaved.Service | InstanceStore.Service | any>,
) => program.pipe(Effect.scoped, Effect.provide(env(dbFile))) as Effect.Effect<A, E>

/** Run `program` inside the project rooted at `directory`. */
const inProject = <A, E, R>(directory: string, program: Effect.Effect<A, E, R>) =>
  InstanceStore.Service.use((store) => store.provide({ directory }, program))

const setup = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  const a = yield* tmpdirScoped({ git: true })
  const b = yield* tmpdirScoped({ git: true })
  return { db: path.join(root, "opencode.db"), a, b }
})

const session = SessionID.make("session_persist")

const request = (input: {
  id?: string
  permission?: string
  patterns?: string[]
  always?: string[]
  ruleset?: PermissionV1.Ruleset
}) =>
  Permission.Service.use((svc) =>
    svc.ask({
      id: input.id ? PermissionV1.ID.make(input.id) : undefined,
      sessionID: session,
      permission: input.permission ?? "bash",
      patterns: input.patterns ?? ["ls"],
      metadata: {},
      always: input.always ?? ["ls"],
      ruleset: input.ruleset ?? [],
    }),
  )

const pending = Permission.Service.use((svc) => svc.list())

const waitForPending = Effect.gen(function* () {
  while (true) {
    const items = yield* pending
    if (items.length > 0) return items
    yield* Effect.sleep("10 millis")
  }
}).pipe(
  Effect.timeoutOrElse({
    duration: "5 seconds",
    orElse: () => Effect.fail(new Error("timed out waiting for a pending permission request")),
  }),
)

/** Ask, answer with `reply`, and wait for the ask to settle. */
const askAndReply = (
  reply: "once" | "always",
  input: Parameters<typeof request>[0] = {},
  id = "per_persist_" + Math.random().toString(36).slice(2),
) =>
  Effect.gen(function* () {
    const fiber = yield* request({ ...input, id }).pipe(Effect.forkScoped)
    yield* waitForPending
    yield* Permission.Service.use((svc) => svc.reply({ requestID: PermissionV1.ID.make(id), reply }))
    yield* Fiber.join(fiber)
  })

/** Ask and expect the request to be prompted for (stay pending). Rejects it afterwards. */
const expectPrompt = (input: Parameters<typeof request>[0] = {}) =>
  Effect.gen(function* () {
    const fiber = yield* request(input).pipe(Effect.forkScoped)
    const items = yield* waitForPending
    expect(items).toHaveLength(1)
    yield* Permission.Service.use((svc) => svc.reply({ requestID: items[0].id, reply: "reject" }))
    yield* Fiber.await(fiber)
  })

/** Ask and expect it to be allowed without any prompt. */
const expectNoPrompt = (input: Parameters<typeof request>[0] = {}) =>
  Effect.gen(function* () {
    // A prompted request never settles by itself, so bound the wait instead of hanging the test.
    const result = yield* request(input).pipe(
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () => Effect.fail(new Error("expected no prompt, but the request is still pending")),
      }),
    )
    expect(result).toBeUndefined()
    expect(yield* pending).toHaveLength(0)
  })

const failure = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(self)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected effect to fail")
  })

const approvals = Permission.Service.use((svc) => svc.approvals())

it.live("first run with nothing stored prompts exactly as before", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          expect(yield* approvals).toEqual([])
          yield* expectPrompt()
        }),
      ),
    )
  }),
)

it.live("always allow survives a restart and no longer prompts", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(db, inProject(a, askAndReply("always")))
    yield* boot(db, inProject(a, expectNoPrompt()))
  }),
)

it.live("always allow is scoped to the project it was granted in", () =>
  Effect.gen(function* () {
    const { db, a, b } = yield* setup
    yield* boot(db, inProject(a, askAndReply("always")))
    yield* boot(
      db,
      Effect.gen(function* () {
        yield* inProject(a, expectNoPrompt())
        yield* inProject(b, expectPrompt())
      }),
    )
  }),
)

it.live("a once approval does not persist across a restart", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          yield* askAndReply("once")
          expect(yield* approvals).toEqual([])
        }),
      ),
    )
    yield* boot(db, inProject(a, expectPrompt()))
  }),
)

it.live("always allow persists for non-shell permissions too", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(a, askAndReply("always", { permission: "edit", patterns: ["src/a.ts"], always: ["src/*"] })),
    )
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          yield* expectNoPrompt({ permission: "edit", patterns: ["src/b.ts"], always: [] })
          // the stored rule is for edit only, so a different permission still prompts
          yield* expectPrompt({ permission: "bash", patterns: ["src/b.ts"] })
        }),
      ),
    )
  }),
)

it.live("stored patterns are matched as wildcards and every pattern must be covered", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(db, inProject(a, askAndReply("always", { patterns: ["git status"], always: ["git *"] })))
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          yield* expectNoPrompt({ patterns: ["git log", "git diff"], always: [] })
          yield* expectPrompt({ patterns: ["git log", "rm -rf x"], always: [] })
        }),
      ),
    )
  }),
)

it.live("a configured deny beats a stored allow after a restart", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(db, inProject(a, askAndReply("always", { patterns: ["rm x"], always: ["rm *"] })))
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          const err = yield* failure(
            request({
              patterns: ["rm x"],
              always: [],
              ruleset: Permission.fromConfig({ bash: { "rm *": "deny" } }),
            }),
          )
          expect(err).toBeInstanceOf(PermissionV1.DeniedError)
          expect(yield* pending).toHaveLength(0)
          // without the config deny the stored allow still applies
          yield* expectNoPrompt({ patterns: ["rm x"], always: [] })
        }),
      ),
    )
  }),
)

it.live("a configured deny beats a stored allow within the same run", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          yield* askAndReply("always", { patterns: ["rm x"], always: ["rm *"] })
          const err = yield* failure(
            request({
              patterns: ["rm x"],
              always: [],
              ruleset: [{ permission: "bash", pattern: "rm *", action: "deny" }],
            }),
          )
          expect(err).toBeInstanceOf(PermissionV1.DeniedError)
        }),
      ),
    )
  }),
)

it.live("a configured allow still resolves without consulting or requiring stored approvals", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(db, inProject(a, expectNoPrompt({ ruleset: Permission.fromConfig({ bash: "allow" }), always: [] })))
  }),
)

it.live("removing a stored approval makes the command prompt again after a restart", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(db, inProject(a, askAndReply("always")))
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          const stored = yield* approvals
          expect(stored).toHaveLength(1)
          expect(stored[0]).toMatchObject({ action: "bash", resource: "ls" })
          yield* Permission.Service.use((svc) => svc.removeApprovals(stored[0].id))
          expect(yield* approvals).toEqual([])
        }),
      ),
    )
    yield* boot(db, inProject(a, expectPrompt()))
  }),
)

it.live("approvals only lists the current project and remove only affects the chosen rule", () =>
  Effect.gen(function* () {
    const { db, a, b } = yield* setup
    yield* boot(
      db,
      Effect.gen(function* () {
        yield* inProject(a, askAndReply("always", { patterns: ["ls"], always: ["ls", "pwd"] }))
        yield* inProject(b, askAndReply("always", { patterns: ["cat"], always: ["cat"] }))

        const forA = yield* inProject(a, approvals)
        const forB = yield* inProject(b, approvals)
        expect(forA.map((item) => item.resource).sort()).toEqual(["ls", "pwd"])
        expect(forB.map((item) => item.resource)).toEqual(["cat"])

        yield* inProject(
          a,
          Permission.Service.use((svc) => svc.removeApprovals(forA.find((i) => i.resource === "ls")!.id)),
        )
        expect((yield* inProject(a, approvals)).map((item) => item.resource)).toEqual(["pwd"])
        expect((yield* inProject(b, approvals)).map((item) => item.resource)).toEqual(["cat"])

        // removing another project's approval from project a is a no-op
        yield* inProject(
          a,
          Permission.Service.use((svc) => svc.removeApprovals(forB[0].id)),
        )
        expect((yield* inProject(b, approvals)).map((item) => item.resource)).toEqual(["cat"])
      }),
    )
  }),
)

it.live("approving the same command with always twice does not duplicate the stored rule", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          yield* askAndReply("always", { patterns: ["ls"], always: ["ls"] })
          // a different command that is not covered by the stored rule, but whose always-pattern is the same
          yield* askAndReply("always", { patterns: ["ls -la"], always: ["ls"] })
          expect(yield* approvals).toHaveLength(1)
        }),
      ),
    )
  }),
)

it.live("a stored rule for a permission that no longer exists does not break startup or other asks", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        askAndReply("always", { permission: "legacy_tool_that_was_removed", patterns: ["x"], always: ["x"] }),
      ),
    )
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          expect(yield* approvals).toHaveLength(1)
          yield* expectPrompt()
        }),
      ),
    )
  }),
)

it.live("always resolves other pending requests in the same session through the stored rules", () =>
  Effect.gen(function* () {
    const { db, a } = yield* setup
    yield* boot(
      db,
      inProject(
        a,
        Effect.gen(function* () {
          const first = yield* request({ id: "per_persist_first", patterns: ["ls"], always: ["ls"] }).pipe(
            Effect.forkScoped,
          )
          const second = yield* request({ id: "per_persist_second", patterns: ["ls"], always: [] }).pipe(
            Effect.forkScoped,
          )
          while ((yield* pending).length < 2) yield* Effect.sleep("10 millis")
          yield* Permission.Service.use((svc) =>
            svc.reply({ requestID: PermissionV1.ID.make("per_persist_first"), reply: "always" }),
          )
          yield* Fiber.join(first)
          yield* Fiber.join(second)
          expect(yield* pending).toHaveLength(0)
        }),
      ),
    )
  }),
)
