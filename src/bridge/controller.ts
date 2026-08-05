// controller.ts — rotas HTTP genéricas da ponte (uma rota, todos os canais).
//
//   GET  /ingress/:tenant → handshake (o canal decide; WhatsApp usa, Teams não)
//   POST /ingress/:tenant → mensagem chega do canal → valida+parseia via adapter
//                           → empurra pra ponte WebSocket do tenant
//   POST /ingress/:tenant/send → app envia por HTTP (alternativa ao WS) → adapter.send
//   GET  /bridge/status   → tenants conectados (debug)
//
// Roteia pelo :tenant (config diz qual canal) — adicionar app/canal = só config.

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  listarTenants,
  origemDoTenant,
  registrarTenant,
  removerTenant,
  tenant as tenantDef,
  tenantByWsToken,
} from "./config";
import { adapterFor } from "./channels";
import { bridgeHub } from "./hub";
import { env } from "../env";

// Guarda das rotas de administração de tenant. Fail-closed: sem
// BRIDGE_ADMIN_TOKEN configurado a rota não existe pra ninguém.
function adminAutorizado(c: any): { ok: true } | { ok: false; status: number; erro: string } {
  const esperado = env.BRIDGE_ADMIN_TOKEN;
  if (!esperado) {
    return { ok: false, status: 503, erro: "registro de tenant em runtime desabilitado (BRIDGE_ADMIN_TOKEN não configurado)" };
  }
  const bearer = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  const recebido = bearer || c.req.header("x-bridge-admin-token") || "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, erro: "token inválido" };
  }
  return { ok: true };
}

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

    // receive() é rápido (valida/parseia); o trabalho pesado (o agente) roda do
    // outro lado da ponte. Alguns eventos exigem uma resposta HTTP específica
    // (ex: Teams fileConsent/invoke → InvokeResponse) — por isso aguardamos aqui.
    let result: Awaited<ReturnType<typeof adapter.receive>> = null;
    try {
      result = await adapter.receive(rawBody, headers, t);
    } catch (e: any) {
      console.error(`[bridge] erro processando entrada de ${name}:`, e?.message || e);
      return c.text("ok"); // não vaza erro pro canal
    }

    if (result?.response) {
      const r = result.response;
      if (r.json !== undefined) return c.json(r.json as any, r.status as any);
      return c.body(r.body ?? "", r.status as any);
    }
    if (result?.push) {
      // Entrega protegida: antes isto rodava em background com .catch(), então
      // exceção aqui NUNCA podia afetar a resposta HTTP. Ao trazer pro caminho
      // síncrono (necessário pro InvokeResponse do Teams), uma exceção subiria
      // pro middleware de erro e devolveria 500 ao webhook — e 500 pra Meta
      // significa RETRY, ou seja, mensagem de WhatsApp entregue duas vezes ao
      // app e possivelmente resposta duplicada pro cliente. O canal já recebeu a
      // mensagem; falha na ponte é problema nosso, não motivo pra pedir reenvio.
      try {
        const n = bridgeHub.entregar(name, { type: "message", ...(result.push as object) });
        console.log(`[bridge] ${adapter.name} → tenant "${name}" (${n} ponte(s))`);
      } catch (e: any) {
        console.error(`[bridge] falha entregando na ponte de ${name}:`, e?.message || e);
      }
    }
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

  // ── Administração de tenants em RUNTIME ────────────────────────────────────
  // Quem chama é o control-plane da plataforma de agentes, ao provisionar um bot.
  // Antes disso, um bot novo só passava a existir editando BRIDGE_TENANTS e
  // REINICIANDO o gateway — o que derruba a ponte de todos os bots no ar.

  // GET /bridge/tenants — nome, canal e origem. Sem segredo no corpo.
  app.get("/bridge/tenants", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);
    return c.json({ success: true, tenants: listarTenants(), online: bridgeHub.status() });
  });

  // PUT /bridge/tenants/:name — cria ou atualiza. Idempotente.
  app.put("/bridge/tenants/:name", async (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "corpo inválido (esperado JSON)" }, 400);
    }
    const r = registrarTenant(name, body?.channel, body?.wsToken, body?.config || {});
    if (!r.ok) return c.json({ success: false, error: r.erro }, r.status as any);
    return c.json({ success: true, name, criado: r.criado === true }, r.status as any);
  });

  // DELETE /bridge/tenants/:name
  app.delete("/bridge/tenants/:name", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");
    const r = removerTenant(name);
    if (!r.ok) return c.json({ success: false, error: r.erro }, r.status as any);
    return c.json({ success: true, name });
  });

  // GET /bridge/tenants/:name — existe? de onde vem? está online?
  app.get("/bridge/tenants/:name", (c) => {
    const auth = adminAutorizado(c);
    if (!auth.ok) return c.json({ success: false, error: auth.erro }, auth.status as any);

    const name = c.req.param("name");
    const origem = origemDoTenant(name);
    if (!origem) return c.json({ success: false, error: "tenant não encontrado" }, 404);
    const t = tenantDef(name)!;
    return c.json({
      success: true,
      name,
      channel: t.channel,
      origem,
      pontes: bridgeHub.status()[name] || 0,
    });
  });

  return app;
};
