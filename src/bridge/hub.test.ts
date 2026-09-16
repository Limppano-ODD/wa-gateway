// hub.test.ts — histórico de transições do bridge. Weslan pediu (15/09/2026)
// depois de precisar caçar "por que esse bot ficou instável" na mão via SSH +
// docker logs — sem isso a tela admin não teria o que mostrar.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventoConexao } from "./hub";

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  send(payload: string) {
    this.sent.push(payload);
  }
}

function primeiro(eventos: EventoConexao[]): EventoConexao {
  const e = eventos[0];
  assert.ok(e, "esperava pelo menos 1 evento no histórico");
  return e;
}

test("registrar gera evento 'conectou' com a contagem de pontes certa", async () => {
  const { bridgeHub } = await import("./hub");
  const s = new FakeSocket();
  bridgeHub.registrar("app-x", s as any);
  const ultimo = primeiro(bridgeHub.historico());
  assert.equal(ultimo.app, "app-x");
  assert.equal(ultimo.evento, "conectou");
  assert.equal(ultimo.pontesRestantes, 1);
  bridgeHub.remover("app-x", s as any);
});

test("remover gera evento 'saiu' com pontesRestantes refletindo quem ainda ficou", async () => {
  const { bridgeHub } = await import("./hub");
  const a = new FakeSocket();
  const b = new FakeSocket();
  bridgeHub.registrar("app-y", a as any);
  bridgeHub.registrar("app-y", b as any);
  bridgeHub.remover("app-y", a as any);
  const ultimo = primeiro(bridgeHub.historico());
  assert.equal(ultimo.evento, "saiu");
  assert.equal(ultimo.pontesRestantes, 1); // "b" ainda conectado
  bridgeHub.remover("app-y", b as any);
});

test("entregar sem conexão registra 'entrega_falhou' — é o sintoma que causou o caso real (industrial, 15/09)", async () => {
  const { bridgeHub } = await import("./hub");
  const n = bridgeHub.entregar("app-nunca-conectou", { ola: "mundo" });
  assert.equal(n, 0);
  const ultimo = primeiro(bridgeHub.historico());
  assert.equal(ultimo.app, "app-nunca-conectou");
  assert.equal(ultimo.evento, "entrega_falhou");
  assert.match(ultimo.motivo ?? "", /OFFLINE/);
});

test("derrubar gera evento 'derrubado' com o motivo", async () => {
  const { bridgeHub } = await import("./hub");
  const s = new FakeSocket();
  bridgeHub.registrar("app-z", s as any);
  const n = bridgeHub.derrubar("app-z", "credencial rotacionada");
  assert.equal(n, 1);
  const ultimo = primeiro(bridgeHub.historico());
  assert.equal(ultimo.evento, "derrubado");
  assert.equal(ultimo.motivo, "credencial rotacionada");
});

test("historico() devolve mais recente primeiro", async () => {
  const { bridgeHub } = await import("./hub");
  const s = new FakeSocket();
  bridgeHub.registrar("app-ordem", s as any);
  bridgeHub.remover("app-ordem", s as any);
  const eventos = bridgeHub.historico();
  assert.ok(eventos.length >= 2);
  assert.equal(eventos[0]!.evento, "saiu");
  assert.equal(eventos[1]!.evento, "conectou");
});

test("historico() tem teto — não cresce pra sempre", async () => {
  const { bridgeHub } = await import("./hub");
  const s = new FakeSocket();
  for (let i = 0; i < 250; i++) {
    bridgeHub.registrar("app-flood", s as any);
    bridgeHub.remover("app-flood", s as any);
  }
  assert.ok(bridgeHub.historico().length <= 200);
});
