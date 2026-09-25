// Quebra de resposta longa. Nasceu de um caso real: o agente respondeu uma lista
// de vendedores, o POST pro Teams morreu, e a pessoa não recebeu nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { partirTexto, salvarArquivoPublico } from "./teams.js";

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

// Arquivo em grupo/canal: sem consent card (Teams descarta em grupo), o link
// é o que chega na mensagem — então o arquivo TEM que existir de verdade no
// caminho que o link aponta.
test("salvarArquivoPublico grava o arquivo e devolve link em /media", () => {
  const bytes = Buffer.from("conteudo de teste");
  const url = salvarArquivoPublico("relatorio.pdf", bytes);

  assert.ok(url.startsWith("https://wa-gateway.odd.com.br/media/teams-arquivos/"));
  assert.ok(url.endsWith("-relatorio.pdf"));

  const relativo = url.replace("https://wa-gateway.odd.com.br/", "");
  const noDisco = path.join(process.cwd(), relativo);
  assert.equal(fs.readFileSync(noDisco, "utf8"), "conteudo de teste");
  fs.rmSync(noDisco, { force: true });
});

// Nome vindo de fora não pode escrever fora da pasta de mídia.
test("salvarArquivoPublico sanitiza nome com caminho (sem path traversal)", () => {
  const bytes = Buffer.from("x");
  const url = salvarArquivoPublico("../../etc/passwd", bytes);
  assert.ok(!url.includes(".."), `link com travessia de diretório: ${url}`);
  const relativo = url.replace("https://wa-gateway.odd.com.br/", "");
  const noDisco = path.join(process.cwd(), relativo);
  assert.ok(fs.existsSync(noDisco));
  fs.rmSync(noDisco, { force: true });
});

// Dois arquivos com o MESMO nome não podem colidir (o segundo apagaria/
// substituiria o primeiro antes de alguém ter clicado no link do primeiro).
test("salvarArquivoPublico gera link diferente a cada chamada, mesmo nome igual", () => {
  const bytes = Buffer.from("x");
  const url1 = salvarArquivoPublico("mesmo.pdf", bytes);
  const url2 = salvarArquivoPublico("mesmo.pdf", bytes);
  assert.notEqual(url1, url2);
  for (const url of [url1, url2]) {
    const noDisco = path.join(process.cwd(), url.replace("https://wa-gateway.odd.com.br/", ""));
    fs.rmSync(noDisco, { force: true });
  }
});
