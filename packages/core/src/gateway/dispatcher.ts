import { Context, Effect, Layer } from "effect"
import crypto from "node:crypto"
import { Gateway } from "@opencode-ai/schema/gateway"
import { SessionID } from "@opencode-ai/schema/session-id"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionV2 } from "../session"
import { SessionExecution } from "../session/execution"
import { AbsolutePath } from "../schema"
import { validateGitHubSignature } from "./signature"
import { parseGitHubWebhookEvent, type ParsedGitHubEvent } from "./parser"
import { makeGlobalNode } from "../effect/app-node"

export interface WebhookInput {
  readonly eventType: string
  readonly deliveryId: string
  readonly signature?: string
  readonly payload: any
  readonly rawBody: string | Buffer
  readonly secret?: string
}

export interface Interface {
  readonly handleWebhook: (input: WebhookInput) => Effect.Effect<Gateway.WebhookResponse>
  readonly getStatus: () => Effect.Effect<Gateway.GatewayStatus>
  readonly getDispatches: (limit?: number) => Effect.Effect<ReadonlyArray<Gateway.DispatchRecord>>
  readonly getDispatch: (jobId: string) => Effect.Effect<Gateway.DispatchRecord | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Gateway") {}

export const makeLayer = (defaultDirectory: string = process.cwd()) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const sessionService = yield* SessionV2.Service
      const executionService = yield* SessionExecution.Service

      const threadBindings = new Map<string, SessionID>()
      const dispatches = new Map<string, Gateway.DispatchRecord>()
      const dispatchHistory: string[] = []
      const MAX_HISTORY = 500

      let webhooksReceived = 0
      let totalDispatches = 0
      let lastDeliveryId: string | undefined
      let lastEventTime: number | undefined

      const recordDispatch = (record: Gateway.DispatchRecord) => {
        dispatches.set(record.jobId, record)
        dispatchHistory.unshift(record.jobId)
        if (dispatchHistory.length > MAX_HISTORY) {
          const removed = dispatchHistory.pop()
          if (removed) dispatches.delete(removed)
        }
      }

      const handleWebhook = (input: WebhookInput): Effect.Effect<Gateway.WebhookResponse> =>
        Effect.gen(function* () {
          webhooksReceived++
          lastDeliveryId = input.deliveryId
          lastEventTime = Date.now()

          // 1. Signature validation
          if (input.secret) {
            const sigCheck = validateGitHubSignature(input.secret, input.rawBody, input.signature)
            if (!sigCheck.valid) {
              const jobId = `job_${crypto.randomUUID()}`
              const rejected = new Gateway.DispatchRecord({
                jobId,
                status: "failed",
                repository: input.payload?.repository?.full_name ?? "unknown",
                targetType: "issue",
                action: input.payload?.action ?? "unknown",
                sender: input.payload?.sender?.login ?? "unknown",
                deliveryId: input.deliveryId,
                createdAt: Date.now(),
                summary: `Webhook signature rejected: ${sigCheck.reason ?? "invalid signature"}`,
                error: sigCheck.reason,
              })
              recordDispatch(rejected)

              return new Gateway.WebhookResponse({
                accepted: false,
                jobId,
                status: "failed",
                message: sigCheck.reason ?? "Webhook signature validation failed",
              })
            }
          }

          // 2. Parse and interpret GitHub event
          const parsed: ParsedGitHubEvent = parseGitHubWebhookEvent(
            input.eventType,
            input.deliveryId,
            input.payload,
          )

          const jobId = `job_${crypto.randomUUID()}`

          if (!parsed.shouldDispatch) {
            const ignoredRecord = new Gateway.DispatchRecord({
              jobId,
              status: parsed.eventType === "ping" ? "completed" : "ignored",
              repository: parsed.repository,
              targetType: parsed.targetType,
              targetNumber: parsed.targetNumber,
              action: parsed.action,
              sender: parsed.sender,
              deliveryId: input.deliveryId,
              createdAt: Date.now(),
              summary: parsed.reason ?? `Event ${parsed.eventType}.${parsed.action} ignored`,
            })
            recordDispatch(ignoredRecord)

            return new Gateway.WebhookResponse({
              accepted: true,
              jobId,
              status: parsed.eventType === "ping" ? "completed" : "ignored",
              message: parsed.reason ?? `Event ${parsed.eventType} acknowledged but not dispatched`,
            })
          }

          // 3. Resolve session thread continuity
          const threadKey = `${parsed.repository}#${parsed.targetType}#${parsed.targetNumber ?? 0}`
          let sessionID = threadBindings.get(threadKey)

          if (!sessionID) {
            // Create a new session for this thread
            const created = yield* sessionService.create({
              location: {
                directory: defaultDirectory as AbsolutePath,
              },
            })
            sessionID = created.id
            threadBindings.set(threadKey, sessionID)
          }

          // 4. Admit prompt and wake runner
          totalDispatches++
          const promptInput: PromptInput.Prompt = {
            text: parsed.promptText ?? `GitHub event ${parsed.eventType} received for ${parsed.repository}`,
          }

          const promptResult = yield* sessionService
            .prompt({
              sessionID,
              prompt: promptInput,
              resume: true,
            })
            .pipe(
              Effect.catch((err: any) =>
                Effect.succeed({
                  error: String(err?._tag ?? err?.message ?? "unknown_error"),
                }),
              ),
            )

          if ("error" in promptResult) {
            const failedRecord = new Gateway.DispatchRecord({
              jobId,
              sessionID,
              status: "failed",
              repository: parsed.repository,
              targetType: parsed.targetType,
              targetNumber: parsed.targetNumber,
              action: parsed.action,
              sender: parsed.sender,
              deliveryId: input.deliveryId,
              createdAt: Date.now(),
              summary: `Failed to admit prompt to session ${sessionID}: ${promptResult.error}`,
              error: promptResult.error,
            })
            recordDispatch(failedRecord)

            return new Gateway.WebhookResponse({
              accepted: false,
              jobId,
              sessionID,
              status: "failed",
              message: `Failed to admit prompt: ${promptResult.error}`,
            })
          }

          yield* executionService.wake(sessionID)

          const dispatchedRecord = new Gateway.DispatchRecord({
            jobId,
            sessionID,
            status: "dispatched",
            repository: parsed.repository,
            targetType: parsed.targetType,
            targetNumber: parsed.targetNumber,
            action: parsed.action,
            sender: parsed.sender,
            deliveryId: input.deliveryId,
            createdAt: Date.now(),
            summary: `Dispatched ${parsed.targetType} #${parsed.targetNumber ?? ""} to session ${sessionID}`,
          })
          recordDispatch(dispatchedRecord)

          return new Gateway.WebhookResponse({
            accepted: true,
            jobId,
            sessionID,
            status: "dispatched",
            message: `Successfully dispatched to OpenCode session ${sessionID}`,
          })
        })

      const getStatus = (): Effect.Effect<Gateway.GatewayStatus> =>
        Effect.sync(() => {
          let dispatchesActive = 0
          for (const item of dispatches.values()) {
            if (item.status === "dispatched" || item.status === "running") dispatchesActive++
          }

          return new Gateway.GatewayStatus({
            enabled: true,
            webhooksReceived,
            dispatchesActive,
            totalDispatches,
            lastDeliveryId,
            lastEventTime,
          })
        })

      const getDispatches = (limit: number = 50): Effect.Effect<ReadonlyArray<Gateway.DispatchRecord>> =>
        Effect.sync(() => {
          const result: Gateway.DispatchRecord[] = []
          for (let i = 0; i < Math.min(limit, dispatchHistory.length); i++) {
            const id = dispatchHistory[i]
            const record = dispatches.get(id)
            if (record) result.push(record)
          }
          return result
        })

      const getDispatch = (jobId: string): Effect.Effect<Gateway.DispatchRecord | undefined> =>
        Effect.sync(() => dispatches.get(jobId))

      return Service.of({
        handleWebhook,
        getStatus,
        getDispatches,
        getDispatch,
      })
    }),
  )

export const layer = makeLayer()
export const node = makeGlobalNode({ service: Service, layer, deps: [SessionV2.node, SessionExecution.node] })
