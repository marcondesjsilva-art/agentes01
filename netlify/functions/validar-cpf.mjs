import { json, readJson, wrap } from "./_lib/http.mjs"
import { env } from "./_lib/env.mjs"

// Consulta de CPF na Apela. Porta de validar-cpf.php.
export const handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") return json({ success: false, error: "Metodo nao permitido" }, 405)

  const cpf = String(readJson(event).cpf ?? "").replace(/\D+/g, "")
  if (cpf.length !== 11) return json({ success: false, error: "CPF invalido" }, 400)

  const token = env("APELA_USER_TOKEN")
  if (!token) return json({ success: false, error: "APELA_USER_TOKEN nao configurado" }, 500)

  const url = `https://api-apela.online/?user=${encodeURIComponent(token)}&cpf=${encodeURIComponent(cpf)}`
  let status = 502
  let data = null
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) })
    status = res.status
    const text = await res.text()
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  } catch {
    data = null
  }

  if (
    !data ||
    typeof data !== "object" ||
    status < 200 ||
    status >= 300 ||
    Number(data.status ?? 0) !== 200 ||
    !data.nome
  ) {
    return json({ success: false, error: String((data && data.message) || "CPF nao encontrado") }, 502)
  }

  return json({
    success: true,
    dados_originais: {
      cpf,
      nome: String(data.nome ?? ""),
      nome_mae: String(data.mae ?? ""),
      data_nascimento: String(data.nascimento ?? ""),
      sexo: String(data.sexo ?? ""),
    },
  })
})
