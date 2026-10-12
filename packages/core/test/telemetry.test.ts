import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Telemetry } from "../src/telemetry"

describe("telemetry and live trajectory engine", () => {
  it("tracks token usage, cache hit ratios, and estimated USD cost savings", async () => {
    const program = Effect.gen(function* () {
      const telemetry = yield* Telemetry.Service
      const s1 = SessionID.create()
      const s2 = SessionID.create()

      // Turn 1: Cache Miss
      yield* telemetry.recordUsage({
        sessionID: s1,
        promptTokens: 1000,
        completionTokens: 200,
        cachedTokens: 0,
      })

      // Turn 2: Cache Hit (500 cached out of 1000 prompt tokens)
      yield* telemetry.recordUsage({
        sessionID: s1,
        promptTokens: 1000,
        completionTokens: 150,
        cachedTokens: 500,
      })

      // Session 2: Cache Hit (800 cached out of 1000 prompt tokens)
      yield* telemetry.recordUsage({
        sessionID: s2,
        promptTokens: 1000,
        completionTokens: 300,
        cachedTokens: 800,
      })

      const snapshot = yield* telemetry.getSnapshot()
      return snapshot
    })

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(Telemetry.layer)))

    expect(snapshot.tokens.totalPromptTokens).toBe(3000)
    expect(snapshot.tokens.totalCompletionTokens).toBe(650)
    expect(snapshot.tokens.cacheSavingsTokens).toBe(1300) // 500 + 800
    expect(snapshot.cache.cacheHitCount).toBe(2)
    expect(snapshot.cache.cacheMissCount).toBe(1)
    expect(snapshot.cache.cacheHitRatio).toBeCloseTo(2 / 3, 2)
    expect(snapshot.cache.tokenCacheHitRatio).toBeCloseTo(1300 / 3000, 2)
    expect(snapshot.tokens.estimatedCostSavingsUSD).toBeGreaterThan(0)
  })

  it("records AST context compaction token savings into total tokens saved", async () => {
    const program = Effect.gen(function* () {
      const telemetry = yield* Telemetry.Service
      const s1 = SessionID.create()

      yield* telemetry.recordCompaction({
        sessionID: s1,
        tokensBefore: 25000,
        tokensAfter: 8000,
      })

      const snapshot = yield* telemetry.getSnapshot()
      return snapshot
    })

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(Telemetry.layer)))
    expect(snapshot.tokens.compactionSavingsTokens).toBe(17000) // 25000 - 8000
    expect(snapshot.tokens.totalTokensSaved).toBe(17000)
  })

  it("records dual-verifier trajectory rollbacks and stores audit records", async () => {
    const program = Effect.gen(function* () {
      const telemetry = yield* Telemetry.Service
      const s1 = SessionID.create()

      yield* telemetry.recordRollback({
        sessionID: s1,
        reason: "Test suite failed in git.test.ts",
        boundaryMessageID: "msg_checkpoint_abc",
        filesRestored: 3,
        durationMs: 42,
        success: true,
      })

      const snapshot = yield* telemetry.getSnapshot()
      return snapshot
    })

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(Telemetry.layer)))
    expect(snapshot.rollbacks.totalRollbacks).toBe(1)
    expect(snapshot.rollbacks.successfulRollbacks).toBe(1)
    expect(snapshot.rollbacks.failedRollbacks).toBe(0)
    expect(snapshot.rollbacks.recentRollbacks.length).toBe(1)
    expect(snapshot.rollbacks.recentRollbacks[0].reason).toBe("Test suite failed in git.test.ts")
    expect(snapshot.rollbacks.recentRollbacks[0].filesRestored).toBe(3)
  })

  it("tracks active sessions and renders live HTML trajectory dashboard", async () => {
    const program = Effect.gen(function* () {
      const telemetry = yield* Telemetry.Service
      const s1 = SessionID.create()

      yield* telemetry.updateSessionStatus({
        sessionID: s1,
        status: "running",
        title: "Fix auth controller",
        source: "github-webhook",
      })

      yield* telemetry.recordUsage({
        sessionID: s1,
        promptTokens: 2500,
        completionTokens: 400,
        cachedTokens: 1200,
      })

      const snapshot = yield* telemetry.getSnapshot()
      const html = telemetry.renderDashboardHtml(snapshot)
      return { snapshot, html }
    })

    const { snapshot, html } = await Effect.runPromise(program.pipe(Effect.provide(Telemetry.layer)))
    expect(snapshot.activeSessions.length).toBe(1)
    expect(snapshot.activeSessions[0].title).toBe("Fix auth controller")
    expect(snapshot.activeSessions[0].status).toBe("running")

    // Verify HTML Dashboard structure
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("OpenCode Live Trajectory & Telemetry Dashboard")
    expect(html).toContain("Tokens Saved")
    expect(html).toContain("Cache Hit Ratio")
    expect(html).toContain("Trajectory Rollbacks")
    expect(html).toContain("Fix auth controller")
  })
})
