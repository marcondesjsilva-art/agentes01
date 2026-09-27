import crypto from "node:crypto"
import { json, readJson, query, wrap } from "./_lib/http.mjs"
import { env } from "./_lib/env.mjs"
import { bravoRequest } from "./_lib/bravo.mjs"
import {
  storeUtmFromInput,
  utmEmpty,
  ordersFindByTx,
  ordersFindByCpf,
  ordersUpsert,
  storeNow,
} from "./_lib/store.mjs"

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

// Gera o PIX no BravoPay e registra o pedido. Porta de gerar-pix.php.
export const handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") return json({ success: false, error: "Metodo nao permitido" }, 405)

  const input = readJson(event)
  const q = query(event)
  const amount = parseInt(q.price_cents ?? input.price_cents ?? 6348, 10) || 0
  if (amount < 100) return json({ success: false, error: "Valor invalido" }, 400)

  const customer = input.customer && typeof input.customer === "object" ? input.customer : {}
  const name = String(customer.name ?? input.nome_pagador ?? "Nao Informado").trim() || "Nao Informado"
  const emailRaw = String(customer.email ?? input.email_pagador ?? "")
  const email = isValidEmail(emailRaw) ? emailRaw : "naoinformado@email.com"
  let cpf = String(customer.cpf ?? input.cpf_pagador ?? "11144477735").replace(/\D+/g, "")
  if (cpf.length !== 11) cpf = "11144477735"
  const phone = String(customer.phone ?? input.telefone_pagador ?? "").trim()
  const utm = storeUtmFromInput(input.utm && typeof input.utm === "object" ? input.utm : {})
  const produtoInput = String(input.produto ?? "").trim()
  const isReceita = amount === 5790 || produtoInput.toLowerCase().includes("receita")
  const produto = isReceita
    ? "Regularizacao CPF - Receita Federal"
    : produtoInput !== ""
      ? produtoInput
      : "Taxa de Inscricao"
  const cep = String(input.cep ?? "").replace(/\D+/g, "")
  const cidade = String(input.cidade ?? "").trim()
  const uf = String(input.uf ?? "").trim().toUpperCase()
  const cargo = String(input.cargo ?? "").trim()

  const body = {
    amount_cents: amount,
    method: "pix",
    product_id: env("BRAVOPAY_PRODUCT_ID"),
    description: "E-book Emagrecimento",
    external_reference: "pedido_" + crypto.randomBytes(8).toString("hex"),
    customer: { name, email, cpf },
    utm: utmEmpty(),
  }

  const [status, data] = await bravoRequest("POST", "/transactions", body)
  if (status < 200 || status >= 300) {
    return json(
      { success: false, error: String(data.message ?? data.error ?? "BravoPay recusou a transacao") },
      502,
    )
  }

  const pix = data.pix && typeof data.pix === "object" ? data.pix : {}
  const code = String(pix.copy_paste ?? pix.qr_code ?? data.pix_code ?? "")
  if (code === "") return json({ success: false, error: "BravoPay nao retornou o codigo PIX" }, 502)

  const transacaoId = String(data.id ?? "")
  let orderStatus = "waiting_payment"
  let existing = transacaoId !== "" ? await ordersFindByTx(transacaoId) : null
  if (existing === null && !isReceita) existing = await ordersFindByCpf(cpf, false)
  if (existing && !isReceita && ((existing.status ?? "") === "paid" || existing.marked_paid_by_admin)) {
    orderStatus = "paid"
  }

  try {
    await ordersUpsert({
      ...utm,
      transacao_id: transacaoId,
      status: orderStatus,
      nome: name,
      cpf,
      email,
      telefone: phone,
      cep,
      cidade,
      uf,
      cargo,
      produto,
      price_cents: amount,
      marked_paid_by_admin: !!(existing && existing.marked_paid_by_admin),
      paid_at: orderStatus === "paid" ? (existing && existing.paid_at) || storeNow() : null,
    })
  } catch {
    // PIX ja foi gerado; se o storage falhar o painel pode ficar sem o registro.
  }

  return json({
    success: true,
    pixCode: code,
    qrCode: String(pix.qr_code ?? code),
    transacao_id: transacaoId,
    status: String(data.status ?? "PENDING"),
  })
})
