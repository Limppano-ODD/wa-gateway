// Reproduz o caso real de 10/09/2026: duas sessões do MESMO aparelho
// (registrationId batendo) — uma pelo telefone, travada em pendingPreKey,
// outra pelo @lid, funcionando. Só a travada deve sumir.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { limparPastaDeCredenciais } from "./limpeza-sessao-lid.js";

function pastaTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-lid-test-"));
}

function escreverSessao(pasta: string, nome: string, dados: object) {
  fs.writeFileSync(path.join(pasta, nome), JSON.stringify(dados));
}

test("apaga a sessão de telefone travada quando existe a @lid do mesmo aparelho", () => {
  const pasta = pastaTemp();
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "wa-lid-backup-"));

  // telefone (13 dígitos), mesmo registrationId da @lid, preso em pendingPreKey
  escreverSessao(pasta, "session-5521970009333.0.json", {
    registrationId: 222658648,
    _sessions: { chaveQualquer: { pendingPreKey: { preKeyId: 1 } } },
  });
  // @lid (14+ dígitos), mesmo registrationId, sessão completa (sem pendingPreKey)
  escreverSessao(pasta, "session-37684177281040.0.json", {
    registrationId: 222658648,
    _sessions: { chaveQualquer: { chainKey: {} } },
  });

  limparPastaDeCredenciais(pasta, "crm-vendas", backup);

  const restantes = fs.readdirSync(pasta);
  assert.deepEqual(restantes, ["session-37684177281040.0.json"], "só a sessão @lid deveria sobrar");

  const backups = fs.readdirSync(backup);
  assert.equal(backups.length, 1, "a sessão apagada tem que estar em backup");
  assert.ok(backups[0]!.startsWith("session-5521970009333.0.json.bak-"));
});

test("não mexe em sessão de telefone travada SEM @lid correspondente", () => {
  const pasta = pastaTemp();
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "wa-lid-backup-"));

  // Só telefone, travado — mas sem @lid do mesmo registrationId, então não é
  // o padrão do bug: pode ser só uma sessão normal ainda negociando.
  escreverSessao(pasta, "session-5521970009333.0.json", {
    registrationId: 999,
    _sessions: { chaveQualquer: { pendingPreKey: { preKeyId: 1 } } },
  });

  limparPastaDeCredenciais(pasta, "crm-vendas", backup);

  const restantes = fs.readdirSync(pasta);
  assert.deepEqual(restantes, ["session-5521970009333.0.json"], "sem @lid pra comparar, não apaga nada");
});

test("não mexe na sessão de telefone se ela NÃO está em pendingPreKey (mesmo com @lid par)", () => {
  const pasta = pastaTemp();
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "wa-lid-backup-"));

  // Telefone com sessão SAUDÁVEL (sem pendingPreKey) — não é o caso travado,
  // apagar aqui seria destruir uma sessão que funciona.
  escreverSessao(pasta, "session-5521970009333.0.json", {
    registrationId: 555,
    _sessions: { chaveQualquer: { chainKey: {} } },
  });
  escreverSessao(pasta, "session-37684177281040.0.json", {
    registrationId: 555,
    _sessions: { chaveQualquer: { chainKey: {} } },
  });

  limparPastaDeCredenciais(pasta, "crm-vendas", backup);

  const restantes = fs.readdirSync(pasta).sort();
  assert.deepEqual(restantes, ["session-37684177281040.0.json", "session-5521970009333.0.json"]);
});

test("ignora arquivo de sessão corrompido sem quebrar a limpeza dos outros", () => {
  const pasta = pastaTemp();
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "wa-lid-backup-"));

  fs.writeFileSync(path.join(pasta, "session-11111111111.0.json"), "{ isso nao e json valido");
  escreverSessao(pasta, "session-5521970009333.0.json", {
    registrationId: 42,
    _sessions: { chaveQualquer: { pendingPreKey: { preKeyId: 1 } } },
  });
  escreverSessao(pasta, "session-37684177281040.0.json", {
    registrationId: 42,
    _sessions: { chaveQualquer: { chainKey: {} } },
  });

  limparPastaDeCredenciais(pasta, "crm-vendas", backup);

  const restantes = fs.readdirSync(pasta).sort();
  assert.deepEqual(restantes, ["session-11111111111.0.json", "session-37684177281040.0.json"]);
});
