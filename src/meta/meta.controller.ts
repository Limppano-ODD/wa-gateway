// meta.controller.ts — rotas HTTP do relay Meta (webhooks públicos).
//
// O gateway é a PONTE PÚBLICA da Cloud API oficial. O Meta alcança essas rotas.
// A ENTREGA pro app interno (SAC) é pela ponte WebSocket (ver meta.ws.ts) — o app
// disca pro gateway e escuta; aqui a gente só recebe do Meta e empurra pelo hub.
//
//   GET  /meta/webhooks → handshake de verificação do Meta (META_VERIFY_TOKEN)
//   POST /meta/webhooks → mensagem do Meta → empurra pro app dono (via hub/WebSocket)
//   GET  /meta/status   → apps conectados agora (debug)
//
// Envio (SAC → Meta) é feito pela própria ponte WebSocket (type:"send"), ver meta.ws.ts.

import { Hono } from "hono";
import { metaConfig, routeForNumber, appForToken } from "./meta.config";
import { metaHub } from "./meta.hub";
import { relaySend } from "./meta.send";

export const createMetaController = () => {
  const app = new Hono();

  // --- GET /meta/webhooks → handshake do Meta ---
  app.get("/webhooks", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (mode === "subscribe" && metaConfig.verifyToken && token === metaConfig.verifyToken) {
      return c.text(challenge ?? "");
    }
    return c.text("forbidden", 403);
  });

  // --- POST /meta/webhooks → mensagem chegando do Meta ---
  app.post("/webhooks", async (c) => {
    let payload: any;
    try {
      payload = await c.req.json();
    } catch {
      return c.text("ok"); // Meta exige 200 rápido mesmo em corpo inválido
    }
    // Responde 200 na hora e empurra pras pontes em background.
    try {
      rotearParaApps(payload);
    } catch (e: any) {
      console.error("[meta] erro roteando webhook:", e?.message || e);
    }
    return c.text("ok");
  });

  // --- POST /meta/send → app envia por HTTP (saída; funciona do app interno) ---
  // Auth pelo token do app (?token= ou header x-app-token). O app só pode enviar
  // pelos números que são DELE (META_ROUTES[pnid].app === app do token).
  app.post("/send", async (c) => {
    const token = c.req.query("token") || c.req.header("x-app-token");
    const appNome = appForToken(token);
    if (!appNome) return c.json({ success: false, error: "token inválido" }, 401);

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "corpo inválido" }, 400);
    }
    const { phone_number_id, to, text } = body || {};
    const route = routeForNumber(String(phone_number_id));
    if (!route || route.app !== appNome) {
      return c.json(
        { success: false, error: `número ${phone_number_id} não pertence ao app ${appNome}` },
        403,
      );
    }

    const r = await relaySend(phone_number_id, to, text);
    return c.json(
      { success: r.ok, wa_message_id: r.wa_message_id ?? null, error: r.error ?? null },
      r.ok ? 200 : 502,
    );
  });

  // --- GET /meta/status → apps conectados (debug) ---
  app.get("/status", (c) => c.json({ apps_online: metaHub.status() }));

  return app;
};

// Empurra o payload do Meta pras pontes dos apps donos (pelo phone_number_id).
function rotearParaApps(payload: any): void {
  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      const route = routeForNumber(phoneNumberId);
      if (!route?.app) {
        console.warn(`[meta] número ${phoneNumberId} sem app configurado (META_ROUTES)`);
        continue;
      }
      // Empurra no formato Meta (entry/changes/value) pro app reusar o parser padrão.
      const n = metaHub.entregar(route.app, {
        type: "webhook",
        source: "meta",
        phone_number_id: phoneNumberId,
        entry: [{ changes: [{ value }] }],
      });
      console.log(`[meta] webhook do número ${phoneNumberId} → app "${route.app}" (${n} ponte(s))`);
    }
  }
}
