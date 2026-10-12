import { Telemetry } from "@opencode-ai/core/telemetry"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const TelemetryHandler = HttpApiBuilder.group(Api, "server.telemetry", (handlers) =>
  Effect.gen(function* () {
    const telemetry = yield* Telemetry.Service

    return handlers
      .handle("telemetry.metrics", () => telemetry.getSnapshot())
      .handle("telemetry.trajectory", (ctx) => telemetry.getSessionTrajectory(ctx.params.sessionID))
      .handle("telemetry.dashboard", () => telemetry.getSnapshot())
      .handle("telemetry.dashboardHtml", () =>
        Effect.gen(function* () {
          const snapshot = yield* telemetry.getSnapshot()
          return telemetry.renderDashboardHtml(snapshot)
        }),
      )
  }),
)
