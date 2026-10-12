import { Context, Effect, Layer } from "effect"
import { Telemetry } from "@opencode-ai/schema/telemetry"
import { SessionID } from "@opencode-ai/schema/session-id"
import { makeGlobalNode } from "../effect/app-node"

export interface Interface {
  readonly recordUsage: (input: {
    readonly sessionID: SessionID
    readonly promptTokens: number
    readonly completionTokens: number
    readonly cachedTokens: number
  }) => Effect.Effect<void>
  readonly recordCompaction: (input: {
    readonly sessionID: SessionID
    readonly tokensBefore: number
    readonly tokensAfter: number
  }) => Effect.Effect<void>
  readonly recordRollback: (input: {
    readonly sessionID: SessionID
    readonly reason: string
    readonly boundaryMessageID: string
    readonly filesRestored: number
    readonly durationMs: number
    readonly success: boolean
  }) => Effect.Effect<void>
  readonly updateSessionStatus: (input: {
    readonly sessionID: SessionID
    readonly status: Telemetry.SessionTrajectoryStatus
    readonly title?: string
    readonly source?: string
  }) => Effect.Effect<void>
  readonly endSession: (sessionID: SessionID, error?: boolean) => Effect.Effect<void>
  readonly getSnapshot: () => Effect.Effect<Telemetry.TelemetrySnapshot>
  readonly getSessionTrajectory: (sessionID: SessionID) => Effect.Effect<Telemetry.ActiveSessionInfo | undefined>
  readonly renderDashboardHtml: (snapshot: Telemetry.TelemetrySnapshot) => string
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Telemetry") {}

interface InternalSessionState {
  sessionID: SessionID
  status: Telemetry.SessionTrajectoryStatus
  startTime: number
  lastActivityTime: number
  turnCount: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  savedTokens: number
  rollbackCount: number
  title?: string
  source?: string
}

export const makeLayer = () =>
  Layer.effect(
    Service,
    Effect.sync(() => {
      let cacheSavingsTokens = 0
      let compactionSavingsTokens = 0
      let totalPromptTokens = 0
      let totalCompletionTokens = 0
      let totalCachedPromptTokens = 0
      let totalUncachedPromptTokens = 0
      let cacheHitCount = 0
      let cacheMissCount = 0

      let totalRollbacks = 0
      let successfulRollbacks = 0
      let failedRollbacks = 0
      const recentRollbacks: Telemetry.RollbackRecord[] = []
      const MAX_ROLLBACK_HISTORY = 100

      const sessions = new Map<string, InternalSessionState>()
      let totalSessionsTracked = 0

      const getOrCreateSession = (sessionID: SessionID): InternalSessionState => {
        let existing = sessions.get(sessionID)
        if (!existing) {
          totalSessionsTracked++
          existing = {
            sessionID,
            status: "running",
            startTime: Date.now(),
            lastActivityTime: Date.now(),
            turnCount: 0,
            promptTokens: 0,
            completionTokens: 0,
            cachedTokens: 0,
            savedTokens: 0,
            rollbackCount: 0,
          }
          sessions.set(sessionID, existing)
        }
        return existing
      }

      const recordUsage = (input: {
        readonly sessionID: SessionID
        readonly promptTokens: number
        readonly completionTokens: number
        readonly cachedTokens: number
      }): Effect.Effect<void> =>
        Effect.sync(() => {
          const session = getOrCreateSession(input.sessionID)
          session.lastActivityTime = Date.now()
          session.turnCount++
          session.promptTokens += input.promptTokens
          session.completionTokens += input.completionTokens
          session.cachedTokens += input.cachedTokens

          totalPromptTokens += input.promptTokens
          totalCompletionTokens += input.completionTokens

          if (input.cachedTokens > 0) {
            cacheHitCount++
            totalCachedPromptTokens += input.cachedTokens
            cacheSavingsTokens += input.cachedTokens
            session.savedTokens += input.cachedTokens
          } else {
            cacheMissCount++
          }

          const uncached = Math.max(0, input.promptTokens - input.cachedTokens)
          totalUncachedPromptTokens += uncached
        })

      const recordCompaction = (input: {
        readonly sessionID: SessionID
        readonly tokensBefore: number
        readonly tokensAfter: number
      }): Effect.Effect<void> =>
        Effect.sync(() => {
          const session = getOrCreateSession(input.sessionID)
          session.lastActivityTime = Date.now()
          const saved = Math.max(0, input.tokensBefore - input.tokensAfter)
          compactionSavingsTokens += saved
          session.savedTokens += saved
        })

      const recordRollback = (input: {
        readonly sessionID: SessionID
        readonly reason: string
        readonly boundaryMessageID: string
        readonly filesRestored: number
        readonly durationMs: number
        readonly success: boolean
      }): Effect.Effect<void> =>
        Effect.sync(() => {
          const session = getOrCreateSession(input.sessionID)
          session.lastActivityTime = Date.now()
          session.rollbackCount++
          session.status = input.success ? "idle" : "error"

          totalRollbacks++
          if (input.success) {
            successfulRollbacks++
          } else {
            failedRollbacks++
          }

          const record = new Telemetry.RollbackRecord({
            sessionID: input.sessionID,
            timestamp: Date.now(),
            reason: input.reason,
            boundaryMessageID: input.boundaryMessageID,
            filesRestored: input.filesRestored,
            durationMs: input.durationMs,
            success: input.success,
          })

          recentRollbacks.unshift(record)
          if (recentRollbacks.length > MAX_ROLLBACK_HISTORY) {
            recentRollbacks.pop()
          }
        })

      const updateSessionStatus = (input: {
        readonly sessionID: SessionID
        readonly status: Telemetry.SessionTrajectoryStatus
        readonly title?: string
        readonly source?: string
      }): Effect.Effect<void> =>
        Effect.sync(() => {
          const session = getOrCreateSession(input.sessionID)
          session.status = input.status
          session.lastActivityTime = Date.now()
          if (input.title) session.title = input.title
          if (input.source) session.source = input.source
        })

      const endSession = (sessionID: SessionID, error?: boolean): Effect.Effect<void> =>
        Effect.sync(() => {
          const session = sessions.get(sessionID)
          if (session) {
            session.status = error ? "error" : "completed"
            session.lastActivityTime = Date.now()
          }
        })

      const getSnapshot = (): Effect.Effect<Telemetry.TelemetrySnapshot> =>
        Effect.sync(() => {
          const now = Date.now()
          const totalSaved = cacheSavingsTokens + compactionSavingsTokens
          // Estimated blended cost savings: $2.70 per 1M cached tokens read + $3.00 per 1M compacted tokens saved
          const estimatedCostSavingsUSD =
            (cacheSavingsTokens / 1_000_000) * 2.7 + (compactionSavingsTokens / 1_000_000) * 3.0

          const totalReqs = cacheHitCount + cacheMissCount
          const cacheHitRatio = totalReqs > 0 ? cacheHitCount / totalReqs : 0
          const totalAllPrompt = totalCachedPromptTokens + totalUncachedPromptTokens
          const tokenCacheHitRatio = totalAllPrompt > 0 ? totalCachedPromptTokens / totalAllPrompt : 0

          const activeList: Telemetry.ActiveSessionInfo[] = []
          for (const s of sessions.values()) {
            activeList.push(
              new Telemetry.ActiveSessionInfo({
                sessionID: s.sessionID,
                status: s.status,
                startTime: s.startTime,
                lastActivityTime: s.lastActivityTime,
                durationSeconds: Math.floor((now - s.startTime) / 1000),
                turnCount: s.turnCount,
                promptTokens: s.promptTokens,
                completionTokens: s.completionTokens,
                cachedTokens: s.cachedTokens,
                savedTokens: s.savedTokens,
                rollbackCount: s.rollbackCount,
                title: s.title,
                source: s.source,
              }),
            )
          }

          // Sort active sessions by lastActivityTime descending
          activeList.sort((a, b) => b.lastActivityTime - a.lastActivityTime)

          return new Telemetry.TelemetrySnapshot({
            timestamp: now,
            tokens: new Telemetry.TokenSavingsMetrics({
              cacheSavingsTokens,
              compactionSavingsTokens,
              totalTokensSaved: totalSaved,
              totalPromptTokens,
              totalCompletionTokens,
              estimatedCostSavingsUSD: Math.round(estimatedCostSavingsUSD * 10000) / 10000,
            }),
            cache: new Telemetry.CacheEfficiencyMetrics({
              cacheHitCount,
              cacheMissCount,
              cacheHitRatio: Math.round(cacheHitRatio * 10000) / 10000,
              tokenCacheHitRatio: Math.round(tokenCacheHitRatio * 10000) / 10000,
              totalCachedPromptTokens,
              totalUncachedPromptTokens,
            }),
            rollbacks: new Telemetry.RollbackMetrics({
              totalRollbacks,
              successfulRollbacks,
              failedRollbacks,
              recentRollbacks,
            }),
            activeSessions: activeList,
            totalSessionsTracked,
          })
        })

      const getSessionTrajectory = (sessionID: SessionID): Effect.Effect<Telemetry.ActiveSessionInfo | undefined> =>
        Effect.sync(() => {
          const s = sessions.get(sessionID)
          if (!s) return undefined
          const now = Date.now()
          return new Telemetry.ActiveSessionInfo({
            sessionID: s.sessionID,
            status: s.status,
            startTime: s.startTime,
            lastActivityTime: s.lastActivityTime,
            durationSeconds: Math.floor((now - s.startTime) / 1000),
            turnCount: s.turnCount,
            promptTokens: s.promptTokens,
            completionTokens: s.completionTokens,
            cachedTokens: s.cachedTokens,
            savedTokens: s.savedTokens,
            rollbackCount: s.rollbackCount,
            title: s.title,
            source: s.source,
          })
        })

      const renderDashboardHtml = (snapshot: Telemetry.TelemetrySnapshot): string => {
        const cachePercent = (snapshot.cache.tokenCacheHitRatio * 100).toFixed(1)
        const hitReqPercent = (snapshot.cache.cacheHitRatio * 100).toFixed(1)
        const totalSavedFormatted = snapshot.tokens.totalTokensSaved.toLocaleString()
        const costSavingsFormatted = snapshot.tokens.estimatedCostSavingsUSD.toFixed(4)
        const rollbacksCount = snapshot.rollbacks.totalRollbacks
        const activeCount = snapshot.activeSessions.filter((s) => s.status === "running").length

        const sessionRows = snapshot.activeSessions
          .slice(0, 20)
          .map((s) => {
            const statusClass =
              s.status === "running"
                ? "badge-running"
                : s.status === "error"
                  ? "badge-error"
                  : s.status === "completed"
                    ? "badge-completed"
                    : "badge-idle"
            return `
              <tr>
                <td><code>${s.sessionID}</code></td>
                <td><span class="badge ${statusClass}">${s.status}</span></td>
                <td>${s.durationSeconds}s</td>
                <td>${s.turnCount}</td>
                <td>${s.promptTokens.toLocaleString()}</td>
                <td><span class="highlight-green">${s.cachedTokens.toLocaleString()}</span></td>
                <td>${s.rollbackCount > 0 ? `<span class="highlight-amber">${s.rollbackCount}</span>` : "0"}</td>
                <td>${s.title ?? "OpenCode Session"}</td>
              </tr>
            `
          })
          .join("")

        const rollbackRows = snapshot.rollbacks.recentRollbacks
          .slice(0, 10)
          .map((r) => {
            const timeStr = new Date(r.timestamp).toLocaleTimeString()
            return `
              <tr>
                <td>${timeStr}</td>
                <td><code>${r.sessionID}</code></td>
                <td>${r.reason}</td>
                <td><code>${r.boundaryMessageID.slice(0, 12)}...</code></td>
                <td>${r.filesRestored} files</td>
                <td><span class="badge ${r.success ? "badge-completed" : "badge-error"}">${r.success ? "Restored" : "Failed"}</span></td>
              </tr>
            `
          })
          .join("")

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Telemetry & Live Trajectory Dashboard</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --accent: #8b5cf6;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }
    .header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(8px);
    }
    .header-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .live-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--success);
      box-shadow: 0 0 12px var(--success);
      display: inline-block;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    .metric-label {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .metric-value {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .metric-sub {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 8px;
    }
    .highlight-green { color: var(--success); font-weight: 600; }
    .highlight-amber { color: var(--warning); font-weight: 600; }
    .highlight-blue { color: var(--primary); font-weight: 600; }
    .highlight-purple { color: var(--accent); font-weight: 600; }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      margin: 32px 0 16px;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow-x: auto;
      margin-bottom: 32px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th {
      padding: 14px 20px;
      background: #141c2e;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    tr:last-child td { border-bottom: none; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-running { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
    .badge-completed { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-error { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-idle { background: rgba(156, 163, 175, 0.2); color: #9ca3af; border: 1px solid rgba(156, 163, 175, 0.4); }
    .footer {
      text-align: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 13px;
      border-top: 1px solid var(--card-border);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-title">
      <span class="live-dot"></span>
      OpenCode Live Trajectory & Telemetry Dashboard
    </div>
    <div style="font-size: 13px; color: var(--text-muted);">
      Updated: ${new Date(snapshot.timestamp).toLocaleTimeString()}
    </div>
  </div>

  <div class="container">
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Tokens Saved</div>
        <div class="metric-value highlight-green">${totalSavedFormatted}</div>
        <div class="metric-sub">Estimated Savings: <strong>$${costSavingsFormatted}</strong></div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Cache Hit Ratio</div>
        <div class="metric-value highlight-blue">${cachePercent}%</div>
        <div class="metric-sub">Request Hit Ratio: <strong>${hitReqPercent}%</strong></div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Trajectory Rollbacks</div>
        <div class="metric-value highlight-amber">${rollbacksCount}</div>
        <div class="metric-sub">${snapshot.rollbacks.successfulRollbacks} Succeeded / ${snapshot.rollbacks.failedRollbacks} Failed</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Active Trajectories</div>
        <div class="metric-value highlight-purple">${activeCount}</div>
        <div class="metric-sub">${snapshot.totalSessionsTracked} Total Sessions Tracked</div>
      </div>
    </div>

    <div class="section-title">⚡ Live Active Agent Trajectories</div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Turns</th>
            <th>Prompt Tokens</th>
            <th>Cached Tokens</th>
            <th>Rollbacks</th>
            <th>Context / Title</th>
          </tr>
        </thead>
        <tbody>
          ${sessionRows || '<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">No active sessions currently running</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section-title">🔄 Dual-Verifier Trajectory Rollback Audit Trail</div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Session</th>
            <th>Reason</th>
            <th>Checkpoint Boundary</th>
            <th>Restored</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          ${rollbackRows || '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No rollback events recorded yet</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    OpenCode SaaS Gateway & Autonomous Trajectory Engine • Real-Time Telemetry Node
  </div>
</body>
</html>`
      }

      return Service.of({
        recordUsage,
        recordCompaction,
        recordRollback,
        updateSessionStatus,
        endSession,
        getSnapshot,
        getSessionTrajectory,
        renderDashboardHtml,
      })
    }),
  )

export const layer = makeLayer()
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
