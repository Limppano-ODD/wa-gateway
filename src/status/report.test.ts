// report.test.ts — o /status existe porque o /health mentiu por 20 dias. Se ele
// também mentir, o serviço volta a ficar cego com aparência de saudável. Estes
// testes travam as três mentiras possíveis: contar sessão que ninguém pediu
// para vigiar, errar o fuso ao calcular tempo sem mensagem, e chamar de
// conectado o que só tem objeto de sessão sem autenticação.
//
// Não importa `wa-multi-session` nem sqlite: as sondas entram por parâmetro.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionRow } from "../database/db";
import { buildStatusReport, parseSqliteUtc } from "./report";

const AGORA = new Date("2026-08-10T14:00:00.000Z");

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    name: "crm-vendas",
    monitored: 1,
    last_message_at: null,
    last_state: null,
    last_state_reason: null,
    last_state_change_at: null,
    created_at: "2026-06-08 15:29:26",
    ...over,
  };
}

const deps = (over: Partial<Parameters<typeof buildStatusReport>[1]> = {}) => ({
  isConnected: () => true,
  hasCredentials: () => true,
  now: () => AGORA,
  ...over,
});

test("sessions_expected conta só as monitoradas — sessão desligada de propósito não pode manter o alerta vermelho para sempre", () => {
  const r = buildStatusReport(
    [row({ name: "crm-vendas" }), row({ name: "compras1", monitored: 0 })],
    deps({ isConnected: (n: string) => n === "crm-vendas" })
  );

  assert.equal(r.sessions_expected, 1);
  assert.equal(r.sessions_connected, 1);
  assert.deepEqual(r.sessions_down, []);
  // ...mas a não monitorada continua visível no detalhe, para o humano.
  assert.equal(r.sessions.length, 2);
});

test("sessions_down nomeia quem caiu — alerta que só diz 'algo caiu' obriga a investigar do zero", () => {
  const r = buildStatusReport(
    [row({ name: "crm-vendas" }), row({ name: "compras1" })],
    deps({ isConnected: (n: string) => n === "crm-vendas" })
  );

  assert.equal(r.sessions_expected, 2);
  assert.equal(r.sessions_connected, 1);
  assert.deepEqual(r.sessions_down, ["compras1"]);
});

test("timestamp do sqlite é lido como UTC — sem isso hours_without_message erra pelo offset do servidor, em silêncio", () => {
  // O sqlite grava CURRENT_TIMESTAMP sem marcador de fuso. Interpretado como
  // horário local em America/Sao_Paulo, isto viraria 3h de diferença.
  const parsed = parseSqliteUtc("2026-08-10 12:00:00");

  assert.equal(parsed?.toISOString(), "2026-08-10T12:00:00.000Z");

  const r = buildStatusReport([row({ last_message_at: "2026-08-10 12:00:00" })], deps());

  assert.equal(r.sessions[0]?.hours_without_message, 2);
});

test("hours_without_message é null quando nunca chegou mensagem — quem decide se null é alarme é o monitoramento", () => {
  const r = buildStatusReport([row({ last_message_at: null })], deps());

  assert.equal(r.sessions[0]?.hours_without_message, null);
  assert.equal(r.sessions[0]?.last_message_at, null);
});

test("sessão fora reporta há quantas horas está fora — 'qual caiu' vem do nome, 'desde quando' vem daqui", () => {
  const r = buildStatusReport(
    [row({ last_state: "disconnected", last_state_change_at: "2026-08-10 02:00:00" })],
    deps({ isConnected: () => false })
  );

  assert.equal(r.sessions[0]?.hours_disconnected, 12);
  assert.equal(r.sessions[0]?.disconnected_since, "2026-08-10T02:00:00.000Z");
});

test("sessão conectada tem hours_disconnected 0, não null — é o 0 que mantém a condição `== 0` do Gatus verde e faz o valor real aparecer no alerta quando cai", () => {
  const r = buildStatusReport(
    [row({ last_state: "connected", last_state_change_at: "2026-08-10 02:00:00" })],
    deps({ isConnected: () => true })
  );

  // Literal, não eufemismo: está fora há zero horas. Com null aqui, a condição
  // ficaria permanentemente vermelha e o alerta perderia o tempo de queda.
  assert.equal(r.sessions[0]?.hours_disconnected, 0);
  // `disconnected_since` continua null: "desde quando" não tem sentido no ar,
  // e ninguem checa timestamp com condicao numerica.
  assert.equal(r.sessions[0]?.disconnected_since, null);
});

test("null fica reservado ao caso em que nao se sabe: fora, sem nenhum evento registrado", () => {
  const r = buildStatusReport(
    [row({ last_state_change_at: null })],
    deps({ isConnected: () => false })
  );

  assert.equal(r.sessions[0]?.hours_disconnected, null);
});

test("o relógio da queda sobrevive a restart: sai do sqlite, não da memória do processo", () => {
  // Simula processo recém-subido (nenhum evento nesta execução) com o banco
  // guardando uma queda de ontem. Se o tempo viesse da memória, daria 0.
  const r = buildStatusReport(
    [row({ last_state: "disconnected", last_state_change_at: "2026-08-09 14:00:00" })],
    deps({ isConnected: () => false })
  );

  assert.equal(r.sessions[0]?.hours_disconnected, 24);
});

test("credentials_present separa 'reconecta sozinho' de 'precisa de humano com o celular'", () => {
  const r = buildStatusReport(
    [row({ last_state: "disconnected" })],
    deps({ isConnected: () => false, hasCredentials: () => false })
  );

  assert.equal(r.sessions[0]?.connected, false);
  assert.equal(r.sessions[0]?.credentials_present, false);
});

test("socket conectado vence o último evento gravado — evento antigo não pode declarar caída uma sessão viva", () => {
  const r = buildStatusReport(
    [row({ last_state: "disconnected" })],
    deps({ isConnected: () => true })
  );

  assert.equal(r.sessions[0]?.state, "connected");
});

test("sem evento registrado e sem conexão, o estado é 'unknown' e não 'connected'", () => {
  const r = buildStatusReport([row()], deps({ isConnected: () => false }));

  assert.equal(r.sessions[0]?.state, "unknown");
});

test("zero sessões esperadas não pode parecer saudável por acidente", () => {
  const r = buildStatusReport([], deps());

  assert.equal(r.sessions_expected, 0);
  assert.equal(r.sessions_connected, 0);
  // A condição do Gatus é `sessions_connected == sessions_expected`, que aqui
  // passaria. Por isso `sessions` vazio tambem e sinal — documentado no README.
  assert.deepEqual(r.sessions, []);
});
