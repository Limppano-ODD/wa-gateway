// outbox.ts — fila durável de mensagens indo PRO agente (ingress → ponte).
//
// Por que existe: `bridgeHub.entregar()` sozinho é "manda e torce" — se o
// hub não tem ponte aberta (agente offline, reiniciando) ou a ponte que tem
// é zumbi (TCP morto que o heartbeat ainda não detectou), a mensagem
// simplesmente some. Weslan pediu explicitamente (16/09/2026, depois do
// industrial ficar horas sem responder mesmo com só 1 "ponte aberta"
// aparente): "quero uma solução melhor pra isso sempre funcionar, nem que a
// gente trabalhe com fila".
//
// Sem ACK do lado do agente (não dá pra mudar o cliente WS do agent-platform
// no mesmo dia), a garantia aqui é "at-least-once com retry": toda mensagem
// pro agente primeiro grava aqui (sobrevive a restart do wa-gateway), depois
// tenta entregar. Um sweep periódico reencaminha o que ainda tá pending pra
// qualquer ponte VIVA no momento — cobre o caso comum de a 1ª tentativa cair
// numa ponte zumbi que o heartbeat só derruba alguns ciclos depois. Trade-off
// aceito: pode entregar 2x se a 1ª tentativa realmente tinha funcionado mas
// não temos como saber (duplicar resposta de chat é bem menos ruim que nunca
// responder).

import db from "../database/db";
import { bridgeHub } from "./hub";

const MAX_TENTATIVAS = 8;
// Backoff simples: cada sweep tenta de novo quem ainda não passou do teto,
// espaçado pelo próprio intervalo do sweep (ver iniciarSweep). Não é
// exponencial de propósito — mensagem de chat quer chegar rápido quando a
// ponte volta, não esperar minutos.
const SWEEP_INTERVAL_MS = 20_000;
// Teto de idade: depois disso desiste e marca 'failed' — não fica reenviando
// mensagem de dias atrás pra sempre.
const TTL_MS = 30 * 60 * 1000;

export interface OutboxRow {
  id: number;
  tenant: string;
  payload: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

let disponivel = true;
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bridge_outbox (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant       TEXT NOT NULL,
      payload      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      attempts     INTEGER NOT NULL DEFAULT 0,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bridge_outbox_pending ON bridge_outbox(status, tenant);`);
} catch (e) {
  // Mesmo raciocínio do store.ts: sqlite quebrado não pode derrubar o
  // gateway. Sem a tabela, cai pro comportamento antigo (entrega direta,
  // sem fila) — pior que com fila, mas não pior que hoje.
  disponivel = false;
  console.error(
    "[bridge.outbox] NÃO foi possível preparar a tabela bridge_outbox:",
    (e as Error).message,
    "— fila indisponível; mensagens seguem só com entrega direta (sem retry).",
  );
}

export function outboxDisponivel(): boolean {
  return disponivel;
}

function paraRow(r: any): OutboxRow {
  return {
    id: r.id,
    tenant: r.tenant,
    payload: r.payload,
    status: r.status,
    attempts: r.attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deliveredAt: r.delivered_at,
  };
}

/**
 * Enfileira e tenta entregar na hora. Devolve o id da linha (pra embutir como
 * `ref` no envelope — se o agente algum dia mandar `{type:"ack",ref}` de
 * volta, `confirmar()` marca delivered e o sweep para de reenviar essa).
 */
export function enfileirarEEntregar(tenant: string, payload: Record<string, unknown>): { id: number | null; entreguesAgora: number } {
  const payloadStr = JSON.stringify(payload);

  if (!disponivel) {
    // Sem fila: volta ao comportamento antigo, sem rede de segurança.
    return { id: null, entreguesAgora: bridgeHub.entregar(tenant, payload) };
  }

  const info = db
    .prepare(`INSERT INTO bridge_outbox (tenant, payload) VALUES (?, ?)`)
    .run(tenant, payloadStr);
  const id = Number(info.lastInsertRowid);

  const envelope = { ...payload, ref: id };
  const n = bridgeHub.entregar(tenant, envelope);
  if (n > 0) {
    db.prepare(
      `UPDATE bridge_outbox SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(id);
  }
  // NÃO marca delivered só por n>0 — sem ack, "mandou pro socket" não prova
  // que o agente recebeu. Fica pending pro sweep reforçar; se o agente algum
  // dia confirmar via confirmar(id), sai da fila na hora.
  return { id, entreguesAgora: n };
}

/** Chamado quando o agente manda `{type:"ack", ref}` de volta pela ponte. */
export function confirmar(id: number): boolean {
  if (!disponivel) return false;
  const r = db
    .prepare(`UPDATE bridge_outbox SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`)
    .run(id);
  return r.changes > 0;
}

/**
 * Varre pendentes: reenvia pra ponte atual (se tiver), aposenta quem passou
 * do teto de tentativas ou de idade. Chamado (a) periodicamente e (b) na
 * hora que uma ponte nova conecta (`bridgeHub.registrar` dispara isso —
 * cobre exatamente "app reconectou depois de ficar zumbi/offline").
 */
export function varrerPendentes(tenantEspecifico?: string): void {
  if (!disponivel) return;

  const agora = Date.now();
  const query = tenantEspecifico
    ? db.prepare(`SELECT * FROM bridge_outbox WHERE status = 'pending' AND tenant = ? ORDER BY id`).all(tenantEspecifico)
    : db.prepare(`SELECT * FROM bridge_outbox WHERE status = 'pending' ORDER BY id`).all();

  for (const raw of query as any[]) {
    const row = paraRow(raw);
    const idadeMs = agora - new Date(row.createdAt + "Z").getTime();

    if (idadeMs > TTL_MS || row.attempts >= MAX_TENTATIVAS) {
      db.prepare(`UPDATE bridge_outbox SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      console.warn(
        `[bridge.outbox] mensagem ${row.id} pro tenant "${row.tenant}" desistida (tentativas=${row.attempts}, idade=${Math.round(idadeMs / 1000)}s)`,
      );
      continue;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      db.prepare(`UPDATE bridge_outbox SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);
      continue;
    }

    const n = bridgeHub.entregar(row.tenant, { ...payload, ref: row.id });
    if (n > 0) {
      db.prepare(
        `UPDATE bridge_outbox SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(row.id);
    }
  }
}

/** Contagem pending/failed por tenant — pra tela admin. */
export function estatisticas(): Record<string, { pending: number; failed: number }> {
  if (!disponivel) return {};
  const rows = db
    .prepare(`SELECT tenant, status, COUNT(*) AS n FROM bridge_outbox WHERE status IN ('pending','failed') GROUP BY tenant, status`)
    .all() as { tenant: string; status: string; n: number }[];
  const out: Record<string, { pending: number; failed: number }> = {};
  for (const r of rows) {
    const entry = (out[r.tenant] ??= { pending: 0, failed: 0 });
    if (r.status === "pending") entry.pending = r.n;
    if (r.status === "failed") entry.failed = r.n;
  }
  return out;
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Liga o sweep periódico. Chamar uma vez no boot do gateway. */
export function iniciarSweep(intervaloMs = SWEEP_INTERVAL_MS): NodeJS.Timeout {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => varrerPendentes(), intervaloMs);
  return sweepTimer;
}

export function pararSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
