import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Gateway } from "../src/gateway"
import { Telemetry } from "../src/telemetry"
import { SessionV2 } from "../src/session"
import { SessionExecution } from "../src/session/execution"
import { generateGitHubSignature } from "../src/gateway/signature"

describe("gateway dispatcher", () => {
  const secret = "super_secret_webhook_key"

  // Mock Session & Execution services
  const createdSessions: Array<{ id: SessionID; location: any }> = []
  const admittedPrompts: Array<{ sessionID: SessionID; prompt: any }> = []
  const awakenedSessions: SessionID[] = []

  let nextSessionNum = 1

  const mockSessionService = Layer.succeed(
    SessionV2.Service,
    SessionV2.Service.of({
      create: (input) =>
        Effect.sync(() => {
          const id = SessionID.make(`ses_mock_${nextSessionNum++}`)
          createdSessions.push({ id, location: input.location })
          return { id } as any
        }),
      prompt: (input) =>
        Effect.sync(() => {
          admittedPrompts.push({ sessionID: input.sessionID, prompt: input.prompt })
          return {} as any
        }),
      list: () => Effect.succeed([]),
      get: () => Effect.die("not implemented"),
      messages: () => Effect.succeed([]),
      message: () => Effect.succeed(undefined),
      context: () => Effect.succeed([]),
      events: () => Effect.die("not implemented") as any,
      history: () => Effect.succeed({ events: [], hasMore: false }),
      switchAgent: () => Effect.void,
      switchModel: () => Effect.void,
      shell: () => Effect.void,
      skill: () => Effect.void,
      compact: () => Effect.void,
      wait: () => Effect.void,
      active: Effect.succeed(new Set()),
      resume: () => Effect.void,
      interrupt: () => Effect.void,
      revert: {} as any,
    }),
  )

  const mockExecutionService = Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      resume: () => Effect.void,
      wake: (sessionID) =>
        Effect.sync(() => {
          awakenedSessions.push(sessionID)
        }),
      interrupt: () => Effect.void,
    }),
  )

  const testLayer = Layer.merge(
    Gateway.makeLayer().pipe(
      Layer.provide(mockSessionService),
      Layer.provide(mockExecutionService),
      Layer.provide(Telemetry.layer),
    ),
    Telemetry.layer,
  )

  it("rejects webhook if signature validation fails", async () => {
    const program = Effect.gen(function* () {
      const gateway = yield* Gateway.Service
      const payload = {
        action: "opened",
        repository: { full_name: "acme/corp" },
        issue: { number: 1, title: "Test issue" },
      }
      const rawBody = JSON.stringify(payload)
      const res = yield* gateway.handleWebhook({
        eventType: "issues",
        deliveryId: "del_bad_sig",
        signature: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
        payload,
        rawBody,
        secret,
      })
      const status = yield* gateway.getStatus()
      return { res, status }
    })

    const { res, status } = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    expect(res.accepted).toBe(false)
    expect(res.status).toBe("failed")
    expect(res.message).toContain("Signature mismatch")
    expect(status.webhooksReceived).toBe(1)
  })

  it("accepts and dispatches valid PR webhook to session runner", async () => {
    const program = Effect.gen(function* () {
      const gateway = yield* Gateway.Service
      const payload = {
        action: "opened",
        repository: { full_name: "acme/corp" },
        pull_request: {
          number: 10,
          title: "New feature",
          user: { login: "alice" },
          head: { ref: "feature-branch" },
          base: { ref: "dev" },
        },
      }
      const rawBody = JSON.stringify(payload)
      const signature = generateGitHubSignature(secret, rawBody)

      const res = yield* gateway.handleWebhook({
        eventType: "pull_request",
        deliveryId: "del_pr_10",
        signature,
        payload,
        rawBody,
        secret,
      })

      const dispatches = yield* gateway.getDispatches()
      return { res, dispatches }
    })

    const { res, dispatches } = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    expect(res.accepted).toBe(true)
    expect(res.status).toBe("dispatched")
    expect(res.sessionID).toBeDefined()
    expect(admittedPrompts.length).toBe(1)
    expect(awakenedSessions.length).toBe(1)
    expect(dispatches.length).toBeGreaterThan(0)
    expect(dispatches[0].repository).toBe("acme/corp")
    expect(dispatches[0].targetNumber).toBe(10)
  })

  it("reuses existing session for comments in the same PR/issue thread", async () => {
    const program = Effect.gen(function* () {
      const gateway = yield* Gateway.Service

      // Comment 1 on PR #10
      const payload1 = {
        action: "created",
        repository: { full_name: "acme/corp" },
        issue: { number: 10, title: "New feature", pull_request: {} },
        comment: { id: 101, body: "/opencode run the test suite" },
      }
      const raw1 = JSON.stringify(payload1)
      const res1 = yield* gateway.handleWebhook({
        eventType: "issue_comment",
        deliveryId: "del_comment_1",
        signature: generateGitHubSignature(secret, raw1),
        payload: payload1,
        rawBody: raw1,
        secret,
      })

      // Comment 2 on the same PR #10
      const payload2 = {
        action: "created",
        repository: { full_name: "acme/corp" },
        issue: { number: 10, title: "New feature", pull_request: {} },
        comment: { id: 102, body: "/opencode apply fixes for lint errors" },
      }
      const raw2 = JSON.stringify(payload2)
      const res2 = yield* gateway.handleWebhook({
        eventType: "issue_comment",
        deliveryId: "del_comment_2",
        signature: generateGitHubSignature(secret, raw2),
        payload: payload2,
        rawBody: raw2,
        secret,
      })

      return { res1, res2 }
    })

    const { res1, res2 } = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    expect(res1.sessionID).toBeDefined()
    expect(res2.sessionID).toBeDefined()
    // Thread continuity: both comments target the exact same session!
    expect(res1.sessionID).toBe(res2.sessionID)
  })

  it("updates session trajectory status in Telemetry upon webhook dispatch", async () => {
    const program = Effect.gen(function* () {
      const gateway = yield* Gateway.Service
      const telemetry = yield* Telemetry.Service

      const payload = {
        action: "opened",
        repository: { full_name: "acme/corp" },
        pull_request: {
          number: 55,
          title: "Optimize KV-cache eviction",
          user: { login: "alice" },
        },
      }
      const rawBody = JSON.stringify(payload)
      const res = yield* gateway.handleWebhook({
        eventType: "pull_request",
        deliveryId: "del_pr_55",
        signature: generateGitHubSignature(secret, rawBody),
        payload,
        rawBody,
        secret,
      })

      const snapshot = yield* telemetry.getSnapshot()
      return { res, snapshot }
    })

    const { res, snapshot } = await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
    expect(res.accepted).toBe(true)
    expect(snapshot.activeSessions.length).toBeGreaterThan(0)
    const tracked = snapshot.activeSessions.find((s) => s.sessionID === res.sessionID)
    expect(tracked).toBeDefined()
    expect(tracked?.status).toBe("running")
    expect(tracked?.source).toBe("github:pull_request")
    expect(tracked?.title).toContain("acme/corp #55")
  })
})
