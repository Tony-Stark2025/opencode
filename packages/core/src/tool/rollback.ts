export * as RollbackTool from "./rollback"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { SessionRevert } from "../session/revert"
import { SessionStore } from "../session/store"
import { SessionMessage } from "../session/message"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Snapshot } from "../snapshot"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "rollback"

export const Input = Schema.Struct({
  reason: Schema.String.annotate({
    description: "Explanation of why the current trajectory is being abandoned (e.g. test failure or broken build)",
  }),
  messageID: Schema.optional(
    Schema.String.annotate({
      description: "Optional assistant message ID to roll back to. If omitted, rolls back to the latest pre-mutation checkpoint.",
    }),
  ),
})

export const Output = Schema.Struct({
  status: Schema.String,
  reason: Schema.String,
  boundaryMessageID: Schema.String,
  restored: Schema.Boolean,
  guidance: Schema.String,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  `[Trajectory Rollback Succeeded]\n` +
  `Boundary: ${output.boundaryMessageID}\n` +
  `Reason: ${output.reason}\n` +
  `Guidance: ${output.guidance}`

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const store = yield* SessionStore.Service
    const permission = yield* PermissionV2.Service
    const db = yield* Database.Service
    const events = yield* EventV2.Service
    const snapshot = yield* Snapshot.Service


    const execute = (
      input: typeof Input.Type,
      context: Tool.Context,
    ): Effect.Effect<Output, ToolFailure> =>
      Effect.gen(function* () {
        yield* permission.assert({
          action: name,
          resources: ["*"],
          save: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
        })

        const session = yield* store.get(context.sessionID)
        if (!session) {
          return yield* new ToolFailure({ message: `Session not found: ${context.sessionID}` })
        }

        let targetMessageID: SessionMessage.ID | undefined
        if (input.messageID) {
          targetMessageID = SessionMessage.ID.make(input.messageID)
        } else {
          const history = yield* store.context(context.sessionID).pipe(Effect.orDie)
          const assistantsWithSnapshot = history.filter(
            (m): m is SessionMessage.Assistant =>
              m.type === "assistant" &&
              m.id !== context.assistantMessageID &&
              m.snapshot?.start !== undefined,
          )
          const target = assistantsWithSnapshot.at(-1)
          if (target) {
            targetMessageID = target.id
          }
        }

        if (!targetMessageID) {
          return yield* new ToolFailure({
            message: "No earlier checkpoint with snapshot history found to roll back to.",
          })
        }

        yield* SessionRevert.rollbackToCheckpoint({
          session,
          boundaryMessageID: targetMessageID,
        }).pipe(
          Effect.provideService(Database.Service, db),
          Effect.provideService(EventV2.Service, events),
          Effect.provideService(Snapshot.Service, snapshot),
          Effect.mapError(
            (err) => new ToolFailure({ message: `Rollback failed: ${String(err)}` }),
          ),
        )

        return {
          status: "success",
          reason: input.reason,
          boundaryMessageID: targetMessageID,
          restored: true,
          guidance:
            "Files have been restored to the stable checkpoint and failed messages pruned. Re-evaluate your strategy and proceed with an alternate implementation.",
        } satisfies Output
      }).pipe(
        Effect.mapError(
          (err) => (err instanceof ToolFailure ? err : new ToolFailure({ message: err instanceof Error ? err.message : String(err) })),
        ),
      )

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Roll back the codebase and transcript to a previous stable checkpoint. Use this when a tool edit, refactor, or test suite run fails and you want to clean up dirty state and try an alternative approach instead of compounding errors.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute,
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/rollback",
  layer,
  deps: [ToolRegistry.node, SessionStore.node, PermissionV2.node, Database.node, EventV2.node, Snapshot.node],
})


