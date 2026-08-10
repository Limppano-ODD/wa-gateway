/**
 * Decide se quem acabou de logar é admin — e por qual caminho.
 *
 * Pura de propósito: sem rede, sem banco, sem env. É a regra que separa "vê o
 * painel" de "não vê", e regra de autorização que só dá para testar subindo o
 * mundo inteiro não é testada de verdade.
 */

export type AdminVia = "group" | "breakglass";

export type AdminDecision = {
  isAdmin: boolean;
  via: AdminVia | null;
  /** `wids` que concedeu o acesso, quando foi por break-glass. Vai pra auditoria. */
  wid: string | null;
};

export type ClaimsRelevantes = {
  /** Claim `groups` do token (ids de grupo de segurança). */
  groups?: unknown;
  /** Claim `wids` do token (ids de template de papel de diretório). */
  wids?: unknown;
};

function comoListaMinuscula(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Ordem importa: o grupo vem primeiro. Quem está no grupo dedicado é admin
 * pelo caminho normal, e não deve ser registrado como break-glass só porque
 * também é Global Admin do tenant — senão a auditoria de break-glass enche de
 * ruído e para de significar "alguém entrou pela porta dos fundos".
 */
export function decidirAdmin(
  claims: ClaimsRelevantes,
  adminGroupId: string,
  breakglassWids: string[]
): AdminDecision {
  const grupos = comoListaMinuscula(claims.groups);
  const grupoAdmin = adminGroupId.trim().toLowerCase();

  if (grupoAdmin && grupos.includes(grupoAdmin)) {
    return { isAdmin: true, via: "group", wid: null };
  }

  const papeis = comoListaMinuscula(claims.wids);
  const permitidos = breakglassWids.map((w) => w.toLowerCase());
  const achado = papeis.find((p) => permitidos.includes(p));

  if (achado) {
    return { isAdmin: true, via: "breakglass", wid: achado };
  }

  return { isAdmin: false, via: null, wid: null };
}

/**
 * O claim `groups` some do token quando a pessoa está em grupos demais: o
 * Entra troca a lista por `_claim_names`/`_claim_sources` (overage) e manda
 * buscar no Graph. Sem tratar isso, um admin legítimo em muitos grupos é
 * silenciosamente rebaixado — e o sintoma é "não sou mais admin, e ninguém
 * mudou nada".
 *
 * Não resolvemos a consulta ao Graph aqui; detectamos para poder registrar e
 * para o break-glass continuar sendo o caminho de saída (papel de diretório
 * vem em `wids`, que não sofre overage do mesmo jeito).
 */
export function temOverageDeGrupos(payload: Record<string, unknown>): boolean {
  return (
    !Array.isArray(payload.groups) &&
    (!!payload._claim_names || !!payload._claim_sources)
  );
}
