import crypto from "node:crypto"
import { env } from "./env.mjs"

// Autenticacao do painel admin.
// Como o serverless nao tem sessao PHP, usamos um cookie ASSINADO (HMAC).
// O cookie so e valido se a assinatura conferir com ADMIN_USER/ADMIN_PASS
// (segredo derivado), entao ninguem consegue forjar sem as credenciais.

export const ADMIN_COOKIE = "aventador_admin"
const MAX_AGE = 12 * 60 * 60 // 12h, igual ao lifetime da sessao original

function secret() {
  return crypto.createHash("sha256").update(`${env("ADMIN_USER")}:${env("ADMIN_PASS")}:v0-netlify`).digest()
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

export function makeToken(user) {
  const payload = { user, exp: Date.now() + MAX_AGE * 1000 }
  const p = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac("sha256", secret()).update(p).digest())
  return `${p}.${sig}`
}

export function verifyToken(token) {
  if (!token || !token.includes(".")) return null
  const [p, sig] = token.split(".")
  const expected = b64url(crypto.createHmac("sha256", secret()).update(p).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload
  try {
    payload = JSON.parse(b64urlDecode(p).toString("utf8"))
  } catch {
    return null
  }
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp || !payload.user) return null
  return payload
}

export function readCookie(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || ""
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return ""
}

export function sessionCookie(token) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

// Comparacao de strings resistente a timing (equivale a hash_equals do PHP).
export function timingSafeStr(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
