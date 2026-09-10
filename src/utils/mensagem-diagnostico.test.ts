// Cobre o gatilho de auto-cura: mensagem que não confirma entrega tem que
// acionar quem escuta; mensagem que confirmou não pode acionar nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registrarEnvio,
  registrarStatus,
  verificarTravamento,
  onMensagemPresa,
} from "./mensagem-diagnostico.js";

test("mensagem que nunca confirma entrega aciona o listener de auto-cura", () => {
  const acionados: string[] = [];
  onMensagemPresa((r) => acionados.push(r.messageId));

  registrarEnvio("sessao-teste", "msg-presa-1", "5521999999999", "oi", false);
  verificarTravamento("sessao-teste", "msg-presa-1"); // simula o timer disparando

  assert.deepEqual(acionados, ["msg-presa-1"]);
});

test("mensagem que confirmou 'delivered' antes do timer NÃO aciona nada", () => {
  const acionados: string[] = [];
  onMensagemPresa((r) => acionados.push(r.messageId));

  registrarEnvio("sessao-teste", "msg-ok-1", "5521999999999", "oi", false);
  registrarStatus("sessao-teste", "msg-ok-1", "delivered");
  verificarTravamento("sessao-teste", "msg-ok-1");

  assert.deepEqual(acionados, []);
});

test("verificarTravamento só aciona UMA vez pra mesma mensagem, mesmo chamado 2x", () => {
  const acionados: string[] = [];
  onMensagemPresa((r) => acionados.push(r.messageId));

  registrarEnvio("sessao-teste", "msg-presa-2", "5521999999999", "oi", false);
  verificarTravamento("sessao-teste", "msg-presa-2");
  verificarTravamento("sessao-teste", "msg-presa-2"); // segunda chamada não pode duplicar

  assert.deepEqual(acionados, ["msg-presa-2"]);
});

test("mensagem sem messageId não é rastreada nem quebra o registro", () => {
  assert.doesNotThrow(() => {
    registrarEnvio("sessao-teste", undefined, "5521999999999", "oi", false);
  });
});
