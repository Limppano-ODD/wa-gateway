// logout.test.ts — o logoff do painel é frágil por natureza: ele não depende de
// invalidar sessão no servidor (não existe sessão), depende de UM header em UM
// status. Se o status deixar de ser 401, ou se o realm divergir do realm do
// basicAuthMiddleware, o botão "Sair" continua clicável e simplesmente não
// desloga — e o sintoma aparece só na hora de trocar de usuário para re-parear
// uma sessão do WhatsApp. É isso que estes testes travam.
//
// Usa `app.request()` do Hono — não sobe servidor, não abre porta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { BASIC_REALM, createLogoutController } from "./logout";

const REALM = 'Basic realm="WA Gateway"';

// Monta como o index.ts monta, para o teste cobrir também o caminho /logout e
// não só a rota interna "/" do controller.
const app = new Hono();
app.route("/logout", createLogoutController());

test("GET /logout responde 401 — é o 401 que faz o browser descartar a credencial", async () => {
  const r = await app.request("/logout");

  assert.equal(r.status, 401);
});

test("GET /logout devolve WWW-Authenticate com o realm exato do Basic auth", async () => {
  const r = await app.request("/logout");

  assert.equal(r.headers.get("WWW-Authenticate"), REALM);
});

test("realm do logout é o MESMO usado pelo basicAuthMiddleware", async () => {
  // Comparado contra o fonte do middleware de propósito: importá-lo puxaria
  // banco (better-sqlite3) e env só para ler uma string. O que precisa ficar
  // travado é a igualdade — realm diferente = logoff que não limpa nada.
  const middleware = readFileSync(
    join(__dirname, "../middlewares/auth.middleware.ts"),
    "utf-8"
  );

  assert.equal(BASIC_REALM, REALM);
  assert.ok(
    middleware.includes(REALM),
    "auth.middleware.ts não emite mais o realm 'WA Gateway'; o logout ficou órfão"
  );
});

test("GET /logout NÃO exige credencial: sem Authorization ainda entrega a página", async () => {
  const r = await app.request("/logout");
  const body = await r.text();

  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  assert.match(body, /Sessão encerrada/);
});

test("GET /logout ignora credencial enviada e responde igual", async () => {
  const r = await app.request("/logout", {
    headers: { authorization: `Basic ${Buffer.from("u:p").toString("base64")}` },
  });

  assert.equal(r.status, 401);
  assert.equal(r.headers.get("WWW-Authenticate"), REALM);
});

test("página do logout tem volta para / e a saída de emergência (janela anônima)", async () => {
  const r = await app.request("/logout");
  const body = await r.text();

  assert.match(body, /href="\/"/);
  assert.match(body, /anônima/);
});
