// ws.test.ts — heartbeat da ponte WebSocket. Weslan pediu (15/09/2026) depois
// de o agent-industrial acumular 3 "pontes abertas" quando só devia ter 1 —
// containers reiniciando sem fechar a conexão direito deixavam sockets
// zumbis pra sempre no hub. Usa mock.timers pra não esperar 30s de verdade.
//
// Env setado ANTES do import (dinâmico) de ./ws: esse módulo importa
// ./config, que valida ADMIN_USER/ADMIN_PASSWORD no load — sem isso o teste
// só passa por acaso, na ordem certa de execução junto dos outros arquivos
// (mesmo problema que config.test.ts já resolve do jeito abaixo).

import { test, before } from "node:test";
import assert from "node:assert/strict";

let iniciarHeartbeat: typeof import("./ws").iniciarHeartbeat;

before(async () => {
  process.env.ADMIN_USER ??= "t";
  process.env.ADMIN_PASSWORD ??= "t";
  ({ iniciarHeartbeat } = await import("./ws"));
});

interface SocketFake {
  readyState: number;
  on(evento: "pong", cb: () => void): unknown;
  ping(): void;
  terminate(): void;
}

class FakeSocket implements SocketFake {
  readyState = 1;
  pings = 0;
  terminado = false;
  private onPong: (() => void) | null = null;

  on(evento: "pong", cb: () => void) {
    if (evento === "pong") this.onPong = cb;
    return this;
  }

  ping() {
    this.pings++;
  }

  terminate() {
    this.terminado = true;
    this.readyState = 3; // CLOSED
  }

  // Simula o outro lado respondendo ao ping — chamar isso é o socket "vivo".
  responderPong() {
    this.onPong?.();
  }
}

test("socket que sempre responde pong nunca é terminado", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const s = new FakeSocket();
  const timer = iniciarHeartbeat(s, 30_000);

  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(30_000);
    s.responderPong(); // simula o agente respondendo antes do próximo ciclo
  }

  assert.equal(s.terminado, false);
  assert.ok(s.pings >= 5);
  clearInterval(timer);
});

test("socket que para de responder pong é terminado no ciclo seguinte — o caso real do industrial", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const s = new FakeSocket();
  const timer = iniciarHeartbeat(s, 30_000);

  t.mock.timers.tick(30_000); // 1º ping, agente ainda responde
  s.responderPong();
  t.mock.timers.tick(30_000); // 2º ping — agente já morreu, não responde mais
  // sem responderPong() aqui — silêncio é exatamente o crash abrupto

  assert.equal(s.terminado, false, "só marca morto depois de UM ciclo sem pong, não termina na hora");

  t.mock.timers.tick(30_000); // 3º ciclo: heartbeat percebe que não teve pong desde o 2º ping

  assert.equal(s.terminado, true);
  clearInterval(timer);
});

test("não faz nada num socket já fechado (readyState != OPEN)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const s = new FakeSocket();
  s.readyState = 3; // CLOSED
  const timer = iniciarHeartbeat(s, 30_000);

  t.mock.timers.tick(30_000);
  t.mock.timers.tick(30_000);

  assert.equal(s.pings, 0);
  assert.equal(s.terminado, false); // já tava fechado, não precisa terminate() de novo
  clearInterval(timer);
});
