// store.ts — persistência dos tenants criados em RUNTIME (pela plataforma de
// agentes), no mesmo sqlite do resto do gateway.
//
// Por que existe: até aqui um tenant só nascia de `BRIDGE_TENANTS`, lido UMA vez
// no boot. Em produção isso significa que criar um bot novo pela plataforma
// exigia editar o .env e REINICIAR o gateway — derrubando a ponte de todos os
// outros bots que estavam no ar. Com a tabela, o tenant novo entra na hora e
// continua existindo depois de um restart.
//
// Os tenants do env continuam sendo a base e têm PRECEDÊNCIA (ver config.ts):
// nada gravado aqui pode sobrescrever um tenant de produção declarado no env.

import db from "../database/db";

export interface TenantRow {
  name: string;
  channel: string;
  wsToken: string;
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS bridge_tenants (
    name       TEXT PRIMARY KEY,
    channel    TEXT NOT NULL,
    ws_token   TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// O wsToken é a credencial da ponte: dois tenants com o mesmo token tornariam
// ambíguo quem está discando (tenantByWsToken devolve o PRIMEIRO que casa). O
// índice único transforma isso em erro de escrita em vez de bug silencioso.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_tenants_ws_token ON bridge_tenants(ws_token);`);

function paraRow(r: any): TenantRow {
  let config: Record<string, any> = {};
  try {
    const p = JSON.parse(r.config || "{}");
    if (p && typeof p === "object") config = p;
  } catch {
    // Config corrompida no banco não pode derrubar o boot do gateway — o tenant
    // sobe com config vazia e o adapter dele reclama na primeira mensagem.
    console.error(`[bridge.store] config inválida no tenant "${r.name}" — usando {}`);
  }
  return {
    name: r.name,
    channel: r.channel,
    wsToken: r.ws_token,
    config,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const tenantStore = {
  listar(): TenantRow[] {
    const rows = db.prepare("SELECT * FROM bridge_tenants ORDER BY name").all() as any[];
    return rows.map(paraRow);
  },

  buscar(name: string): TenantRow | null {
    const r = db.prepare("SELECT * FROM bridge_tenants WHERE name = ?").get(name) as any;
    return r ? paraRow(r) : null;
  },

  // Idempotente de propósito: a plataforma de agentes pode repetir a chamada
  // (retry de rede, recriar o bot) e o resultado tem que ser o mesmo.
  gravar(name: string, channel: string, wsToken: string, config: Record<string, any>): TenantRow {
    db.prepare(
      `INSERT INTO bridge_tenants (name, channel, ws_token, config, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         channel    = excluded.channel,
         ws_token   = excluded.ws_token,
         config     = excluded.config,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(name, channel, wsToken, JSON.stringify(config));
    return this.buscar(name)!;
  },

  remover(name: string): boolean {
    return db.prepare("DELETE FROM bridge_tenants WHERE name = ?").run(name).changes > 0;
  },

  // Dono de um wsToken (pra detectar colisão antes de gravar).
  donoDoToken(wsToken: string): string | null {
    const r = db.prepare("SELECT name FROM bridge_tenants WHERE ws_token = ?").get(wsToken) as any;
    return r ? (r.name as string) : null;
  },
};
