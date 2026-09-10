// mensagem-diagnostico.ts — uma linha de log consolidada por mensagem, juntando
// envio + ack + retry + estado da sessão no momento do envio.
//
// Pedido do Weslan (10/09/2026), depois de reclamação recorrente de
// "Aguardando mensagem": hoje pra saber o que aconteceu com uma mensagem é
// preciso garimpar o dump cru do Baileys (WA_DEBUG_SIGNAL) e cruzar timestamp
// na mão. Isso junta tudo por message_id, então um `docker logs | grep
// <message_id>` conta a história inteira: enviou → status → retry (se teve).
//
// Em memória, de propósito — é diagnóstico de curto prazo (a mensagem resolve
// ou não em minutos, não em dias), não histórico permanente.

type Registro = {
  messageId: string;
  sessionId: string;
  chatId: string;
  criadoEm: number;
  status: string; // pending | server | delivered | read | played | error
  tentativasRetry: number;
  reconnectCountNoEnvio: number;
};

const registros = new Map<string, Registro>(); // key = `${sessionId}:${messageId}`
const LIMITE = 2000;

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

// Chamar logo após o envio dar certo (message.ts). Sem messageId (baileys às
// vezes não devolve) não tem o que rastrear — sai calado, o envio em si já
// tem seu próprio log de request/response.
export function registrarEnvio(sessionId: string, messageId: string | undefined, chatId: string) {
  if (!messageId) return;
  const r: Registro = {
    messageId,
    sessionId,
    chatId,
    criadoEm: Date.now(),
    status: "pending",
    tentativasRetry: 0,
    reconnectCountNoEnvio: contadorReconexao(sessionId),
  };
  registros.set(chave(sessionId, messageId), r);
  if (registros.size > LIMITE) {
    const primeira = registros.keys().next().value;
    if (primeira) registros.delete(primeira);
  }
  logar(r, "enviado");
}

// Chamar em whastapp.onMessageUpdate — status real vindo do WhatsApp (ack).
export function registrarStatus(sessionId: string, messageId: string, status: string) {
  const r = registros.get(chave(sessionId, messageId));
  if (!r) return; // fora da janela de rastreio (reinício do processo, ou mensagem recebida — não enviada por nós)
  r.status = status;
  logar(r, "status_atualizado");
}
