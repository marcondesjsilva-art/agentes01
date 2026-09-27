// Helpers de HTTP compartilhados pelas Functions.
// Equivalem ao json_response()/request_json() do antigo config.php.

export class HttpError extends Error {
  constructor(statusCode, payload) {
    super(typeof payload === "object" ? payload.error || "http" : String(payload))
    this.statusCode = statusCode
    this.payload = payload
  }
}

export function json(payload, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  }
}

// Faz o parse do corpo JSON da requisicao (equivale a request_json()).
export function readJson(event) {
  try {
    return event.body ? JSON.parse(event.body) : {}
  } catch {
    return {}
  }
}

// Query string (?id=..., ?price_cents=...).
export function query(event) {
  return event.queryStringParameters || {}
}

// Envolve um handler: converte HttpError em resposta JSON e qualquer outro
// erro em 500 (mesmo comportamento do catch(Throwable) do PHP).
export function wrap(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context)
    } catch (e) {
      if (e instanceof HttpError) return json(e.payload, e.statusCode)
      return json({ success: false, error: e?.message || "Erro interno" }, 500)
    }
  }
}
