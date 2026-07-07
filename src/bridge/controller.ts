// controller.ts — rotas HTTP genéricas da ponte (uma rota, todos os canais).
//
//   GET  /ingress/:tenant → handshake (o canal decide; WhatsApp usa, Teams não)
//   POST /ingress/:tenant → mensagem chega do canal → valida+parseia via adapter
//                           → empurra pra ponte WebSocket do tenant
//   POST /ingress/:tenant/send → app envia por HTTP (alternativa ao WS) → adapter.send
//   GET  /bridge/status   → tenants conectados (debug)
//
// Roteia pelo :tenant (config diz qual canal) — adicionar app/canal = só config.

import { Hono } from "hono";
import { tenant as tenantDef, tenantByWsToken } from "./config";
import { adapterFor } from "./channels";
import { bridgeHub } from "./hub";

export const createBridgeController = () => {
  const app = new Hono();

  // GET /ingress/:tenant — handshake (se o canal tiver)
  app.get("/ingress/:tenant", (c) => {
    const t = tenantDef(c.req.param("tenant"));
    if (!t) return c.text("tenant desconhecido", 404);
    const adapter = adapterFor(t.channel);
    if (!adapter?.verify) return c.text("canal não faz handshake", 404);
    const url = new URL(c.req.url);
    const r = adapter.verify(url.searchParams, t);
    if (!r) return c.text("forbidden", 403);
    return c.text(r.body, r.status as any);
  });

  // POST /ingress/:tenant — mensagem entrando
  app.post("/ingress/:tenant", async (c) => {
    const name = c.req.param("tenant");
    const t = tenantDef(name);
    if (!t) return c.text("tenant desconhecido", 404);
    const adapter = adapterFor(t.channel);
    if (!adapter) return c.text("canal sem adapter", 404);

    const rawBody = await c.req.text();
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k] = v));

    // Responde 200 rápido; processa/empurra em background (webhooks têm timeout).
    processarEntrada(adapter, rawBody, headers, t, name).catch((e) =>
      console.error(`[bridge] erro processando entrada de ${name}:`, e?.message || e),
    );
    return c.text("ok");
  });

  // POST /ingress/:tenant/send — envio por HTTP (auth pelo wsToken do tenant)
  app.post("/ingress/:tenant/send", async (c) => {
    const name = c.req.param("tenant");
    const t = tenantDef(name);
    if (!t) return c.json({ success: false, error: "tenant desconhecido" }, 404);
    const token = c.req.query("token") || c.req.header("x-app-token");
    if (tenantByWsToken(token) !== name) {
      return c.json({ success: false, error: "token inválido" }, 401);
    }
    const adapter = adapterFor(t.channel);
    if (!adapter) return c.json({ success: false, error: "canal sem adapter" }, 404);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "corpo inválido" }, 400);
    }
    const r = await adapter.send(body, t);
    return c.json({ success: r.ok, id: r.id ?? null, error: r.error ?? null }, r.ok ? 200 : 502);
  });

  // GET /bridge/status
  app.get("/bridge/status", (c) => c.json({ tenants_online: bridgeHub.status() }));

  return app;
};

async function processarEntrada(
  adapter: ReturnType<typeof adapterFor>,
  rawBody: string,
  headers: Record<string, string>,
  t: ReturnType<typeof tenantDef>,
  name: string,
): Promise<void> {
  if (!adapter || !t) return;
  const result = await adapter.receive(rawBody, headers, t);
  if (!result?.push) return;
  const n = bridgeHub.entregar(name, { type: "message", ...(result.push as object) });
  console.log(`[bridge] ${adapter.name} → tenant "${name}" (${n} ponte(s))`);
}
