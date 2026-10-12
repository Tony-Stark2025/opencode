import type { Gateway } from "@opencode-ai/schema"

export interface ParsedGitHubEvent {
  readonly eventType: string
  readonly deliveryId: string
  readonly targetType: Gateway.TargetType
  readonly repository: string
  readonly targetNumber?: number
  readonly action: string
  readonly sender: string
  readonly title?: string
  readonly body?: string
  readonly shouldDispatch: boolean
  readonly reason?: string
  readonly promptText?: string
  readonly branch?: string
  readonly baseBranch?: string
}

export function parseGitHubWebhookEvent(
  eventType: string,
  deliveryId: string,
  payload: any,
): ParsedGitHubEvent {
  const sender = payload?.sender?.login ?? "unknown"
  const repository = payload?.repository?.full_name ?? "unknown/repository"

  if (eventType === "ping") {
    return {
      eventType,
      deliveryId,
      targetType: "ping",
      repository,
      action: "ping",
      sender,
      shouldDispatch: false,
      reason: "Ping event acknowledged",
    }
  }

  if (eventType === "issues") {
    const issue = payload?.issue
    const action = payload?.action ?? "opened"
    const issueNumber = issue?.number

    // We dispatch on issues opened, or labeled with bug/task/opencode
    const isDispatchAction = Boolean(issue) && (action === "opened" || action === "reopened")
    const promptText = [
      `### GitHub Issue #${issueNumber}: ${issue?.title ?? "Untitled"}`,
      `**Repository:** ${repository}`,
      `**Reported by:** @${issue?.user?.login ?? sender}`,
      `**State:** ${issue?.state ?? "open"}`,
      "",
      "#### Description:",
      issue?.body || "(No description provided)",
      "",
      "---",
      "Please investigate this issue, locate the relevant code, reproduce or identify the root cause, and formulate or implement the required fix.",
    ].join("\n")

    return {
      eventType,
      deliveryId,
      targetType: "issue",
      repository,
      targetNumber: issueNumber,
      action,
      sender,
      title: issue?.title,
      body: issue?.body ?? "",
      shouldDispatch: isDispatchAction,
      reason: isDispatchAction ? undefined : `Issue action '${action}' does not trigger automated execution`,
      promptText: isDispatchAction ? promptText : undefined,
    }
  }

  if (eventType === "issue_comment") {
    const issue = payload?.issue
    const comment = payload?.comment
    const action = payload?.action ?? "created"
    const targetNumber = issue?.number
    const isPR = Boolean(issue?.pull_request)
    const targetType: Gateway.TargetType = isPR ? "pull_request" : "issue"

    const commentBody = comment?.body ?? ""
    // Check for bot trigger keywords or explicit invocation
    const isBotTrigger =
      commentBody.includes("/opencode") ||
      commentBody.includes("@opencode") ||
      commentBody.includes("/fix") ||
      commentBody.includes("/review") ||
      commentBody.includes("/solve")

    const shouldDispatch = action === "created" && isBotTrigger

    const promptText = [
      `### GitHub ${isPR ? "Pull Request" : "Issue"} #${targetNumber} Comment`,
      `**Repository:** ${repository}`,
      `**Author:** @${comment?.user?.login ?? sender}`,
      "",
      "#### Context:",
      `**Title:** ${issue?.title ?? "Untitled"}`,
      "",
      "#### Instruction / Comment:",
      commentBody,
      "",
      "---",
      "Execute the instructions specified in the comment above.",
    ].join("\n")

    return {
      eventType,
      deliveryId,
      targetType,
      repository,
      targetNumber,
      action,
      sender,
      title: issue?.title,
      body: commentBody,
      shouldDispatch,
      reason: shouldDispatch ? undefined : !isBotTrigger ? "Comment did not include an OpenCode trigger command (/opencode, @opencode, /fix, /review)" : `Action '${action}' ignored`,
      promptText: shouldDispatch ? promptText : undefined,
    }
  }

  if (eventType === "pull_request") {
    const pr = payload?.pull_request
    const action = payload?.action ?? "opened"
    const prNumber = pr?.number ?? payload?.number
    const branch = pr?.head?.ref
    const baseBranch = pr?.base?.ref

    const isDispatchAction = Boolean(pr) && (action === "opened" || action === "synchronize" || action === "ready_for_review")

    const promptText = [
      `### GitHub Pull Request #${prNumber}: ${pr?.title ?? "Untitled"}`,
      `**Repository:** ${repository}`,
      `**Author:** @${pr?.user?.login ?? sender}`,
      `**Branch:** ${branch ?? "head"} -> ${baseBranch ?? "base"}`,
      `**Action:** ${action}`,
      "",
      "#### Description:",
      pr?.body || "(No description provided)",
      "",
      "---",
      "Review the pull request changes, verify build and test status, and report or address any regressions or bugs.",
    ].join("\n")

    return {
      eventType,
      deliveryId,
      targetType: "pull_request",
      repository,
      targetNumber: prNumber,
      action,
      sender,
      title: pr?.title,
      body: pr?.body ?? "",
      branch,
      baseBranch,
      shouldDispatch: isDispatchAction,
      reason: isDispatchAction ? undefined : `Pull Request action '${action}' does not trigger execution`,
      promptText: isDispatchAction ? promptText : undefined,
    }
  }

  if (eventType === "pull_request_review_comment") {
    const pr = payload?.pull_request
    const comment = payload?.comment
    const action = payload?.action ?? "created"
    const prNumber = pr?.number
    const path = comment?.path
    const line = comment?.line ?? comment?.original_line
    const commentBody = comment?.body ?? ""

    const isBotTrigger =
      commentBody.includes("/opencode") ||
      commentBody.includes("@opencode") ||
      commentBody.includes("/fix")

    const promptText = [
      `### GitHub PR #${prNumber} Review Comment on \`${path ?? "code"}\` (line ${line ?? "unknown"})`,
      `**Repository:** ${repository}`,
      `**Author:** @${comment?.user?.login ?? sender}`,
      comment?.diff_hunk ? `\n\`\`\`diff\n${comment.diff_hunk}\n\`\`\`\n` : "",
      "#### Review Comment:",
      commentBody,
      "",
      "---",
      "Address this code review feedback at the specified file and location.",
    ].join("\n")

    return {
      eventType,
      deliveryId,
      targetType: "pull_request",
      repository,
      targetNumber: prNumber,
      action,
      sender,
      title: pr?.title,
      body: commentBody,
      shouldDispatch: isBotTrigger,
      reason: isBotTrigger ? undefined : "Review comment did not include an OpenCode trigger command",
      promptText: isBotTrigger ? promptText : undefined,
    }
  }

  return {
    eventType,
    deliveryId,
    targetType: "issue",
    repository,
    action: payload?.action ?? "unknown",
    sender,
    shouldDispatch: false,
    reason: `Unsupported event type: ${eventType}`,
  }
}
