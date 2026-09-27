import { json, readJson, wrap } from "./_lib/http.mjs"
import { storeUtmFromInput, visitsInsert, storeDriver } from "./_lib/store.mjs"

// Registra visita. Porta de track.php.
export const handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") return json({ success: false, error: "Metodo nao permitido" }, 405)

  const input = readJson(event)
  const mapped = storeUtmFromInput(input.utm && typeof input.utm === "object" ? input.utm : {})

  try {
    const visit = await visitsInsert({
      session_id: String(input.session_id ?? "").trim(),
      page: String(input.page ?? "landing").trim() || "landing",
      utm_source: mapped.utm_source,
      utm_campaign: mapped.utm_campaign,
      utm_keyword: mapped.utm_keyword !== "" ? mapped.utm_keyword : mapped.utm_term,
      utm_campaign_name: mapped.utm_campaign_name,
    })
    return json({ success: true, id: String(visit.id ?? ""), driver: storeDriver() })
  } catch (e) {
    return json({ success: false, error: e?.message || "Erro ao registrar visita" }, 500)
  }
})
