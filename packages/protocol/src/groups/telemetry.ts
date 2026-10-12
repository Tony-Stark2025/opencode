import { Telemetry } from "@opencode-ai/schema/telemetry"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const TelemetryGroup = HttpApiGroup.make("server.telemetry")
  .add(
    HttpApiEndpoint.get("telemetry.metrics", "/api/telemetry/metrics", {
      success: Telemetry.TelemetrySnapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.telemetry.metrics",
        summary: "Get Real-time Telemetry Metrics",
        description: "Retrieve real-time token savings, KV-cache hit ratios, rollback count, and active session metrics.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("telemetry.trajectory", "/api/telemetry/trajectory/:sessionID", {
      params: { sessionID: SessionID },
      success: Schema.UndefinedOr(Telemetry.ActiveSessionInfo),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.telemetry.trajectory",
        summary: "Get Session Trajectory Status",
        description: "Retrieve trajectory telemetry and token metrics for a specific session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("telemetry.dashboard", "/api/telemetry/dashboard", {
      success: Telemetry.TelemetrySnapshot,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.telemetry.dashboard",
        summary: "Get Trajectory Dashboard Data",
        description: "Retrieve complete real-time dataset for the live trajectory dashboard.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("telemetry.dashboardHtml", "/api/telemetry/dashboard/view", {
      success: Schema.String,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.telemetry.dashboardHtml",
        summary: "View Live Trajectory HTML Dashboard",
        description: "Retrieve full rendered HTML for the live trajectory and telemetry dashboard.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "telemetry",
      description: "Real-time metrics and live trajectory dashboard routes.",
    }),
  )
