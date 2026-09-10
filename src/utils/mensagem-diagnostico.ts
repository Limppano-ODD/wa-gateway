// mensagem-diagnostico.ts — uma linha de log consolidada por mensagem, juntando
// envio + ack + retry + estado da sessão no momento do envio. E, a partir de
// hoje, DETECTA sozinho quando uma mensagem ficou presa (nunca chega a
// "entregue") e aciona quem sabe consertar — ver auto-cura-mensagem-presa.ts.
//
// Weslan (10/09/2026), depois de ver a sessão travada ser limpa mas a
// mensagem presa continuar sem resposta: "essa solução é ruim, vão continuar
// perdendo conversa". Limpar a sessão de tempos em tempos só ajuda a PRÓXIMA
// mensagem — a que já travou fica esperando alguém mandar de novo na mão.
// Por isso isso aqui virou também um gatilho, não só um log.
//
// Em memória, de propósito — é diagnóstico de curto prazo (a mensagem resolve
// ou não em minutos, não em dias), não histórico permanente.

type Registro = {
  messageId: string;
  sessionId: string;
  chatId: string;
  texto: string;
  isGroup: boolean;
  criadoEm: number;
  status: string; // pending | server | delivered | read | played | error
  tentativasRetry: number;
  reconnectCountNoEnvio: number;
  jaAcionouAutoCura: boolean;
};

const registros = new Map<string, Registro>(); // key = `${sessionId}:${messageId}`
const LIMITE = 2000;

// Quanto esperar depois do envio antes de considerar "pode estar preso".
// Numa entrega normal, delivered chega em <1s (visto em produção hoje).
// Weslan (10/09/2026) pediu 10s — mais agressivo que uma folga confortável
// pra rede lenta, mas o efeito colateral de disparar cedo demais é só
// reenviar uma mensagem que ia chegar sozinha 1s depois (a pessoa vê
// duplicada) — nunca perde mensagem. Aceitável pela urgência do problema.
const TIMEOUT_VERIFICACAO_MS = 10_000;

type ListenerMensagemPresa = (r: Registro) => void;
const listenersMensagemPresa: ListenerMensagemPresa[] = [];

// Quem sabe consertar (auto-cura-mensagem-presa.ts) se inscreve aqui. Mantém
// este arquivo sem depender de wa-multi-session — só dados e um gatilho.
export function onMensagemPresa(listener: ListenerMensagemPresa) {
  listenersMensagemPresa.push(listener);
}

const STATUS_RESOLVIDOS = new Set(["delivered", "read", "played"]);

// Reconexões por sessão desde a última vez que ficou conectada de verdade —
// sinal indireto de instabilidade no momento do envio.
const reconnectCount = new Map<string, number>();

export function registrarReconexao(sessionId: string) {
  reconnectCount.set(sessionId, (reconnectCount.get(sessionId) || 0) + 1);
}
export function zerarReconexao(sessionId: string) {
  reconnectCount.set(sessionId, 0);
}
function contadorReconexao(sessionId: string): number {
  return reconnectCount.get(sessionId) || 0;
}

function chave(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

function logar(r: Registro, evento: string) {
  console.log(
    JSON.stringify({
      tag: "wa_msg_diag",
      evento,
      message_id: r.messageId,
      session_id: r.sessionId,
      chat_id: r.chatId,
      status: r.status,
      retry_count: r.tentativasRetry,
      reconnect_count_no_envio: r.reconnectCountNoEnvio,
      idade_ms: Date.now() - r.criadoEm,
    }),
  );
}

// Chamar logo após o envio dar certo (message.ts). `texto`/`isGroup` ficam
// guardados só pra poder reenviar se a mensagem travar — não pra histórico.
export function registrarEnvio(
  sessionId: string,
  messageId: string | undefined,
  chatId: string,
  texto: string,
  isGroup: boolean,
) {
  if (!messageId) return;
  const r: Registro = {
    messageId, sessionId, chatId, texto, isGroup,
    criadoEm: Date.now(), status: "pending",
    tentativasRetry: 0, reconnectCountNoEnvio: contadorReconexao(sessionId),
    jaAcionouAutoCura: false,
  };
  registros.set(chave(sessionId, messageId), r);
  if (registros.size > LIMITE) {
    const primeira = registros.keys().next().value;
    if (primeira) registros.delete(primeira);
  }
  logar(r, "enviado");

  setTimeout(() => verificarTravamento(sessionId, messageId), TIMEOUT_VERIFICACAO_MS).unref?.();
}

// Exportado só pra teste: dispara a verificação sem esperar o timer real.
export function verificarTravamento(sessionId: string, messageId: string) {
  const r = registros.get(chave(sessionId, messageId));
  if (!r || r.jaAcionouAutoCura) return;
  if (STATUS_RESOLVIDOS.has(r.status)) return; // resolveu sozinho, nada a fazer

  r.jaAcionouAutoCura = true;
  logar(r, "presa_acionando_auto_cura");
  for (const listener of listenersMensagemPresa) {
    try {
      listener(r);
    } catch (e) {
      console.error("[mensagem-diagnostico] listener de auto-cura falhou:", (e as Error).message);
    }
  }
}

// Chamar em whastapp.onMessageUpdate — status real vindo do WhatsApp (ack).
export function registrarStatus(sessionId: string, messageId: string, status: string) {
  const r = registros.get(chave(sessionId, messageId));
  if (!r) return; // fora da janela de rastreio (reinício do processo, ou mensagem recebida — não enviada por nós)
  r.status = status;
  logar(r, "status_atualizado");
}
