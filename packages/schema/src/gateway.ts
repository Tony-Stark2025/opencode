import { Schema } from "effect"
import { SessionID } from "./session-id"

export namespace Gateway {
  export const WebhookHeaders = Schema.Struct({
    "x-hub-signature-256": Schema.optional(Schema.String),
    "x-github-event": Schema.String,
    "x-github-delivery": Schema.String,
  })
  export type WebhookHeaders = typeof WebhookHeaders.Type

  export const GitHubUser = Schema.Struct({
    login: Schema.String,
    id: Schema.Number,
    avatar_url: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
  })
  export type GitHubUser = typeof GitHubUser.Type

  export const GitHubRepository = Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    full_name: Schema.String,
    html_url: Schema.optional(Schema.String),
    default_branch: Schema.optional(Schema.String),
    private: Schema.optional(Schema.Boolean),
    owner: Schema.optional(GitHubUser),
  })
  export type GitHubRepository = typeof GitHubRepository.Type

  export const GitHubIssue = Schema.Struct({
    id: Schema.Number,
    number: Schema.Number,
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    state: Schema.String,
    html_url: Schema.optional(Schema.String),
    user: GitHubUser,
    labels: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
  })
  export type GitHubIssue = typeof GitHubIssue.Type

  export const GitHubPullRequest = Schema.Struct({
    id: Schema.Number,
    number: Schema.Number,
    title: Schema.String,
    body: Schema.NullOr(Schema.String),
    state: Schema.String,
    html_url: Schema.optional(Schema.String),
    diff_url: Schema.optional(Schema.String),
    user: GitHubUser,
    head: Schema.Struct({
      ref: Schema.String,
      sha: Schema.String,
      repo: Schema.optional(GitHubRepository),
    }),
    base: Schema.Struct({
      ref: Schema.String,
      sha: Schema.String,
      repo: Schema.optional(GitHubRepository),
    }),
    draft: Schema.optional(Schema.Boolean),
    merged: Schema.optional(Schema.Boolean),
  })
  export type GitHubPullRequest = typeof GitHubPullRequest.Type

  export const GitHubComment = Schema.Struct({
    id: Schema.Number,
    body: Schema.String,
    user: GitHubUser,
    html_url: Schema.optional(Schema.String),
    diff_hunk: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    position: Schema.optional(Schema.NullOr(Schema.Number)),
  })
  export type GitHubComment = typeof GitHubComment.Type

  export const WebhookPayload = Schema.Struct({
    action: Schema.optional(Schema.String),
    repository: Schema.optional(GitHubRepository),
    sender: Schema.optional(GitHubUser),
    issue: Schema.optional(GitHubIssue),
    pull_request: Schema.optional(GitHubPullRequest),
    comment: Schema.optional(GitHubComment),
    number: Schema.optional(Schema.Number),
    zen: Schema.optional(Schema.String),
    hook_id: Schema.optional(Schema.Number),
  })
  export type WebhookPayload = typeof WebhookPayload.Type

  export const DispatchStatus = Schema.Literals(["received", "dispatched", "running", "completed", "failed", "ignored"])
  export type DispatchStatus = typeof DispatchStatus.Type

  export const TargetType = Schema.Literals(["pull_request", "issue", "ping"])
  export type TargetType = typeof TargetType.Type

  export class DispatchRecord extends Schema.Class<DispatchRecord>("Gateway.DispatchRecord")({
    jobId: Schema.String,
    sessionID: Schema.optional(SessionID),
    status: DispatchStatus,
    repository: Schema.String,
    targetType: TargetType,
    targetNumber: Schema.optional(Schema.Number),
    action: Schema.String,
    sender: Schema.String,
    deliveryId: Schema.String,
    createdAt: Schema.Number,
    summary: Schema.String,
    error: Schema.optional(Schema.String),
  }) {}

  export class GatewayStatus extends Schema.Class<GatewayStatus>("Gateway.GatewayStatus")({
    enabled: Schema.Boolean,
    webhooksReceived: Schema.Number,
    dispatchesActive: Schema.Number,
    totalDispatches: Schema.Number,
    lastDeliveryId: Schema.optional(Schema.String),
    lastEventTime: Schema.optional(Schema.Number),
  }) {}

  export class WebhookResponse extends Schema.Class<WebhookResponse>("Gateway.WebhookResponse")({
    accepted: Schema.Boolean,
    jobId: Schema.optional(Schema.String),
    sessionID: Schema.optional(SessionID),
    status: DispatchStatus,
    message: Schema.String,
  }) {}
}
