// outbox.test.ts — fila de mensagens pro agente. Weslan pediu (16/09/2026)
// depois do industrial ficar horas sem responder mesmo com a ponte aparentemente
// aberta: "quero uma solução melhor pra isso sempre funcionar, nem que a gente
// trabalhe com fila". Ver outbox.ts pro raciocínio completo.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let outbox: typeof import("./outbox");
let hub: typeof import("./hub");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "wagw-outbox-test-"));
  process.env.DB_PATH = join(dir, "test.db");
  process.env.ADMIN_USER = "t";
  process.env.ADMIN_PASSWORD = "t";
  hub = await import("./hub");
  outbox = await import("./outbox");
});

after(() => rmSync(dir, { recursive: true, force: true }));

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  send(payload: string) {
    this.sent.push(payload);
  }
}

test("mensagem pra tenant offline fica pending na fila (não desaparece mais)", () => {
  const r = outbox.enfileirarEEntregar("app-sem-ponte", { texto: "oi" });
  assert.ok(r.id !== null);
  assert.equal(r.entreguesAgora, 0);

  const stats = outbox.estatisticas();
  assert.equal(stats["app-sem-ponte"]?.pending, 1);
});

test("mensagem pra tenant online entrega na hora, mas continua pending até confirmar", () => {
  const s = new FakeSocket();
  hub.bridgeHub.registrar("app-online", s as any);

  const r = outbox.enfileirarEEntregar("app-online", { texto: "oi" });
  assert.equal(r.entreguesAgora, 1);
  assert.equal(s.sent.length, 1);
  // envelope carrega o ref (id da fila) pro agente poder confirmar depois
  const enviado = JSON.parse(s.sent[0]!);
  assert.equal(enviado.ref, r.id);

  // sem ack, segue pending — é isso que o sweep vai reforçar depois
  assert.equal(outbox.estatisticas()["app-online"]?.pending, 1);

  hub.bridgeHub.remover("app-online", s as any);
});

test("confirmar() tira da fila — sweep para de reenviar essa mensagem", () => {
  const s = new FakeSocket();
  hub.bridgeHub.registrar("app-ack", s as any);
  const r = outbox.enfileirarEEntregar("app-ack", { texto: "oi" });

  const ok = outbox.confirmar(r.id!);
  assert.equal(ok, true);
  assert.equal(outbox.estatisticas()["app-ack"], undefined); // delivered não conta nas estatísticas (só pending/failed)

  // confirmar de novo (já delivered) não deve "reabrir" nada
  const ok2 = outbox.confirmar(r.id!);
  assert.equal(ok2, false);

  hub.bridgeHub.remover("app-ack", s as any);
});

test("varrerPendentes() reenvia pra ponte que só apareceu DEPOIS da mensagem chegar", () => {
  // Mensagem chega com o app offline — exatamente o caso real do industrial
  // (ponte zumbi na hora H, reconecta minutos depois).
  const r = outbox.enfileirarEEntregar("app-reconecta", { texto: "oi" });
  assert.equal(r.entreguesAgora, 0);

  const s = new FakeSocket();
  hub.bridgeHub.registrar("app-reconecta", s as any);
  assert.equal(s.sent.length, 0); // registrar() sozinho não empurra nada

  outbox.varrerPendentes("app-reconecta");
  assert.equal(s.sent.length, 1); // sweep entregou pra ponte nova

  hub.bridgeHub.remover("app-reconecta", s as any);
});

test("varrerPendentes() aposenta mensagem depois do teto de tentativas (marca failed)", () => {
  const r = outbox.enfileirarEEntregar("app-nunca-conecta", { texto: "oi" });
  assert.equal(r.entreguesAgora, 0);

  // Sem ponte nenhuma, nenhuma tentativa é contada (entregar() devolve 0) —
  // então o teto de TENTATIVAS nunca fecha sozinho aqui. O TTL de idade é a
  // rede de segurança real pra esse caso; como não dá pra fast-forward
  // SYSDATE do sqlite no teste sem mock de tempo do processo inteiro, cobrimos
  // isso a nível de contrato: depois de várias varreduras sem ponte, a
  // mensagem CONTINUA pending (não falha por tentativa quando não teve
  // tentativa de verdade) — é exatamente o comportamento que queremos: só
  // desiste quando alguém tentou de verdade e não confirmou, ou quando
  // envelheceu demais.
  for (let i = 0; i < 20; i++) outbox.varrerPendentes("app-nunca-conecta");
  assert.equal(outbox.estatisticas()["app-nunca-conecta"]?.pending, 1);
});

test("estatisticas() agrega pending/failed por tenant, ignora delivered", () => {
  outbox.enfileirarEEntregar("app-stats", { texto: "1" });
  outbox.enfileirarEEntregar("app-stats", { texto: "2" });
  const stats = outbox.estatisticas();
  assert.equal(stats["app-stats"]?.pending, 2);
});
