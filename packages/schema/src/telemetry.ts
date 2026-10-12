import { Schema } from "effect"
import { SessionID } from "./session-id"

export namespace Telemetry {
  export class TokenSavingsMetrics extends Schema.Class<TokenSavingsMetrics>("Telemetry.TokenSavingsMetrics")({
    cacheSavingsTokens: Schema.Number,
    compactionSavingsTokens: Schema.Number,
    totalTokensSaved: Schema.Number,
    totalPromptTokens: Schema.Number,
    totalCompletionTokens: Schema.Number,
    estimatedCostSavingsUSD: Schema.Number,
  }) {}

  export class CacheEfficiencyMetrics extends Schema.Class<CacheEfficiencyMetrics>("Telemetry.CacheEfficiencyMetrics")({
    cacheHitCount: Schema.Number,
    cacheMissCount: Schema.Number,
    cacheHitRatio: Schema.Number,
    tokenCacheHitRatio: Schema.Number,
    totalCachedPromptTokens: Schema.Number,
    totalUncachedPromptTokens: Schema.Number,
  }) {}

  export class RollbackRecord extends Schema.Class<RollbackRecord>("Telemetry.RollbackRecord")({
    sessionID: SessionID,
    timestamp: Schema.Number,
    reason: Schema.String,
    boundaryMessageID: Schema.String,
    filesRestored: Schema.Number,
    durationMs: Schema.Number,
    success: Schema.Boolean,
  }) {}

  export class RollbackMetrics extends Schema.Class<RollbackMetrics>("Telemetry.RollbackMetrics")({
    totalRollbacks: Schema.Number,
    successfulRollbacks: Schema.Number,
    failedRollbacks: Schema.Number,
    recentRollbacks: Schema.Array(RollbackRecord),
  }) {}

  export const SessionTrajectoryStatus = Schema.Literals(["idle", "running", "compacting", "rolling_back", "completed", "error"])
  export type SessionTrajectoryStatus = typeof SessionTrajectoryStatus.Type

  export class ActiveSessionInfo extends Schema.Class<ActiveSessionInfo>("Telemetry.ActiveSessionInfo")({
    sessionID: SessionID,
    status: SessionTrajectoryStatus,
    startTime: Schema.Number,
    lastActivityTime: Schema.Number,
    durationSeconds: Schema.Number,
    turnCount: Schema.Number,
    promptTokens: Schema.Number,
    completionTokens: Schema.Number,
    cachedTokens: Schema.Number,
    savedTokens: Schema.Number,
    rollbackCount: Schema.Number,
    title: Schema.optional(Schema.String),
    source: Schema.optional(Schema.String),
  }) {}

  export class TelemetrySnapshot extends Schema.Class<TelemetrySnapshot>("Telemetry.TelemetrySnapshot")({
    timestamp: Schema.Number,
    tokens: TokenSavingsMetrics,
    cache: CacheEfficiencyMetrics,
    rollbacks: RollbackMetrics,
    activeSessions: Schema.Array(ActiveSessionInfo),
    totalSessionsTracked: Schema.Number,
  }) {}
}
