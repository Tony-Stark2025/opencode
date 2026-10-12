import { describe, expect, it } from "bun:test"
import { validateGitHubSignature, generateGitHubSignature } from "../src/gateway/signature"

describe("gateway signature validation", () => {
  const secret = "test_webhook_secret_key_12345"
  const payload = JSON.stringify({ action: "opened", repository: { full_name: "org/repo" } })

  it("accepts a valid signature matching the secret and payload", () => {
    const validHeader = generateGitHubSignature(secret, payload)
    const result = validateGitHubSignature(secret, payload, validHeader)
    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("rejects when secret is empty or undefined", () => {
    const validHeader = generateGitHubSignature(secret, payload)
    const result = validateGitHubSignature("", payload, validHeader)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("secret is not configured")
  })

  it("rejects when signature header is missing", () => {
    const result = validateGitHubSignature(secret, payload, undefined)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Missing X-Hub-Signature-256")
  })

  it("rejects when signature header does not start with sha256=", () => {
    const result = validateGitHubSignature(secret, payload, "md5=1234567890abcdef")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("expected sha256= prefix")
  })

  it("rejects when signature hex length is invalid", () => {
    const result = validateGitHubSignature(secret, payload, "sha256=tooshort")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Invalid signature length")
  })

  it("rejects when signature does not match (tampered payload or wrong secret)", () => {
    const wrongHeader = generateGitHubSignature("wrong_secret", payload)
    const result = validateGitHubSignature(secret, payload, wrongHeader)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("Signature mismatch")
  })

  it("handles Buffer payload input correctly", () => {
    const bufferPayload = Buffer.from(payload, "utf8")
    const validHeader = generateGitHubSignature(secret, bufferPayload)
    const result = validateGitHubSignature(secret, bufferPayload, validHeader)
    expect(result.valid).toBe(true)
  })

  it("accepts signatures with uppercase hex digits and surrounding whitespace", () => {
    const validHeader = generateGitHubSignature(secret, payload)
    const upperHeader = `  SHA256=${validHeader.slice(7).toUpperCase()}  `
    const result = validateGitHubSignature(secret, payload, upperHeader)
    expect(result.valid).toBe(true)
  })

  it("rejects 64-character signature headers that contain non-hex characters", () => {
    const nonHexHeader = `sha256=${"z".repeat(64)}`
    const result = validateGitHubSignature(secret, payload, nonHexHeader)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("Invalid signature length or format")
  })

  it("handles object payloads and unicode multibyte characters gracefully", () => {
    const unicodePayload = { action: "opened", title: "Bug: 🚀 crashes on utf-8 日本語 text" }
    const validHeader = generateGitHubSignature(secret, unicodePayload)
    const result = validateGitHubSignature(secret, unicodePayload, validHeader)
    expect(result.valid).toBe(true)
  })
})
