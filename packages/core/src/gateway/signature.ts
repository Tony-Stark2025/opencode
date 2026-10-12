import crypto from "node:crypto"

export interface SignatureValidationResult {
  readonly valid: boolean
  readonly reason?: string
}

export function validateGitHubSignature(
  secret: string,
  payload: string | Buffer | unknown,
  signatureHeader: string | undefined,
): SignatureValidationResult {
  if (!secret) {
    return { valid: false, reason: "Webhook secret is not configured" }
  }

  if (!signatureHeader) {
    return { valid: false, reason: "Missing X-Hub-Signature-256 header" }
  }

  const trimmed = signatureHeader.trim()
  const prefix = "sha256="
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return { valid: false, reason: "Malformed signature header, expected sha256= prefix" }
  }

  const signatureHex = trimmed.slice(prefix.length).toLowerCase()
  if (signatureHex.length !== 64 || !/^[0-9a-f]{64}$/.test(signatureHex)) {
    return { valid: false, reason: "Invalid signature length or format for sha256" }
  }

  const hmac = crypto.createHmac("sha256", secret)
  const bodyBuffer =
    Buffer.isBuffer(payload)
      ? payload
      : typeof payload === "string"
        ? Buffer.from(payload, "utf8")
        : Buffer.from(JSON.stringify(payload ?? ""), "utf8")
  hmac.update(bodyBuffer)
  const expectedHex = hmac.digest("hex")

  const expectedBuffer = Buffer.from(expectedHex, "utf8")
  const actualBuffer = Buffer.from(signatureHex, "utf8")

  if (expectedBuffer.length !== actualBuffer.length) {
    return { valid: false, reason: "Signature mismatch" }
  }

  const match = crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  return match
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch" }
}

export function generateGitHubSignature(secret: string, payload: string | Buffer | unknown): string {
  const hmac = crypto.createHmac("sha256", secret)
  const bodyBuffer =
    Buffer.isBuffer(payload)
      ? payload
      : typeof payload === "string"
        ? Buffer.from(payload, "utf8")
        : Buffer.from(JSON.stringify(payload ?? ""), "utf8")
  hmac.update(bodyBuffer)
  return `sha256=${hmac.digest("hex")}`
}
