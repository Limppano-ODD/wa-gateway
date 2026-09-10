// whatsapp.ts — adapter do canal WhatsApp (Meta Cloud API).
//
// - verify: handshake do webhook (hub.verify_token == config.verifyToken)
// - receive: valida (o Meta não assina por padrão aqui; opcionalmente checar
//   x-hub-signature-256 com o appSecret), parseia entry/changes/value.
// - send: POST na Graph API com o token do número (config.metaToken).
//
// config do tenant (channel: "whatsapp"):
//   { verifyToken, phoneNumberId, metaToken, apiVersion? }

import axios from "axios";
import type { TenantDef } from "../config";
import type { ChannelAdapter, IngestResult, SendResult, VerifyResult } from "./types";

export const whatsappAdapter: ChannelAdapter = {
  name: "whatsapp",

  verify(query: URLSearchParams, tenant: TenantDef): VerifyResult | null {
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");
    const expected = tenant.config.verifyToken;
    if (mode === "subscribe" && expected && token === expected) {
      return { status: 200, body: challenge ?? "" };
    }
    return { status: 403, body: "forbidden" };
  },

  async receive(rawBody: string): Promise<IngestResult | null> {
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    // Entrega o value cru (formato Meta) pro agente reusar o parser padrão.
    // Empurra 1 por change; aqui simplificamos empurrando o payload inteiro
    // (o agente itera entry/changes/value).
    return { push: { source: "whatsapp", entry: payload.entry ?? [] } };
  },

  // Envia texto OU botões interativos. payload:
  //   { to, text }                                  → mensagem de texto
  //   { to, interactive: { body, buttons:[{id,title}] } } → botões clicáveis (máx 3)
  async send(payload: Record<string, any>, tenant: TenantDef): Promise<SendResult> {
    const { to, text, interactive } = payload;
    const { phoneNumberId, metaToken } = tenant.config;
    const apiVersion = tenant.config.apiVersion || "v20.0";
    if (!metaToken || !phoneNumberId) return { ok: false, error: "tenant whatsapp sem metaToken/phoneNumberId" };
    if (!to) return { ok: false, error: "to obrigatório" };

    let body: Record<string, any>;
    if (interactive && Array.isArray(interactive.buttons) && interactive.buttons.length) {
      body = {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: String(interactive.body || "").slice(0, 1024) },
          action: {
            buttons: interactive.buttons.slice(0, 3).map((b: any) => ({
              type: "reply",
              reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) },
            })),
          },
        },
      };
    } else if (text) {
      body = { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } };
    } else {
      return { ok: false, error: "text ou interactive obrigatório" };
    }

    try {
      const uri = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
      const resp = await axios.post(uri, body, {
        headers: { Authorization: `Bearer ${metaToken}`, "Content-Type": "application/json" },
      });
      return { ok: true, id: resp.data?.messages?.[0]?.id ?? null };
    } catch (error: any) {
      const detail = error?.response?.data?.error?.message || error?.message || "erro desconhecido";
      return { ok: false, error: detail };
    }
  },
};
