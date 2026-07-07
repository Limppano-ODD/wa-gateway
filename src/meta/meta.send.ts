// meta.send.ts — relay de envio pra Graph API do Meta (compartilhado por
// WebSocket (type:"send") e HTTP (POST /meta/send)).

import axios from "axios";
import { metaConfig, routeForNumber } from "./meta.config";

export interface SendResult {
  ok: boolean;
  wa_message_id?: string | null;
  error?: string;
}

// Envia texto por um phone_number_id usando o token Meta daquele número (META_ROUTES).
export async function relaySend(
  phoneNumberId: string | undefined,
  to: string | undefined,
  text: string | undefined,
): Promise<SendResult> {
  const route = routeForNumber(String(phoneNumberId));
  if (!route?.token) {
    return { ok: false, error: `sem token Meta pro número ${phoneNumberId}` };
  }
  if (!to || !text) {
    return { ok: false, error: "to e text são obrigatórios" };
  }
  try {
    const uri = `https://graph.facebook.com/${metaConfig.apiVersion}/${phoneNumberId}/messages`;
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
    return { ok: true, wa_message_id: resp.data?.messages?.[0]?.id ?? null };
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message || error?.message || "erro desconhecido";
    return { ok: false, error: detail };
  }
}
