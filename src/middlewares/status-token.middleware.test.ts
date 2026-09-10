// status-token.middleware.test.ts — o /status expõe nome de sessão, estado e
// telefone conectado. O erro caro aqui não é vazamento: é fail-open silencioso.
// Se a rota respondesse 200 vazio sem token configurado, o Gatus ficaria verde
// monitorando nada — que é a falha exata que estes endpoints existem para
// impedir. Por isso "sem token" tem que ser 503 (alto), não 200 (mudo).

import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { statusTokenMiddleware, tokenMatches } from "./status-token.middleware";

const TOKEN = "a".repeat(32);

function appComToken(expected: string) {
  const app = new Hono();
  app.use("*", statusTokenMiddleware(expected));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

test("sem STATUS_TOKEN configurado responde 503 — fail-closed e barulhento, para o monitoramento alertar", async () => {
  const r = await appComToken("").request("/");

  assert.equal(r.status, 503);
  assert.notEqual(r.status, 200);
});

test("sem header Authorization responde 401", async () => {
  const r = await appComToken(TOKEN).request("/");

  assert.equal(r.status, 401);
});

test("token errado responde 401", async () => {
  const r = await appComToken(TOKEN).request("/", {
    headers: { Authorization: `Bearer ${"b".repeat(32)}` },
  });

  assert.equal(r.status, 401);
});

test("token de tamanho diferente responde 401 e não estoura — timingSafeEqual exige buffers iguais", async () => {
  const r = await appComToken(TOKEN).request("/", {
    headers: { Authorization: "Bearer curto" },
  });

  assert.equal(r.status, 401);
});

test("esquema errado (Basic em vez de Bearer) responde 401", async () => {
  const r = await appComToken(TOKEN).request("/", {
    headers: { Authorization: `Basic ${TOKEN}` },
  });

  assert.equal(r.status, 401);
});

test("token correto passa", async () => {
  const r = await appComToken(TOKEN).request("/", {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("tokenMatches nao aceita prefixo — comparacao e do valor inteiro", () => {
  assert.equal(tokenMatches("abc", "abcdef"), false);
  assert.equal(tokenMatches("abcdef", "abcdef"), true);
});
