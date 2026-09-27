// Le uma variavel de ambiente. Retorna o default se estiver vazia/ausente.
export function env(name, def = "") {
  const v = process.env[name]
  return v === undefined || v === null || v === "" ? def : v
}
