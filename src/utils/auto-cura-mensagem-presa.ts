// auto-cura-mensagem-presa.ts — quando uma mensagem fica presa (nunca chega
// a "entregue" em 10s, ver mensagem-diagnostico.ts), limpa a sessão de
// criptografia conflitante daquele contato E reenvia a MESMA mensagem, na
// hora, sozinho.
//
// Weslan (10/09/2026): "essa solução é ruim, vão continuar perdendo
// conversa pq n vou ver a mensagem". Limpar a sessão sozinha (a cada 10 min,
// ver limpeza-sessao-lid.ts) só ajuda a PRÓXIMA mensagem — a que já travou
// ficava esperando alguém perceber e mandar de novo na mão. Isso fecha essa
// lacuna: detecta a mensagem presa POR ELA MESMA e resolve na hora.
//
// Weslan em seguida: "não quero 2 mensagens no chat, uma ruim e uma boa".
// Por isso o reenvio NÃO manda mensagem nova (que teria um id diferente e
// criaria um balão novo do lado do balão travado) — reenvia com o MESMO
// message id do original, igual o próprio Baileys faz quando atende um
// pedido de retry de verdade (sendMessagesAgain, em messages-recv.js). Pra
// isso, não dá pra usar o wa-multi-session.sendTextMessage (o wrapper dele
// não deixa escolher o id — sempre gera um novo); vai direto no socket do
// Baileys, que aceita `messageId` nas opções de envio.
//
// Só reenvia UMA vez por mensagem original (`jaAcionouAutoCura` em
// mensagem-diagnostico.ts trava isso) — não é rastreado de novo, pra não
// encadear tentativa atrás de tentativa sem fim.

import * as whatsapp from "wa-multi-session";
import path from "node:path";
import { onMensagemPresa } from "./mensagem-diagnostico";
import { limparPastaDeCredenciais } from "./limpeza-sessao-lid";

const CREDENTIALS_DIR = path.join(process.cwd(), "wa_credentials");

export function iniciarAutoCuraMensagemPresa() {
  onMensagemPresa(async (r) => {
    try {
      const pasta = path.join(CREDENTIALS_DIR, `${r.sessionId}_credentials`);
      limparPastaDeCredenciais(pasta, r.sessionId);

      const session = whatsapp.getSession(r.sessionId);
      if (!session) {
        console.error(JSON.stringify({
          tag: "wa_auto_cura", evento: "sessao_inexistente",
          message_id_original: r.messageId, session_id: r.sessionId,
        }));
        return;
      }
      const jid = whatsapp.phoneToJid({ to: r.chatId, isGroup: r.isGroup });

      // messageId igual ao original: WhatsApp trata como preenchimento do
      // MESMO balão que estava "Aguardando mensagem", não como mensagem nova.
      await session.sendMessage(jid, { text: r.texto }, { messageId: r.messageId });

      console.log(JSON.stringify({
        tag: "wa_auto_cura",
        evento: "reenviado_mesmo_id",
        message_id: r.messageId,
        session_id: r.sessionId,
        chat_id: r.chatId,
      }));
    } catch (e) {
      console.error(JSON.stringify({
        tag: "wa_auto_cura",
        evento: "falhou",
        message_id_original: r.messageId,
        session_id: r.sessionId,
        chat_id: r.chatId,
        erro: e instanceof Error ? e.message : String(e),
      }));
    }
  });
}
