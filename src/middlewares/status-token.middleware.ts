import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "crypto";

/**
 * Guard dos endpoints de status. Recebe o token esperado por parâmetro em vez
 * de ler o env direto: assim dá para testar os três caminhos (desligado, token
 * errado, token certo) sem carregar `env`, sqlite e baileys junto.
 */

export function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual exige buffers do mesmo tamanho. Comparar o tamanho antes
  // revela o comprimento do token — informação sem valor ofensivo relevante.
  return a.length === b.length && timingSafeEqual(a, b);
}

export const statusTokenMiddleware = (expectedToken: string) =>
  createMiddleware(async (c, next) => {
    // Fail-closed, mas ALTO: sem token configurado a rota devolve 503 e o
    // monitoramento alerta. Devolver 200 vazio recriaria exatamente o problema
    // que estes endpoints existem para resolver — um verde que não diz nada.
    if (!expectedToken) {
      return c.json(
        { error: "STATUS_TOKEN não configurado — endpoint de status desligado" },
        503
      );
    }

    const header = c.req.header("Authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!provided || !tokenMatches(provided, expectedToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    await next();
  });
