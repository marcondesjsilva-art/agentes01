import { json, readJson, wrap } from "./_lib/http.mjs"
import { env } from "./_lib/env.mjs"

function nowUtc() {
  // Formato "Y-m-d H:i:s" em UTC, igual ao gmdate() do PHP.
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

// Envia o pedido para a Utmify. Porta de utmify.php.
export const handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") return json({ success: false, error: "Metodo nao permitido" }, 405)

  const input = readJson(event)
  const order = String(input.orderId ?? "").trim()
  const status = String(input.status ?? "waiting_payment").trim()
  const price = parseInt(input.priceInCents ?? 6348, 10) || 6348
  if (order === "") return json({ success: false, error: "orderId obrigatorio" }, 400)

  const token = env("UTMIFY_API_TOKEN")
  if (!token) return json({ success: false, error: "UTMIFY_API_TOKEN nao configurado" }, 500)

  const utm = input.utm && typeof input.utm === "object" ? input.utm : {}
  const payload = {
    orderId: order,
    platform: "BravoPay",
    paymentMethod: "pix",
    status,
    createdAt: nowUtc(),
    approvedDate: status === "paid" ? nowUtc() : null,
    refundedAt: null,
    customer: {
      name: "Nao Informado",
      email: "naoinformado@email.com",
      phone: "",
      document: "",
      country: "BR",
    },
    products: [
      {
        id: env("BRAVOPAY_PRODUCT_ID", "ebook-emagrecimento"),
        name: "E-book Emagrecimento",
        planId: null,
        planName: null,
        quantity: 1,
        priceInCents: price,
      },
    ],
    trackingParameters: {
      src: utm.src ?? null,
      sck: utm.sck ?? null,
      utm_source: utm.utm_source ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_content: utm.utm_content ?? null,
      utm_term: utm.utm_term ?? null,
      gclid: utm.gclid ?? null,
      fbclid: utm.fbclid ?? null,
      ttclid: utm.ttclid ?? null,
    },
    commission: {
      totalPriceInCents: price,
      gatewayFeeInCents: 0,
      userCommissionInCents: price,
    },
  }

  let code = 502
  try {
    const res = await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": token,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    code = res.status
  } catch {
    code = 502
  }

  if (code < 200 || code >= 300) return json({ success: false, error: "Utmify recusou o pedido" }, 502)
  return json({ success: true })
})
