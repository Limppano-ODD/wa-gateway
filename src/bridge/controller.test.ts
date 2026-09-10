// controller.test.ts — testes nas ROTAS HTTP de administração de tenant.
//
// Separado de config.test.ts de propósito: lá o alvo é a lógica de precedência
// e revogação; aqui é a camada que decide 401/429/503/413 ANTES de qualquer
// lógica de negócio rodar. Um erro aqui abre a porta sem nem chegar nas regras
// que o outro arquivo protege.
//
// Usa `app.request()` do Hono — não sobe servidor, não abre porta.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ADMIN = "tok-admin-de-teste-com-tamanho-suficiente";
const TOK_ENV = "tok-sac-de-producao-nao-toque";

let dir: string;
let app: any;

const teams = { appId: "app-1", appPassword: "p", tenantId: "t" };

function put(nome: string, corpo: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(`/bridge/tenants/${nome}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(corpo),
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "wagw-ctrl-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ADMIN_USER = "t";
  process.env.ADMIN_PASSWORD = "t";
  process.env.BRIDGE_ADMIN_TOKEN = ADMIN;
  process.env.BRIDGE_TENANTS = JSON.stringify({
    sac: {
      wsToken: TOK_ENV,
      channel: "whatsapp",
      config: { verifyToken: "v", phoneNumberId: "1", metaToken: "m" },
    },
  });
  const { createBridgeController } = await import("./controller");
  app = createBridgeController();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("PUT sem token é 401", async () => {
  const r = await put("bot-a", { channel: "teams", wsToken: "tok-a-1234567890abcdef", config: teams });
  assert.equal(r.status, 401);
});

test("PUT com token errado é 401", async () => {
  const r = await put("bot-a", { channel: "teams", wsToken: "tok-a-1234567890abcdef", config: teams }, "errado");
  assert.equal(r.status, 401);
});

test("PUT com token certo cria (201)", async () => {
  const r = await put("bot-a", { channel: "teams", wsToken: "tok-a-1234567890abcdef", config: teams }, ADMIN);
  assert.equal(r.status, 201);
  assert.equal((await r.json()).criado, true);
});

test("corpo acima de 16KB é 413, antes de parsear", async () => {
  const gigante = { channel: "teams", wsToken: "tok-big-1234567890abcdef", config: { ...teams, appId: "x".repeat(20_000) } };
  const r = await put("bot-big", gigante, ADMIN);
  assert.equal(r.status, 413);
});

test("corpo que não é objeto JSON é 400", async () => {
  const r = await app.request("/bridge/tenants/bot-arr", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify(["não", "é", "objeto"]),
  });
  assert.equal(r.status, 400);
});

test("tentar sobrescrever tenant do env é 409 pela rota", async () => {
  const r = await put("sac", { channel: "teams", wsToken: "tok-inv-1234567890abcdef", config: teams }, ADMIN);
  assert.equal(r.status, 409);
});

test("GET /bridge/status sem token não revela nomes de tenant", async () => {
  const body = await (await app.request("/bridge/status")).json();
  assert.equal(typeof body.tenants_conectados, "number");
  assert.equal(body.tenants_online, undefined, "expôs o mapa nome→conexões sem auth");
  assert.ok(!JSON.stringify(body).includes("sac"), "vazou nome de tenant");
});

test("GET /bridge/status com token traz o detalhe", async () => {
  const r = await app.request("/bridge/status", { headers: { authorization: `Bearer ${ADMIN}` } });
  const body = await r.json();
  assert.ok(body.tenants_online, "não trouxe o detalhe pra quem tem token");
});

test("GET /bridge/tenants não devolve segredo", async () => {
  const r = await app.request("/bridge/tenants", { headers: { authorization: `Bearer ${ADMIN}` } });
  const texto = JSON.stringify(await r.json());
  assert.ok(!texto.includes("tok-"), "vazou wsToken");
  assert.ok(!texto.includes("appPassword"), "vazou segredo de canal");
});

// A ordem "confere token → depois olha bloqueio" é o ponto do teste abaixo.
// Invertida, alguém errando de propósito 10 vezes trancaria o control-plane por
// um minuto — e atrás de proxy/NAT todos vêm do mesmo IP, então o freio contra
// força-bruta viraria uma negação de serviço trivial sobre criar bot.
test("força-bruta é freada em 429, mas o token válido continua passando", async () => {
  const ip = { "x-forwarded-for": "10.9.9.9" };
  const errar = () =>
    app.request("/bridge/tenants", { headers: { ...ip, authorization: "Bearer token-errado-qualquer" } });

  const codigos: number[] = [];
  for (let i = 0; i < 12; i++) codigos.push((await errar()).status);

  assert.ok(codigos.slice(0, 10).every((c) => c === 401), `esperava 401 nas primeiras: ${codigos}`);
  assert.ok(codigos.slice(10).every((c) => c === 429), `esperava 429 depois do limite: ${codigos}`);

  const legitimo = await app.request("/bridge/tenants", {
    headers: { ...ip, authorization: `Bearer ${ADMIN}` },
  });
  assert.equal(legitimo.status, 200, "o freio trancou o cliente legítimo do mesmo IP");
});

test("IP diferente não herda o bloqueio de outro", async () => {
  const r = await app.request("/bridge/tenants", {
    headers: { "x-forwarded-for": "10.1.1.1", authorization: "Bearer token-errado-qualquer" },
  });
  assert.equal(r.status, 401, "bloqueio vazou entre IPs");
});
