import { env } from "./env.mjs"
import { HttpError } from "./http.mjs"

// Chamada ao BravoPay. Retorna [status, data]. Equivale ao bravo_request() do PHP.
export async function bravoRequest(method, path, body = null) {
  const token = env("BRAVOPAY_API_TOKEN")
  if (!token) {
    throw new HttpError(500, { success: false, error: "BRAVOPAY_API_TOKEN nao configurado" })
  }

  let res
  try {
    res = await fetch("https://bravopay.club/api/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body && Object.keys(body).length ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    })
  } catch {
    throw new HttpError(502, { success: false, error: "Falha de comunicacao com o BravoPay" })
  }

  const text = await res.text()
  let decoded
  try {
    decoded = JSON.parse(text)
  } catch {
    decoded = null
  }
  if (decoded === null || typeof decoded !== "object") {
    throw new HttpError(502, { success: false, error: "Resposta invalida do BravoPay" })
  }
  return [res.status, decoded]
}
