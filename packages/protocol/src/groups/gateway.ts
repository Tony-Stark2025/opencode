import { Gateway } from "@opencode-ai/schema/gateway"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const GatewayGroup = HttpApiGroup.make("server.gateway")
  .add(
    HttpApiEndpoint.post("gateway.webhook", "/api/gateway/github/webhook", {
      headers: Gateway.WebhookHeaders,
      payload: Gateway.WebhookPayload,
      success: Gateway.WebhookResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.gateway.webhook",
        summary: "Ingest GitHub Webhook",
        description: "Validate GitHub signature and dispatch issue or pull request event to session runner.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("gateway.status", "/api/gateway/status", {
      success: Gateway.GatewayStatus,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.gateway.status",
        summary: "Get Gateway Status",
        description: "Retrieve SaaS gateway operational status and active webhook counters.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("gateway.dispatches", "/api/gateway/dispatches", {
      success: Schema.Array(Gateway.DispatchRecord),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.gateway.dispatches",
        summary: "List Gateway Dispatches",
        description: "Retrieve recent GitHub event dispatch history.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "gateway",
      description: "Cloud ingress and SaaS gateway routes.",
    }),
  )
