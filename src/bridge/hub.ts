// hub.ts — "mesa telefônica" das pontes abertas com os apps/agentes.
// Genérico: serve qualquer canal. Nome do tenant -> sockets.
//
// Cada app interno (SAC, CRM...) abre UM WebSocket com o gateway e fica escutando.
// O hub guarda essas conexões (nome do app -> sockets). Quando chega mensagem do
// Meta, o hub empurra pela ponte do app dono. Um app pode ter várias conexões.

import type { WebSocket } from "ws";

// Teto do histórico em memória — só pra visibilidade operacional na tela
// admin (ver "por que esse bot ficou instável"), não é log de auditoria.
// Reinício do processo zera, e tudo bem: o `console.log` já cobre o caso de
// precisar de histórico permanente.
const MAX_EVENTOS = 200;

export interface EventoConexao {
  app: string;
  evento: "conectou" | "saiu" | "derrubado" | "entrega_falhou";
  pontesRestantes: number;
  motivo?: string;
  timestamp: string;
}

class BridgeHub {
  private conexoes = new Map<string, Set<WebSocket>>();
  private eventos: EventoConexao[] = [];

  private registrarEvento(e: Omit<EventoConexao, "timestamp">): void {
    this.eventos.push({ ...e, timestamp: new Date().toISOString() });
    if (this.eventos.length > MAX_EVENTOS) this.eventos.shift();
  }

  // Últimos eventos primeiro — é o que se quer ver numa tela de diagnóstico.
  historico(): EventoConexao[] {
    return [...this.eventos].reverse();
  }

  registrar(app: string, socket: WebSocket): void {
    if (!this.conexoes.has(app)) this.conexoes.set(app, new Set());
    this.conexoes.get(app)!.add(socket);
    const pontes = this.conexoes.get(app)!.size;
    this.registrarEvento({ app, evento: "conectou", pontesRestantes: pontes });
    console.log(`[bridge.hub] app "${app}" conectou (linhas: ${pontes})`);
  }

  remover(app: string, socket: WebSocket): void {
    const set = this.conexoes.get(app);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.conexoes.delete(app);
    this.registrarEvento({ app, evento: "saiu", pontesRestantes: set.size });
    console.log(`[bridge.hub] app "${app}" saiu (restam: ${set.size})`);
  }

  // Empurra um objeto pra todas as pontes abertas do app. Retorna quantas receberam.
  entregar(app: string, mensagem: unknown): number {
    const set = this.conexoes.get(app);
    if (!set || set.size === 0) {
      this.registrarEvento({ app, evento: "entrega_falhou", pontesRestantes: 0, motivo: "mensagem chegou com app OFFLINE — não entregue" });
      console.warn(`[bridge.hub] app "${app}" OFFLINE — mensagem não entregue`);
      return 0;
    }
    const payload = JSON.stringify(mensagem);
    let n = 0;
    for (const socket of set) {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(payload);
        n++;
      }
    }
    return n;
  }

  // Fecha todas as pontes abertas de um app. Usado quando a credencial dele é
  // trocada ou o tenant é removido: sem isso a conexão autenticada com o token
  // ANTIGO continua aberta e recebendo mensagens até o processo reiniciar —
  // revogar deixaria de revogar de fato. Retorna quantas foram fechadas.
  derrubar(app: string, motivo: string): number {
    const set = this.conexoes.get(app);
    if (!set || set.size === 0) return 0;
    let n = 0;
    for (const socket of [...set]) {
      try {
        socket.close(4003, motivo);
      } catch {
        try {
          socket.terminate();
        } catch {
          /* já morto */
        }
      }
      n++;
    }
    // Não espera o handler de 'close': quem foi derrubado sai do registro agora.
    this.conexoes.delete(app);
    this.registrarEvento({ app, evento: "derrubado", pontesRestantes: 0, motivo });
    console.log(`[bridge.hub] app "${app}": ${n} ponte(s) derrubada(s) — ${motivo}`);
    return n;
  }

  status(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [app, set] of this.conexoes) out[app] = set.size;
    return out;
  }
}

export const bridgeHub = new BridgeHub();
