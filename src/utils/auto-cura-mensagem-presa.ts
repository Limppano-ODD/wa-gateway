// auto-cura-mensagem-presa.ts — quando uma mensagem fica presa (nunca chega
// a "entregue" em 60s, ver mensagem-diagnostico.ts), limpa a sessão de
// criptografia conflitante daquele contato E reenvia a MESMA mensagem, na
// hora, sozinho.
//
// Weslan (10/09/2026): "essa solução é ruim, vão continuar perdendo
// conversa pq n vou ver a mensagem". Limpar a sessão sozinha (a cada 10 min,
// ver limpeza-sessao-lid.ts) só ajuda a PRÓXIMA mensagem — a que já travou
// ficava esperando alguém perceber e mandar de novo na mão. Isso fecha essa
// lacuna: detecta a mensagem presa POR ELA MESMA e resolve na hora.
//
// Só reenvia UMA vez por mensagem original (`jaAcionouAutoCura` em
// mensagem-diagnostico.ts trava isso) — o reenvio em si não é rastreado de
// novo, pra não encadear tentativa atrás de tentativa sem fim.

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

      const reenviada = await whatsapp.sendTextMessage({
        sessionId: r.sessionId,
        to: r.chatId,
        text: r.texto,
        isGroup: r.isGroup,
      });

      console.log(JSON.stringify({
        tag: "wa_auto_cura",
        evento: "reenviado",
        message_id_original: r.messageId,
        message_id_novo: reenviada?.key?.id ?? null,
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
