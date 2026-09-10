import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { authDb } from "../database/db";
import { env, entraConfigurado } from "../env";
import {
  gerarPkce,
  gerarState,
  montarUrlDeLogin,
  trocarCodePorClaims,
} from "../auth/entra";
import { decidirAdmin, temOverageDeGrupos } from "../auth/roles";

/**
 * Login Microsoft (Entra ID) para humano no browser.
 *
 * Vale só para as rotas humanas. `/message`, `/profile` e `/session` continuam
 * em Basic com credencial de serviço — são chamadas por CRM, data-gateway e
 * agent-platform, e trocar a autenticação delas exigiria deploy coordenado dos
 * três ao mesmo tempo.
 */

export const COOKIE_SESSAO = "wa_session";
const COOKIE_STATE = "wa_oauth_state";
const COOKIE_VERIFIER = "wa_oauth_verifier";

const redirectUri = () => `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/callback`;

const seguro = () => env.NODE_ENV === "PRODUCTION";

function pagina(arquivo: string): string {
  return readFileSync(join(__dirname, "..", "views", arquivo), "utf-8");
}

export const createAuthController = () => {
  const app = new Hono();

  app.get("/login", (c) => {
    if (!entraConfigurado) {
      return c.json(
        { error: "Login Microsoft não configurado neste ambiente" },
        503
      );
    }

    const state = gerarState();
    const { verifier, challenge } = gerarPkce();

    // State e verifier vivem em cookie HttpOnly de vida curta. O state volta
    // pela query e é comparado com o do cookie: sem isso, qualquer um monta um
    // callback e faz o browser da vítima trocar um code que não é dela.
    const opcoes = {
      httpOnly: true,
      secure: seguro(),
      sameSite: "Lax" as const,
      path: "/",
      maxAge: 600,
    };
    setCookie(c, COOKIE_STATE, state, opcoes);
    setCookie(c, COOKIE_VERIFIER, verifier, opcoes);

    return c.redirect(montarUrlDeLogin(redirectUri(), state, challenge));
  });

  app.get("/callback", async (c) => {
    if (!entraConfigurado) {
      return c.json({ error: "Login Microsoft não configurado" }, 503);
    }

    const erroEntra = c.req.query("error_description") ?? c.req.query("error");
    if (erroEntra) {
      authDb.recordAuthEvent({ event: "login_falhou", method: "entra", detail: erroEntra });
      return c.json({ error: `Entra recusou o login: ${erroEntra}` }, 401);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateEsperado = getCookie(c, COOKIE_STATE);
    const verifier = getCookie(c, COOKIE_VERIFIER);

    deleteCookie(c, COOKIE_STATE, { path: "/" });
    deleteCookie(c, COOKIE_VERIFIER, { path: "/" });

    if (!code || !state || !stateEsperado || state !== stateEsperado || !verifier) {
      authDb.recordAuthEvent({
        event: "login_falhou",
        method: "entra",
        detail: "state ou verifier ausente/divergente",
      });
      return c.json({ error: "Requisição de login inválida" }, 400);
    }

    let claims;
    try {
      claims = await trocarCodePorClaims(code, redirectUri(), verifier);
    } catch (err) {
      const detalhe = err instanceof Error ? err.message : String(err);
      authDb.recordAuthEvent({ event: "login_falhou", method: "entra", detail: detalhe });
      return c.json({ error: `Falha ao validar o login: ${detalhe}` }, 401);
    }

    const decisao = decidirAdmin(
      claims,
      env.AZURE_AD_ADMIN_GROUP_ID,
      env.ENTRA_BREAKGLASS_WIDS
    );

    // Primeiro login registra a pessoa e NADA MAIS. Acesso é concedido por
    // admin, nunca automaticamente: auto-provisionar significaria que qualquer
    // pessoa do tenant entra e opera o WhatsApp corporativo.
    authDb.upsertPerson(claims.oid, claims.email, claims.name);

    if (temOverageDeGrupos(claims.bruto)) {
      // Sintoma perverso: admin legítimo é rebaixado sem ninguém ter mudado
      // nada. Registrado para o diagnóstico não começar do zero.
      authDb.recordAuthEvent({
        email: claims.email,
        oid: claims.oid,
        event: "grupos_em_overage",
        method: "entra",
        detail: "claim groups substituida por _claim_names (muitos grupos); grupo admin nao verificavel pelo token",
      });
    }

    if (!decisao.isAdmin) {
      authDb.recordAuthEvent({
        email: claims.email,
        oid: claims.oid,
        event: "login_sem_acesso",
        method: "entra",
      });
      return c.html(pagina("sem-acesso.html"), 403);
    }

    const id = randomBytes(32).toString("base64url");
    const expiraEm = new Date(Date.now() + env.WEB_SESSION_HOURS * 3_600_000);
    authDb.createSession(id, claims.oid, true, decisao.via, expiraEm);

    // Break-glass loga ALTO, em evento próprio e em stdout: caminho
    // privilegiado silencioso é backdoor. Entrar pelo grupo é rotina; entrar
    // por papel de diretório do tenant é exceção e tem que aparecer.
    authDb.recordAuthEvent({
      email: claims.email,
      oid: claims.oid,
      event: decisao.via === "breakglass" ? "login_breakglass" : "login_ok",
      method: "entra",
      detail: decisao.wid,
    });
    if (decisao.via === "breakglass") {
      console.warn(
        JSON.stringify({
          tag: "wa_auth",
          event: "breakglass",
          email: claims.email,
          wid: decisao.wid,
        })
      );
    }

    setCookie(c, COOKIE_SESSAO, id, {
      httpOnly: true,
      secure: seguro(),
      sameSite: "Lax",
      path: "/",
      maxAge: env.WEB_SESSION_HOURS * 3600,
    });

    return c.redirect("/admin");
  });

  app.get("/logout", (c) => {
    const id = getCookie(c, COOKIE_SESSAO);
    if (id) {
      // Apaga a linha, não só o cookie: sessão que vive no banco pode ser
      // derrubada de verdade, que é o ponto de não usar JWT no cookie.
      authDb.deleteSession(id);
    }
    deleteCookie(c, COOKIE_SESSAO, { path: "/" });
    return c.redirect("/");
  });

  /** Introspecção — útil para diagnosticar "por que não sou admin?". */
  app.get("/me", (c) => {
    const id = getCookie(c, COOKIE_SESSAO);
    const sessao = id ? authDb.getLiveSession(id, new Date()) : undefined;

    if (!sessao) {
      return c.json({ autenticado: false, entra_configurado: entraConfigurado });
    }

    const pessoa = authDb.getPerson(sessao.person_oid);
    return c.json({
      autenticado: true,
      email: pessoa?.email ?? null,
      nome: pessoa?.name ?? null,
      is_admin: sessao.is_admin === 1,
      admin_via: sessao.admin_via,
      expira_em: sessao.expires_at,
    });
  });

  return app;
};
