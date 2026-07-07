// meta.controller.ts — módulo de relay da Meta WhatsApp Cloud API.
//
// Faz o wa-gateway virar a PONTE PÚBLICA da Cloud API oficial (além do Baileys):
//
//   ENTRADA (cliente manda WhatsApp):
//     Meta → POST /meta/webhooks → acha o app dono (phone_number_id → META_ROUTES)
//     → repassa (POST) pro webhook do app interno (ex: SAC). SAC guarda no banco dele.
//
//   SAÍDA (atendente responde):
//     App → POST /meta/send {phone_number_id, to, text} → relay pra Graph API do Meta.
//
//   HANDSHAKE (Meta valida o webhook):
//     Meta → GET /meta/webhooks?hub.verify_token=... → devolve o challenge.
//
// Rotas públicas (Meta chama de fora): GET/POST /meta/webhooks.
// Rota interna (app chama): POST /meta/send — protegida pelo KEY middleware.

import { Hono } from "hono";
import axios from "axios";
import { metaConfig, routeForNumber } from "./meta.config";
import { createKeyMiddleware } from "../middlewares/key.middleware";

export const createMetaController = () => {
  const app = new Hono();

  // --- GET /meta/webhooks → handshake de verificação do Meta ---
  app.get("/webhooks", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");

    if (
      mode === "subscribe" &&
      metaConfig.verifyToken &&
      token === metaConfig.verifyToken
    ) {
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
      // Meta exige 200 rápido mesmo em corpo inválido, senão reenvia.
      return c.text("ok");
    }

    // Processa em background pra responder 200 na hora (Meta tem timeout curto).
    routearParaApps(payload).catch((e) =>
      console.error("[meta] erro roteando webhook:", e?.message || e),
    );

    return c.text("ok");
  });

  // --- POST /meta/send → app pede pra enviar; relay pra Graph API ---
  app.post("/send", createKeyMiddleware(), async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "corpo inválido" }, 400);
    }

    const { phone_number_id, to, text } = body || {};
    if (!phone_number_id || !to || !text) {
      return c.json(
        { success: false, error: "phone_number_id, to e text são obrigatórios" },
        400,
      );
    }

    const route = routeForNumber(String(phone_number_id));
    if (!route?.token) {
      return c.json(
        { success: false, error: `sem token Meta pro número ${phone_number_id}` },
        400,
      );
    }

    try {
      const uri = `https://graph.facebook.com/${metaConfig.apiVersion}/${phone_number_id}/messages`;
      const resp = await axios.post(
        uri,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text, preview_url: false },
        },
        {
          headers: {
            Authorization: `Bearer ${route.token}`,
            "Content-Type": "application/json",
          },
        },
      );
      const waId = resp.data?.messages?.[0]?.id ?? null;
      return c.json({ success: true, wa_message_id: waId });
    } catch (error: any) {
      const detail =
        error?.response?.data?.error?.message || error?.message || "erro desconhecido";
      console.error(`[meta] envio falhou (${phone_number_id} → ${to}):`, detail);
      return c.json({ success: false, error: detail }, 502);
    }
  });

  return app;
};

// Distribui o payload do Meta pros apps donos (pelo phone_number_id).
async function routearParaApps(payload: any): Promise<void> {
  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      const route = routeForNumber(phoneNumberId);
      if (!route?.webhook) {
        console.warn(`[meta] número ${phoneNumberId} sem rota configurada (META_ROUTES)`);
        continue;
      }
      // Repassa o value cru pro app processar (ele sabe o que fazer).
      // Mesmo formato de webhook que o Meta manda, só o "value" pra facilitar.
      try {
        await axios.post(
          route.webhook,
          {
            source: "meta",
            phone_number_id: phoneNumberId,
            // entrega no formato Meta (entry/changes) pro app reusar o parser padrão
            entry: [{ changes: [{ value }] }],
          },
          { headers: { "Content-Type": "application/json" }, timeout: 15000 },
        );
        console.log(`[meta] webhook do número ${phoneNumberId} → ${route.webhook}`);
      } catch (e: any) {
        console.error(
          `[meta] falha entregando pro app ${route.webhook}:`,
          e?.message || e,
        );
      }
    }
  }
}
