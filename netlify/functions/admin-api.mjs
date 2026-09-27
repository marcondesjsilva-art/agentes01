import { json, readJson, query, wrap } from "./_lib/http.mjs"
import { env } from "./_lib/env.mjs"
import { ordersAll, visitsAll, ordersMarkPaid, storeDriver, storeUsingSupabase } from "./_lib/store.mjs"
import {
  ADMIN_COOKIE,
  makeToken,
  verifyToken,
  readCookie,
  sessionCookie,
  clearCookie,
  timingSafeStr,
} from "./_lib/admin-auth.mjs"

function inRange(iso, fromTs, toTs) {
  if (!iso) return false
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return false
  const secs = Math.floor(ts / 1000)
  return secs >= fromTs && secs <= toTs
}

function bucketKey(order, field) {
  let value = String(order[field] ?? "").trim()
  if (field === "utm_keyword" && value === "") value = String(order.utm_term ?? "").trim()
  return value !== "" ? value : "(sem dado)"
}

function isPaid(o) {
  return (o.status ?? "") === "paid" || o.marked_paid_by_admin
}

function dashboard(orders, visits, range) {
  const now = Math.floor(Date.now() / 1000)
  const startOfToday = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000)
  const from =
    range === "today" ? startOfToday : range === "7d" ? now - 7 * 86400 : range === "30d" ? now - 30 * 86400 : 0

  const filtered = orders.filter((o) => inRange(String(o.created_at), from, now + 10))
  const filteredVisits = visits.filter((v) => inRange(String(v.created_at ?? ""), from, now + 10))

  const paid = filtered.filter(isPaid)
  const waiting = filtered.filter((o) => !isPaid(o) && (o.status ?? "") !== "canceled")
  const revenue = paid.reduce((sum, o) => sum + (parseInt(o.price_cents ?? 0, 10) || 0), 0)
  const orderCount = filtered.length
  const paidCount = paid.length
  const visitCount = filteredVisits.length
  const checkoutConversion = orderCount > 0 ? Math.round((paidCount / orderCount) * 1000) / 10 : 0
  const funnelConversion = visitCount > 0 ? Math.round((paidCount / visitCount) * 1000) / 10 : 0
  const ticket = paidCount > 0 ? Math.round(revenue / paidCount) : 0

  const byDayMap = {}
  for (const order of filtered) {
    const day = String(order.created_at).slice(0, 10)
    if (day === "") continue
    if (!byDayMap[day]) byDayMap[day] = { day, pedidos: 0, pagos: 0, faturamento_cents: 0 }
    byDayMap[day].pedidos++
    if (isPaid(order)) {
      byDayMap[day].pagos++
      byDayMap[day].faturamento_cents += parseInt(order.price_cents ?? 0, 10) || 0
    }
  }
  const byDay = Object.keys(byDayMap)
    .sort()
    .map((k) => byDayMap[k])

  const group = (items, field) => {
    const map = {}
    for (const order of items) {
      const key = bucketKey(order, field)
      if (!map[key]) {
        map[key] = {
          label: key,
          pedidos: 0,
          pagos: 0,
          faturamento_cents: 0,
          campaign_name: String(order.utm_campaign_name ?? ""),
        }
      }
      map[key].pedidos++
      if (isPaid(order)) {
        map[key].pagos++
        map[key].faturamento_cents += parseInt(order.price_cents ?? 0, 10) || 0
      }
      if (map[key].campaign_name === "" && (order.utm_campaign_name ?? "") !== "") {
        map[key].campaign_name = String(order.utm_campaign_name)
      }
    }
    return Object.values(map).sort(
      (a, b) => b.faturamento_cents - a.faturamento_cents || b.pedidos - a.pedidos,
    )
  }

  return {
    kpis: {
      pedidos: orderCount,
      pagos: paidCount,
      aguardando: waiting.length,
      visitas: visitCount,
      faturamento_cents: revenue,
      ticket_cents: ticket,
      conversao_checkout: checkoutConversion,
      conversao_funil: funnelConversion,
    },
    by_day: byDay,
    by_keyword: group(filtered, "utm_keyword"),
    by_campaign: group(filtered, "utm_campaign"),
    by_source: group(filtered, "utm_source"),
    by_device: group(filtered, "utm_device"),
    orders: filtered,
    paid_sample: paid,
  }
}

function loggedInUser(event) {
  const payload = verifyToken(readCookie(event, ADMIN_COOKIE))
  return payload ? payload.user : ""
}

// Porta de admin-api.php. Autenticacao via cookie assinado (HMAC).
export const handler = wrap(async (event) => {
  const input = readJson(event)
  const action = String(query(event).action ?? input.action ?? "").trim()

  if (action === "login") {
    const confUser = env("ADMIN_USER")
    const confPass = env("ADMIN_PASS")
    // Sem credenciais configuradas o painel NAO pode abrir (evita login em branco).
    if (confUser === "" || confPass === "") {
      return json(
        { success: false, error: "Admin nao configurado: defina ADMIN_USER e ADMIN_PASS na Netlify" },
        500,
      )
    }
    const user = String(input.user ?? "").trim()
    const pass = String(input.pass ?? "")
    const okUser = timingSafeStr(confUser, user)
    const okPass = timingSafeStr(confPass, pass)
    if (!okUser || !okPass) {
      return json({ success: false, error: "Usuario ou senha invalidos" }, 401)
    }
    return json({ success: true, user, driver: storeDriver() }, 200, {
      "Set-Cookie": sessionCookie(makeToken(user)),
    })
  }

  if (action === "logout") {
    return json({ success: true }, 200, { "Set-Cookie": clearCookie() })
  }

  if (action === "me") {
    const user = loggedInUser(event)
    if (user === "") return json({ success: false, authenticated: false }, 401)
    return json({
      success: true,
      authenticated: true,
      user,
      driver: storeDriver(),
      supabase_ready: storeUsingSupabase(),
    })
  }

  // A partir daqui exige autenticacao.
  const user = loggedInUser(event)
  if (user === "") return json({ success: false, error: "Nao autenticado" }, 401)

  if (action === "dashboard") {
    let range = String(query(event).range ?? input.range ?? "30d").trim()
    if (!["today", "7d", "30d", "all"].includes(range)) range = "30d"
    const dash = dashboard(await ordersAll(), await visitsAll(), range)
    return json({
      success: true,
      driver: storeDriver(),
      supabase_ready: storeUsingSupabase(),
      range,
      ...dash,
    })
  }

  if (action === "mark_paid") {
    let id = String(input.id ?? input.transacao_id ?? input.cpf ?? query(event).id ?? "").trim()
    if (id === "" && input.order && typeof input.order === "object") {
      id = String(input.order.id ?? input.order.transacao_id ?? input.order.cpf ?? "").trim()
    }
    const order = await ordersMarkPaid(id, true)
    if (order === null) return json({ success: false, error: "Pedido nao encontrado" }, 404)
    return json({ success: true, order })
  }

  return json({ success: false, error: "Acao invalida" }, 400)
})
