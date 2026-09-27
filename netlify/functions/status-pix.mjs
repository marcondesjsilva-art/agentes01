import { json, query, wrap } from "./_lib/http.mjs"
import { bravoRequest } from "./_lib/bravo.mjs"
import { ordersFindByTx, ordersMarkPaid } from "./_lib/store.mjs"

// Consulta status do PIX. Porta de status-pix.php.
export const handler = wrap(async (event) => {
  const id = String(query(event).id ?? "").trim()
  if (id === "") return json({ success: false, error: "ID da transacao obrigatorio" }, 400)

  try {
    const stored = await ordersFindByTx(id)
    if (stored && ((stored.status ?? "") === "paid" || stored.marked_paid_by_admin)) {
      return json({
        success: true,
        status: "APPROVED",
        transacao_id: id,
        source: stored.marked_paid_by_admin ? "admin" : "store",
      })
    }
  } catch {
    // Se o storage falhar, ainda tenta o BravoPay.
  }

  const [status, data] = await bravoRequest("GET", "/transactions/" + encodeURIComponent(id))
  if (status < 200 || status >= 300) {
    return json({ success: false, error: "Transacao nao encontrada" }, status === 404 ? 404 : 502)
  }

  const raw = String(data.status ?? "PENDING").toUpperCase()
  const mapped = ["PAID", "APPROVED", "COMPLETED", "SUCCEEDED"].includes(raw)
    ? "APPROVED"
    : ["CANCELED", "CANCELLED", "EXPIRED", "FAILED"].includes(raw)
      ? "CANCELED"
      : "PENDING"

  if (mapped === "APPROVED") {
    try {
      await ordersMarkPaid(id, false)
    } catch {
      // Status ja confirmado no gateway.
    }
  }

  return json({ success: true, status: mapped, transacao_id: String(data.id ?? id) })
})
