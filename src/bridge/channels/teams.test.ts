// Quebra de resposta longa. Nasceu de um caso real: o agente respondeu uma lista
// de vendedores, o POST pro Teams morreu, e a pessoa não recebeu nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partirTexto } from "./teams.js";

test("texto curto vai inteiro, numa mensagem só", () => {
  assert.deepEqual(partirTexto("oi"), ["oi"]);
});

test("texto vazio vira aviso, não mensagem em branco", () => {
  assert.deepEqual(partirTexto(""), ["(sem resposta)"]);
});

test("texto longo é partido e nada se perde", () => {
  const linhas = Array.from({ length: 400 }, (_, i) => `${i}. Vendedor Fulano de Tal — divisional RJ`);
  const texto = linhas.join("\n");
  const partes = partirTexto(texto, 500);
  assert.ok(partes.length > 1, "não partiu");
  for (const p of partes) assert.ok(p.length <= 500, `parte grande demais: ${p.length}`);
  // O conteúdo tem que sobreviver: toda linha continua presente em alguma parte.
  const junto = partes.join("\n");
  for (const l of linhas) assert.ok(junto.includes(l), `perdeu a linha: ${l}`);
});

test("corta em parágrafo quando dá, pra não partir tabela no meio", () => {
  const texto = "bloco um".padEnd(300, ".") + "\n\n" + "bloco dois".padEnd(300, ".");
  const partes = partirTexto(texto, 400);
  assert.equal(partes.length, 2);
  assert.ok(partes[0]?.startsWith("bloco um"));
  assert.ok(partes[1]?.startsWith("bloco dois"));
});

// Envio por pessoa (agent-platform#166): a ponte abre o chat 1:1 do bot.
import { aadObjectIdValido, corpoCriarConversa, SERVICE_URL_TEAMS } from "./teams.js";

test("aceita só aadObjectId no formato de GUID", () => {
  assert.ok(aadObjectIdValido("5ef79d00-1cbc-4987-a3fd-fac32b6062a0"));
  assert.ok(!aadObjectIdValido(""));
  assert.ok(!aadObjectIdValido("29:1abc"));
  assert.ok(!aadObjectIdValido("5ef79d00-1cbc-4987-a3fd-fac32b6062a0/../x"));
});

test("pedido de chat 1:1 leva o bot, a pessoa e o tenant", () => {
  const c = corpoCriarConversa("app-1", "tenant-1", "5ef79d00-1cbc-4987-a3fd-fac32b6062a0");
  assert.deepEqual(c.bot, { id: "28:app-1" });
  assert.deepEqual(c.members, [{ id: "5ef79d00-1cbc-4987-a3fd-fac32b6062a0" }]);
  assert.equal(c.tenantId, "tenant-1");
  assert.deepEqual(c.channelData, { tenant: { id: "tenant-1" } });
  assert.equal(c.isGroup, false);
});

test("serviceUrl de conversa nova termina em barra (a URL é montada por concatenação)", () => {
  assert.ok(SERVICE_URL_TEAMS.endsWith("/"));
});
