import { Gateway } from "@opencode-ai/core/gateway"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const GatewayHandler = HttpApiBuilder.group(Api, "server.gateway", (handlers) =>
  Effect.gen(function* () {
    const gateway = yield* Gateway.Service

    return handlers
      .handle("gateway.webhook", (ctx) =>
        gateway.handleWebhook({
          eventType: ctx.headers["x-github-event"],
          deliveryId: ctx.headers["x-github-delivery"],
          signature: ctx.headers["x-hub-signature-256"],
          payload: ctx.payload,
          rawBody: typeof ctx.payload === "string" ? ctx.payload : JSON.stringify(ctx.payload),
          secret: process.env.GITHUB_WEBHOOK_SECRET,
        }),
      )
      .handle("gateway.status", () => gateway.getStatus())
      .handle("gateway.dispatches", () => gateway.getDispatches())
  }),
)
