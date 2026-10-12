import { describe, expect, it } from "bun:test"
import { parseGitHubWebhookEvent } from "../src/gateway/parser"

describe("gateway parser", () => {
  it("handles ping event acknowledgment", () => {
    const result = parseGitHubWebhookEvent("ping", "del_123", {
      zen: "Approachable is better than simple.",
      hook_id: 42,
      repository: { full_name: "acme/corp" },
      sender: { login: "octocat" },
    })

    expect(result.eventType).toBe("ping")
    expect(result.targetType).toBe("ping")
    expect(result.shouldDispatch).toBe(false)
    expect(result.repository).toBe("acme/corp")
    expect(result.sender).toBe("octocat")
  })

  it("parses issues.opened and generates dispatch prompt", () => {
    const result = parseGitHubWebhookEvent("issues", "del_456", {
      action: "opened",
      issue: {
        number: 101,
        title: "Memory leak in tokenizer",
        body: "The regex buffer never frees memory.",
        state: "open",
        user: { login: "bugreporter" },
      },
      repository: { full_name: "acme/corp" },
      sender: { login: "bugreporter" },
    })

    expect(result.targetType).toBe("issue")
    expect(result.targetNumber).toBe(101)
    expect(result.shouldDispatch).toBe(true)
    expect(result.promptText).toContain("GitHub Issue #101: Memory leak in tokenizer")
    expect(result.promptText).toContain("The regex buffer never frees memory.")
    expect(result.promptText).toContain("investigate this issue")
  })

  it("ignores issues.closed action", () => {
    const result = parseGitHubWebhookEvent("issues", "del_457", {
      action: "closed",
      issue: { number: 101, title: "Memory leak", state: "closed" },
      repository: { full_name: "acme/corp" },
    })

    expect(result.shouldDispatch).toBe(false)
    expect(result.reason).toContain("does not trigger automated execution")
  })

  it("parses issue_comment with /opencode trigger and generates prompt", () => {
    const result = parseGitHubWebhookEvent("issue_comment", "del_789", {
      action: "created",
      issue: {
        number: 42,
        title: "Broken route",
        pull_request: {}, // Indicates comment is on a PR
      },
      comment: {
        id: 999,
        body: "/opencode please fix the failing test in server.test.ts",
        user: { login: "developer" },
      },
      repository: { full_name: "acme/corp" },
      sender: { login: "developer" },
    })

    expect(result.targetType).toBe("pull_request")
    expect(result.targetNumber).toBe(42)
    expect(result.shouldDispatch).toBe(true)
    expect(result.promptText).toContain("Pull Request #42 Comment")
    expect(result.promptText).toContain("/opencode please fix the failing test")
  })

  it("ignores issue_comment without trigger command", () => {
    const result = parseGitHubWebhookEvent("issue_comment", "del_790", {
      action: "created",
      issue: { number: 42, title: "Broken route" },
      comment: { id: 999, body: "Looks good to me +1", user: { login: "reviewer" } },
      repository: { full_name: "acme/corp" },
      sender: { login: "reviewer" },
    })

    expect(result.shouldDispatch).toBe(false)
    expect(result.reason).toContain("did not include an OpenCode trigger command")
  })

  it("parses pull_request.opened and synchronizes", () => {
    const result = parseGitHubWebhookEvent("pull_request", "del_800", {
      action: "opened",
      pull_request: {
        number: 77,
        title: "feat: add telemetry engine",
        body: "Adds live trajectory telemetry",
        user: { login: "contributor" },
        head: { ref: "feature-telemetry" },
        base: { ref: "main" },
      },
      repository: { full_name: "acme/corp" },
      sender: { login: "contributor" },
    })

    expect(result.targetType).toBe("pull_request")
    expect(result.targetNumber).toBe(77)
    expect(result.branch).toBe("feature-telemetry")
    expect(result.baseBranch).toBe("main")
    expect(result.shouldDispatch).toBe(true)
    expect(result.promptText).toContain("Pull Request #77: feat: add telemetry engine")
  })
})
