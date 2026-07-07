// meta.hub.ts — "mesa telefônica" das pontes abertas com os apps.
//
// Cada app interno (SAC, CRM...) abre UM WebSocket com o gateway e fica escutando.
// O hub guarda essas conexões (nome do app -> sockets). Quando chega mensagem do
// Meta, o hub empurra pela ponte do app dono. Um app pode ter várias conexões.

import type { WebSocket } from "ws";

class MetaHub {
  private conexoes = new Map<string, Set<WebSocket>>();

  registrar(app: string, socket: WebSocket): void {
    if (!this.conexoes.has(app)) this.conexoes.set(app, new Set());
    this.conexoes.get(app)!.add(socket);
    console.log(`[meta.hub] app "${app}" conectou (linhas: ${this.conexoes.get(app)!.size})`);
  }

  remover(app: string, socket: WebSocket): void {
    const set = this.conexoes.get(app);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.conexoes.delete(app);
    console.log(`[meta.hub] app "${app}" saiu (restam: ${set.size})`);
  }

  // Empurra um objeto pra todas as pontes abertas do app. Retorna quantas receberam.
  entregar(app: string, mensagem: unknown): number {
    const set = this.conexoes.get(app);
    if (!set || set.size === 0) {
      console.warn(`[meta.hub] app "${app}" OFFLINE — mensagem não entregue`);
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

  status(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [app, set] of this.conexoes) out[app] = set.size;
    return out;
  }
}

export const metaHub = new MetaHub();
