// limpeza-sessao-lid.ts — detecta e limpa sozinho o padrão de sessão de
// criptografia duplicada/travada que causa "Aguardando mensagem" pra sempre.
//
// Achado em produção (10/09/2026): o WhatsApp deu a alguns contatos uma
// identidade nova (@lid, "Linked ID") separada do número de telefone. O
// Baileys (biblioteca que usamos) não sabe reconciliar as duas — cria uma
// sessão de criptografia pro número de telefone (que nunca termina de
// negociar, fica em "pendingPreKey") E outra pro @lid (essa sim é a que o
// aparelho da pessoa usa de verdade). Resultado: reenvio automático nunca
// resolve, mensagem fica presa.
//
// Bug é da biblioteca (issues abertas, sem correção lançada — ver
// github.com/WhiskeySockets/Baileys/issues/1964, /1767, /1769). Isso aqui é
// o mitigador: acha o padrão (duas sessões do MESMO aparelho — confirmado
// pelo registrationId batendo — uma travada em pendingPreKey) e apaga só a
// travada, com backup. É exatamente o que resolveu na mão o caso de hoje.
//
// Roda sozinho, periodicamente — ninguém precisa caçar contato por contato.

import fs from "node:fs";
import path from "node:path";

const CREDENTIALS_DIR = path.join(process.cwd(), "wa_credentials");
const BACKUP_DIR = path.join(CREDENTIALS_DIR, "_backup-sessao-conflito");
const INTERVALO_MS = 10 * 60 * 1000; // 10 min — não precisa ser rápido, o sintoma persiste até alguém mandar mensagem de novo

// JID de telefone brasileiro (com DDI 55): até 13 dígitos. LID observado em
// produção: 14-15 dígitos. Não é uma regra do protocolo — é o padrão real que
// vimos nos dados; documentamos o número visto pra quem for revisar depois.
const DIGITOS_TELEFONE_MAX = 13;

type ArquivoSessao = {
  caminho: string;
  nomeArquivo: string;
  jidUser: string;
  registrationId: number | null;
  temPendingPreKey: boolean;
};

function lerSessao(caminho: string): ArquivoSessao | null {
  try {
    const bruto = fs.readFileSync(caminho, "utf8");
    const dados = JSON.parse(bruto);
    const nomeArquivo = path.basename(caminho);
    const jidUser = nomeArquivo.replace(/^session-/, "").replace(/\.\d+\.json$/, "");
    const registrationId = typeof dados?.registrationId === "number" ? dados.registrationId : null;
    // Estrutura real observada: { _sessions: { "<chave>": { pendingPreKey: {...}, ... } } }
    const sessoes = dados?._sessions || {};
    const temPendingPreKey = Object.values(sessoes).some((s: any) => s && typeof s === "object" && "pendingPreKey" in s);
    return { caminho, nomeArquivo, jidUser, registrationId, temPendingPreKey };
  } catch {
    return null; // arquivo corrompido/ilegível — não mexe, só ignora
  }
}

function ehFormatoTelefone(jidUser: string): boolean {
  return /^\d+$/.test(jidUser) && jidUser.length <= DIGITOS_TELEFONE_MAX;
}
function ehFormatoLid(jidUser: string): boolean {
  return /^\d+$/.test(jidUser) && jidUser.length > DIGITOS_TELEFONE_MAX;
}

export function limparPastaDeCredenciais(pastaCredenciais: string, sessionId: string, pastaBackup = BACKUP_DIR) {
  let arquivos: string[];
  try {
    arquivos = fs.readdirSync(pastaCredenciais).filter((f) => f.startsWith("session-") && f.endsWith(".json"));
  } catch {
    return; // pasta não existe pra essa sessão — nada a fazer
  }

  const sessoes = arquivos
    .map((f) => lerSessao(path.join(pastaCredenciais, f)))
    .filter((s): s is ArquivoSessao => s !== null && s.registrationId !== null);

  // Agrupa por registrationId — é o dado que prova que duas sessões são do
  // MESMO aparelho físico (confirmado no caso real de hoje).
  const porRegistrationId = new Map<number, ArquivoSessao[]>();
  for (const s of sessoes) {
    const lista = porRegistrationId.get(s.registrationId!) || [];
    lista.push(s);
    porRegistrationId.set(s.registrationId!, lista);
  }

  for (const [registrationId, grupo] of porRegistrationId) {
    if (grupo.length < 2) continue; // sem conflito possível

    const temLid = grupo.some((s) => ehFormatoLid(s.jidUser));
    if (!temLid) continue; // padrão só se aplica quando existe uma sessão @lid no mesmo grupo

    const telefonesTravados = grupo.filter((s) => ehFormatoTelefone(s.jidUser) && s.temPendingPreKey);
    for (const alvo of telefonesTravados) {
      try {
        fs.mkdirSync(pastaBackup, { recursive: true });
        const backupNome = `${alvo.nomeArquivo}.bak-${Date.now()}`;
        fs.copyFileSync(alvo.caminho, path.join(pastaBackup, backupNome));
        fs.unlinkSync(alvo.caminho);
        console.log(JSON.stringify({
          tag: "wa_limpeza_sessao_lid",
          evento: "sessao_removida",
          session_id: sessionId,
          jid_removido: alvo.jidUser,
          registration_id: registrationId,
          backup: backupNome,
        }));
      } catch (e) {
        console.error(JSON.stringify({
          tag: "wa_limpeza_sessao_lid",
          evento: "falha_ao_remover",
          session_id: sessionId,
          jid: alvo.jidUser,
          erro: e instanceof Error ? e.message : String(e),
        }));
      }
    }
  }
}

export function rodarLimpezaSessaoLid() {
  let pastas: string[];
  try {
    pastas = fs.readdirSync(CREDENTIALS_DIR).filter((f) => f.endsWith("_credentials"));
  } catch {
    return;
  }
  for (const pasta of pastas) {
    const sessionId = pasta.replace(/_credentials$/, "");
    limparPastaDeCredenciais(path.join(CREDENTIALS_DIR, pasta), sessionId);
  }
}

export function iniciarLimpezaPeriodica() {
  // NÃO roda na hora do boot: loadSessionsFromStorage() está lendo esses
  // mesmos arquivos nesse momento, e apagar um arquivo que outra parte do
  // processo está lendo é pedir corrida. A cada 10 min é tempo de sobra.
  setInterval(rodarLimpezaSessaoLid, INTERVALO_MS).unref?.();
}
