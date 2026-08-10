import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { authDb, type User } from "../database/db";
import { env, entraConfigurado } from "../env";
import { basicAuthMiddleware } from "./auth.middleware";
import { COOKIE_SESSAO } from "../controllers/auth";

/**
 * Autenticação de HUMANO no browser: sessão do Entra primeiro, Basic depois.
 *
 * O Basic continua valendo enquanto `AUTH_ALLOW_BASIC_FALLBACK` for true. Isso
 * é a rede de segurança da transição, e é deliberado: se o Entra ficar fora do
 * ar (ou a secret vencer), o painel não pode ficar inacessível justamente
 * quando alguém precisa re-parear uma sessão do WhatsApp. Vira false na Fase 4,
 * depois que o login Microsoft estiver provado em uso real.
 *
 * NÃO se aplica às rotas de máquina (/message, /profile, /session): aquelas são
 * chamadas por CRM, data-gateway e agent-platform com credencial de serviço.
 */

/**
 * Usuário virtual para quem entrou pelo Entra. Existe para os controllers já
 * escritos continuarem lendo `c.get("user")` sem mudança.
 *
 * `id: -2` marca "veio do Entra" (o admin virtual do Basic usa -1). Nenhum dos
 * dois existe na tabela `users`, e é por isso que este middleware NÃO serve
 * para o /dashboard: lá o código usa `user.username` como NOME DA SESSÃO do
 * WhatsApp, e o e-mail de uma pessoa não é nome de sessão nenhuma. Desacoplar
 * isso é a Fase 2.
 */
function usuarioVirtualDoEntra(username: string, isAdmin: boolean): User {
  return {
    id: -2,
    username,
    password: "",
    is_admin: isAdmin ? 1 : 0,
    session_name: null,
    callback_url: null,
    webhook_auth_type: null,
    webhook_auth_username: null,
    webhook_auth_password: null,
    webhook_auth_token_url: null,
    webhook_auth_token: null,
    webhook_auth_token_expiration: null,
    webhook_oauth_format: null,
    created_at: new Date().toISOString(),
  };
}

/** Browser pedindo página ganha redirect para o login; API ganha 401. */
function querHtml(accept: string | undefined): boolean {
  return (accept ?? "").includes("text/html");
}

export const humanAuthMiddleware = () =>
  createMiddleware(async (c, next) => {
    const cookie = getCookie(c, COOKIE_SESSAO);

    if (cookie) {
      const sessao = authDb.getLiveSession(cookie, new Date());
      if (sessao) {
        const pessoa = authDb.getPerson(sessao.person_oid);
        c.set(
          "user",
          usuarioVirtualDoEntra(
            pessoa?.email ?? sessao.person_oid,
            sessao.is_admin === 1
          )
        );
        return next();
      }
    }

    if (env.AUTH_ALLOW_BASIC_FALLBACK) {
      // Delega para o Basic de sempre. Ele mesmo devolve 401 com
      // WWW-Authenticate quando a credencial falta ou não confere.
      return basicAuthMiddleware()(c, next);
    }

    if (!entraConfigurado) {
      return c.json(
        {
          error:
            "Login Microsoft não configurado e fallback Basic desligado — ninguém consegue entrar",
        },
        503
      );
    }

    if (querHtml(c.req.header("Accept"))) {
      return c.redirect("/auth/login");
    }

    return c.json({ error: "Unauthorized" }, 401);
  });
