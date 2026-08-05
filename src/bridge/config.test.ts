// config.test.ts — trava o comportamento crítico do registro de tenant em
// runtime. Rodar: pnpm test
//
// O que está sendo protegido aqui é sobretudo a PRECEDÊNCIA do env. A rota de
// registro é autenticada por um token único; se ela pudesse regravar o tenant
// "sac", um bot novo passaria a receber (e responder) o WhatsApp de produção do
// SAC. Nenhum desses testes é sobre estética de API.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOK_SAC = "tok-sac-de-producao-nao-toque";
const TOK_BOT = "tok-bot-runtime-1234567890";
const TOK_BOT2 = "tok-bot-runtime-rotacionado-99";

let dir: string;
let cfg: typeof import("./config");
let hub: typeof import("./hub");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "wagw-test-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ADMIN_USER = "t";
  process.env.ADMIN_PASSWORD = "t";
  process.env.BRIDGE_TENANTS = JSON.stringify({
    sac: {
      wsToken: TOK_SAC,
      channel: "whatsapp",
      config: { verifyToken: "v", phoneNumberId: "1", metaToken: "m" },
    },
  });
  // import dinâmico: o módulo lê o env no load, então o env tem que estar pronto.
  cfg = await import("./config");
  hub = await import("./hub");
});

after(() => rmSync(dir, { recursive: true, force: true }));

const teams = { appId: "a", appPassword: "p", tenantId: "t" };

test("tenant do env é encontrado e marcado como origem env", () => {
  assert.equal(cfg.tenant("sac")?.channel, "whatsapp");
  assert.equal(cfg.origemDoTenant("sac"), "env");
});

test("registra tenant de runtime e ele passa a existir na hora, sem restart", () => {
  const r = cfg.registrarTenant("bot-diretoria", "teams", TOK_BOT, teams);
  assert.equal(r.ok, true);
  assert.equal(r.status, 201);
  assert.equal(cfg.tenant("bot-diretoria")?.channel, "teams");
  assert.equal(cfg.tenantByWsToken(TOK_BOT), "bot-diretoria");
  assert.equal(cfg.origemDoTenant("bot-diretoria"), "runtime");
});

test("registrar de novo é idempotente (retry da plataforma não quebra)", () => {
  const r = cfg.registrarTenant("bot-diretoria", "teams", TOK_BOT, teams);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.criado, false);
});

test("NÃO deixa runtime sobrescrever tenant do env", () => {
  const r = cfg.registrarTenant("sac", "teams", "tok-invasor-1234567890", teams);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  // e o sac segue intacto
  assert.equal(cfg.tenant("sac")?.channel, "whatsapp");
  assert.equal(cfg.tenantByWsToken(TOK_SAC), "sac");
});

test("NÃO deixa remover tenant do env", () => {
  const r = cfg.removerTenant("sac");
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(cfg.tenant("sac")?.channel, "whatsapp");
});

test("NÃO deixa roubar o wsToken de um tenant do env", () => {
  const r = cfg.registrarTenant("bot-esperto", "teams", TOK_SAC, teams);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  // o token continua resolvendo pro sac, não pro bot
  assert.equal(cfg.tenantByWsToken(TOK_SAC), "sac");
});

test("NÃO deixa dois tenants de runtime com o mesmo wsToken", () => {
  const r = cfg.registrarTenant("bot-outro", "teams", TOK_BOT, teams);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test("recusa config de canal incompleta", () => {
  const r = cfg.registrarTenant("bot-torto", "teams", "tok-bot-torto-1234567890", { appId: "a" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.erro!, /appPassword/);
  assert.equal(cfg.tenant("bot-torto"), null);
});

test("recusa canal desconhecido", () => {
  const r = cfg.registrarTenant("bot-x", "telepatia", "tok-bot-x-1234567890abc", {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("recusa nome que viraria rota estranha", () => {
  for (const nome of ["../etc", "com barra/", "MAIUSCULA", "a", ""]) {
    const r = cfg.registrarTenant(nome, "teams", "tok-nome-ruim-1234567890", teams);
    assert.equal(r.ok, false, `aceitou nome inválido: ${JSON.stringify(nome)}`);
    assert.equal(r.status, 400);
  }
});

test("recusa wsToken curto", () => {
  const r = cfg.registrarTenant("bot-curto", "teams", "curto", teams);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("trocar o wsToken derruba a conexão autenticada com o antigo", () => {
  // Socket de mentira: só precisa de close() e readyState pro hub.
  let fechado = false;
  const fake: any = { readyState: 1, close: () => (fechado = true), terminate: () => (fechado = true), send: () => {} };
  hub.bridgeHub.registrar("bot-diretoria", fake);
  assert.equal(hub.bridgeHub.status()["bot-diretoria"], 1);

  const r = cfg.registrarTenant("bot-diretoria", "teams", TOK_BOT2, teams);
  assert.equal(r.ok, true);
  assert.equal(fechado, true, "conexão com o token antigo continuou aberta");
  assert.equal(hub.bridgeHub.status()["bot-diretoria"], undefined);
  // token antigo não autentica mais; o novo sim
  assert.equal(cfg.tenantByWsToken(TOK_BOT), null);
  assert.equal(cfg.tenantByWsToken(TOK_BOT2), "bot-diretoria");
});

test("remover derruba a ponte e o tenant deixa de existir", () => {
  let fechado = false;
  const fake: any = { readyState: 1, close: () => (fechado = true), terminate: () => {}, send: () => {} };
  hub.bridgeHub.registrar("bot-diretoria", fake);

  const r = cfg.removerTenant("bot-diretoria");
  assert.equal(r.ok, true);
  assert.equal(fechado, true, "ponte seguiu aberta depois de remover o tenant");
  assert.equal(cfg.tenant("bot-diretoria"), null);
  assert.equal(cfg.tenantByWsToken(TOK_BOT2), null);
});

test("remover tenant inexistente é 404", () => {
  assert.equal(cfg.removerTenant("nunca-existiu").status, 404);
});

test("sobrevive a restart: recarrega do banco", () => {
  cfg.registrarTenant("bot-persistente", "teams", "tok-persistente-1234567890", teams);
  cfg._recarregar(); // simula o boot lendo a tabela
  assert.equal(cfg.tenant("bot-persistente")?.channel, "teams");
  assert.equal(cfg.tenantByWsToken("tok-persistente-1234567890"), "bot-persistente");
});

test("listagem não vaza wsToken nem segredo de canal", () => {
  const serial = JSON.stringify(cfg.listarTenants());
  assert.ok(!serial.includes("tok-"), "wsToken apareceu na listagem");
  assert.ok(!serial.includes("appPassword"), "segredo de canal apareceu na listagem");
  assert.ok(serial.includes("bot-persistente"));
  assert.ok(serial.includes("sac"));
});
