import { json, readJson, wrap } from "./_lib/http.mjs"
import {
  storeUtmFromInput,
  ordersFindByTx,
  ordersFindByCpf,
  ordersUpsert,
  storeUuid,
  storeNow,
  storeDriver,
} from "./_lib/store.mjs"

// Sincroniza/atualiza um pedido. Porta de order-sync.php.
export const handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") return json({ success: false, error: "Metodo nao permitido" }, 405)

  const input = readJson(event)
  const transacaoIdInput = String(input.transacao_id ?? "").trim()
  const cpf = String(input.cpf ?? "").replace(/\D+/g, "")
  if (transacaoIdInput === "" && cpf.length !== 11) {
    return json({ success: false, error: "informe o CPF do cadastro ou o ID da transacao" }, 400)
  }

  const utm = storeUtmFromInput(input.utm && typeof input.utm === "object" ? input.utm : {})
  const priceCents = parseInt(input.price_cents ?? 6348, 10) || 6348
  const produto = String(input.produto ?? "").trim()
  const isReceita = priceCents === 5790 || produto.toLowerCase().includes("receita")

  let existing = transacaoIdInput !== "" ? await ordersFindByTx(transacaoIdInput) : null
  if (existing === null && cpf.length === 11 && !isReceita) {
    existing = await ordersFindByCpf(cpf, false)
  }

  let transacaoId = transacaoIdInput
  if (transacaoId === "") {
    transacaoId = String((existing && existing.transacao_id) || "lead_" + cpf).trim()
  }

  let status = String(input.status ?? (existing && existing.status) ?? "waiting_payment")
  if (existing && ((existing.status ?? "") === "paid" || existing.marked_paid_by_admin)) {
    status = "paid"
  }

  try {
    const prev = existing ?? {}
    const order = await ordersUpsert({
      ...utm,
      id: String(prev.id ?? storeUuid()),
      created_at: String(prev.created_at ?? storeNow()),
      transacao_id: transacaoId,
      status,
      nome: String(input.nome ?? prev.nome ?? "").trim(),
      cpf: String(input.cpf ?? prev.cpf ?? "").replace(/\D+/g, ""),
      email: String(input.email ?? prev.email ?? "").trim(),
      telefone: String(input.telefone ?? prev.telefone ?? "").trim(),
      cep: String(input.cep ?? prev.cep ?? "").replace(/\D+/g, ""),
      cidade: String(input.cidade ?? prev.cidade ?? "").trim(),
      uf: String(input.uf ?? prev.uf ?? "").trim().toUpperCase(),
      cargo: String(input.cargo ?? prev.cargo ?? "").trim(),
      produto: String(input.produto ?? prev.produto ?? "Taxa de Inscricao").trim(),
      price_cents: parseInt(input.price_cents ?? prev.price_cents ?? 6348, 10) || 6348,
      marked_paid_by_admin: !!(prev && prev.marked_paid_by_admin),
      paid_at: status === "paid" ? prev.paid_at ?? storeNow() : prev.paid_at ?? null,
    })
    return json({ success: true, order, driver: storeDriver() })
  } catch (e) {
    return json({ success: false, error: e?.message || "Erro ao sincronizar" }, 500)
  }
})
