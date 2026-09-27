import crypto from "node:crypto"
import { env } from "./env.mjs"

// Camada de persistencia. Porta fiel do store.php.
// Usa o Supabase (REST) quando SUPABASE_URL + SUPABASE_SERVICE_KEY existem.
// Sem Supabase, opera em modo "sem persistencia" (serverless nao tem disco
// permanente), retornando valores coerentes para o funil nao quebrar.

export function storeUsingSupabase() {
  return env("SUPABASE_URL") !== "" && env("SUPABASE_SERVICE_KEY") !== ""
}

export function storeDriver() {
  return storeUsingSupabase() ? "supabase" : "local"
}

export function storeUuid() {
  return crypto.randomUUID()
}

export function storeNow() {
  return new Date().toISOString()
}

export function utmEmpty() {
  return { source: "", medium: "", campaign: "", content: "", term: "", gclid: "", fbclid: "", ttclid: "" }
}

async function supabaseRequest(method, path, body = null, headers = {}) {
  const url = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/" + path.replace(/^\/+/, "")
  const key = env("SUPABASE_SERVICE_KEY")
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
        ...headers,
      },
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) {
    throw new Error("Falha de comunicacao com o Supabase: " + (e?.message || ""))
  }
  const text = await res.text()
  let decoded
  try {
    decoded = text ? JSON.parse(text) : null
  } catch {
    decoded = null
  }
  if (res.status < 200 || res.status >= 300) {
    const message =
      decoded && typeof decoded === "object" ? decoded.message || decoded.error || text : text
    throw new Error("Supabase recusou a operacao: " + message)
  }
  if (!decoded) return []
  return Array.isArray(decoded) ? decoded : [decoded]
}

function toBool(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "t"
}

export function storeNormalizeOrder(order) {
  let status = String(order.status ?? "waiting_payment").trim().toLowerCase()
  const marked = toBool(order.marked_paid_by_admin ?? false)
  if (marked || ["paid", "approved", "completed", "succeeded"].includes(status)) {
    status = "paid"
  } else if (["canceled", "cancelled", "expired", "failed"].includes(status)) {
    status = "canceled"
  } else {
    status = "waiting_payment"
  }
  return {
    id: String(order.id ?? ""),
    created_at: String(order.created_at ?? ""),
    paid_at: order.paid_at ?? null,
    status,
    transacao_id: String(order.transacao_id ?? ""),
    nome: String(order.nome ?? ""),
    cpf: String(order.cpf ?? ""),
    email: String(order.email ?? ""),
    telefone: String(order.telefone ?? ""),
    cep: String(order.cep ?? ""),
    cidade: String(order.cidade ?? ""),
    uf: String(order.uf ?? ""),
    cargo: String(order.cargo ?? ""),
    produto: String(order.produto ?? "Taxa de Inscricao"),
    price_cents: parseInt(order.price_cents ?? 6348, 10) || 6348,
    marked_paid_by_admin: marked,
    utm_source: String(order.utm_source ?? ""),
    utm_medium: String(order.utm_medium ?? ""),
    utm_campaign: String(order.utm_campaign ?? ""),
    utm_campaign_name: String(order.utm_campaign_name ?? ""),
    utm_adgroup: String(order.utm_adgroup ?? ""),
    utm_ad: String(order.utm_ad ?? ""),
    utm_keyword: String(order.utm_keyword ?? ""),
    utm_term: String(order.utm_term ?? ""),
    utm_matchtype: String(order.utm_matchtype ?? ""),
    utm_device: String(order.utm_device ?? ""),
    utm_network: String(order.utm_network ?? ""),
    utm_content: String(order.utm_content ?? ""),
    gclid: String(order.gclid ?? ""),
    fbclid: String(order.fbclid ?? ""),
    ttclid: String(order.ttclid ?? ""),
  }
}

export function storeUtmFromInput(utm) {
  const pick = (keys) => {
    for (const key of keys) {
      const value = String(utm?.[key] ?? "").trim()
      if (value !== "") return value
    }
    return ""
  }
  return {
    utm_source: pick(["utm_source", "source"]),
    utm_medium: pick(["utm_medium", "medium"]),
    utm_campaign: pick(["utm_campaign", "campaign"]),
    utm_campaign_name: pick(["utm_campaign_name", "campaign_name"]),
    utm_adgroup: pick(["utm_adgroup", "adgroup"]),
    utm_ad: pick(["utm_ad", "ad", "creative"]),
    utm_keyword: pick(["utm_keyword", "keyword"]),
    utm_term: pick(["utm_term", "term"]),
    utm_matchtype: pick(["utm_matchtype", "matchtype"]),
    utm_device: pick(["utm_device", "device"]),
    utm_network: pick(["utm_network", "network"]),
    utm_content: pick(["utm_content", "content"]),
    gclid: pick(["gclid"]),
    fbclid: pick(["fbclid"]),
    ttclid: pick(["ttclid"]),
  }
}

export async function ordersAll() {
  if (storeUsingSupabase()) {
    const rows = await supabaseRequest("GET", "orders?select=*&order=created_at.desc&limit=5000")
    return rows.map(storeNormalizeOrder)
  }
  return []
}

export async function ordersFindByCpf(cpf, onlyWaiting = false) {
  cpf = String(cpf ?? "").replace(/\D+/g, "")
  if (cpf.length !== 11) return null
  if (storeUsingSupabase()) {
    let filter = "orders?cpf=eq." + encodeURIComponent(cpf) + "&order=created_at.desc&limit=1&select=*"
    if (onlyWaiting) {
      filter =
        "orders?cpf=eq." +
        encodeURIComponent(cpf) +
        "&status=eq.waiting_payment&order=created_at.desc&limit=1&select=*"
    }
    const rows = await supabaseRequest("GET", filter)
    return rows[0] ? storeNormalizeOrder(rows[0]) : null
  }
  return null
}

export async function ordersFindAny(id) {
  id = String(id ?? "").trim()
  if (id === "") return null
  if (storeUsingSupabase()) {
    let rows = await supabaseRequest("GET", "orders?id=eq." + encodeURIComponent(id) + "&select=*&limit=1")
    if (rows[0]) return storeNormalizeOrder(rows[0])
    rows = await supabaseRequest("GET", "orders?transacao_id=eq." + encodeURIComponent(id) + "&select=*&limit=1")
    if (rows[0]) return storeNormalizeOrder(rows[0])
    const digits = id.replace(/\D+/g, "")
    if (digits.length === 11) return ordersFindByCpf(digits, false)
    return null
  }
  return null
}

export async function ordersFindByTx(transacaoId) {
  transacaoId = String(transacaoId ?? "").trim()
  if (transacaoId === "") return null
  if (storeUsingSupabase()) {
    const rows = await supabaseRequest(
      "GET",
      "orders?transacao_id=eq." + encodeURIComponent(transacaoId) + "&select=*&limit=1",
    )
    return rows[0] ? storeNormalizeOrder(rows[0]) : null
  }
  return null
}

export async function ordersUpsert(payload) {
  const now = storeNow()
  let order = storeNormalizeOrder({
    ...payload,
    id: String(payload.id ?? storeUuid()),
    created_at: String(payload.created_at ?? now),
    status: String(payload.status ?? "waiting_payment"),
    price_cents: parseInt(payload.price_cents ?? 6348, 10) || 6348,
    produto: String(payload.produto ?? "Taxa de Inscricao"),
  })
  const isReceita = order.price_cents === 5790 || order.produto.toLowerCase().includes("receita")

  if (storeUsingSupabase()) {
    let existing = order.transacao_id !== "" ? await ordersFindByTx(order.transacao_id) : null
    if (existing === null && order.cpf !== "" && !isReceita) {
      existing = await ordersFindByCpf(order.cpf, false)
    }
    if (existing !== null) {
      order.id = existing.id
      order.created_at = existing.created_at
      if ((existing.status ?? "") === "paid" || existing.marked_paid_by_admin) {
        order.status = "paid"
        order.marked_paid_by_admin = !!existing.marked_paid_by_admin
        order.paid_at = existing.paid_at || order.paid_at || null
      }
      const rows = await supabaseRequest("PATCH", "orders?id=eq." + encodeURIComponent(order.id), order)
      return rows[0] ? storeNormalizeOrder(rows[0]) : order
    }
    const rows = await supabaseRequest("POST", "orders", order)
    return rows[0] ? storeNormalizeOrder(rows[0]) : order
  }

  return order
}

export async function ordersMarkPaid(id, byAdmin = true) {
  id = String(id ?? "").trim()
  if (id === "") return null
  const paidAt = storeNow()
  const patch = { status: "paid", paid_at: paidAt, marked_paid_by_admin: byAdmin }

  if (storeUsingSupabase()) {
    const existing = await ordersFindAny(id)
    if (existing && existing.marked_paid_by_admin) patch.marked_paid_by_admin = true
    const targetId = existing?.id ?? id
    let rows = await supabaseRequest("PATCH", "orders?id=eq." + encodeURIComponent(targetId), patch)
    if (!rows[0]) {
      rows = await supabaseRequest("PATCH", "orders?transacao_id=eq." + encodeURIComponent(id), patch)
    }
    if (!rows[0] && existing !== null) {
      rows = [{ ...existing, status: "paid", paid_at: paidAt, marked_paid_by_admin: byAdmin }]
    }
    return rows[0] ? storeNormalizeOrder(rows[0]) : null
  }

  return null
}

export async function visitsInsert(visit) {
  const row = {
    id: storeUuid(),
    created_at: storeNow(),
    session_id: String(visit.session_id ?? ""),
    page: String(visit.page ?? "landing"),
    utm_source: String(visit.utm_source ?? ""),
    utm_campaign: String(visit.utm_campaign ?? ""),
    utm_keyword: String(visit.utm_keyword ?? ""),
    utm_campaign_name: String(visit.utm_campaign_name ?? ""),
  }
  if (storeUsingSupabase()) {
    const rows = await supabaseRequest("POST", "visits", row)
    return rows[0] ? rows[0] : row
  }
  return row
}

export async function visitsAll() {
  if (storeUsingSupabase()) {
    return supabaseRequest("GET", "visits?select=*&order=created_at.desc&limit=20000")
  }
  return []
}
