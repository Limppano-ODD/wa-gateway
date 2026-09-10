import { Hono } from "hono";
import { createKeyMiddleware } from "../middlewares/key.middleware";
import { requestValidator } from "../middlewares/validation.middleware";
import { z } from "zod";
import * as whatsapp from "wa-multi-session";
import { HTTPException } from "hono/http-exception";
import { basicAuthMiddleware } from "../middlewares/auth.middleware";
import type { User } from "../database/db";
import { messageStore } from "../utils/message-store";
import { sessionDb } from "../database/db";
import { registrarEnvio } from "../utils/mensagem-diagnostico";

type Variables = {
  user: User;
};

export const createMessageController = () => {
  const app = new Hono<{ Variables: Variables }>();
  

  // Apply basic auth to all message routes
  app.use("*", basicAuthMiddleware());

  const sendMessageSchema = z.object({
    session: z.string(),
    to: z.string(),
    text: z.string(),
    is_group: z.boolean().optional(),
    quoted_message_id: z.string().optional(), // Message ID to reply to
  });

  app.post(
    "/send-text",
    requestValidator("json", sendMessageSchema),
    async (c) => {
      const payload = c.req.valid("json");
      const user = c.get("user") as User;
      
      // For non-admin users, verify session matches their username (session name = username)
      const expectedSession = user.username;
      if (user.is_admin !== 1 && payload.session !== expectedSession) {
        throw new HTTPException(403, {
          message: `You can only use your session: ${expectedSession}`,
        });
      }
      
      const isExist = whatsapp.getSession(payload.session);
      if (!isExist) {
        throw new HTTPException(400, {
          message: "Session does not exist",
        });
      }

      // A sessão EXISTIR não quer dizer que ela esteja no ar. Enquanto ela
      // estiver reconectando, o envio era aceito e respondido 200 — e a
      // mensagem chegava ilegível no aparelho do destinatário, porque saía
      // cifrada com uma chave que a reconexão descarta ("Aguardando
      // mensagem"). Quem chamou nunca ficava sabendo.
      //
      // `last_state` null = sessão que ainda não registrou transição nenhuma;
      // aí não bloqueia, para não recusar envio de sessão antiga só por falta
      // de histórico.
      const estado = sessionDb.getByName(payload.session)?.last_state;
      if (estado && estado !== "connected") {
        throw new HTTPException(503, {
          message: `Session "${payload.session}" is ${estado} — message not sent`,
        });
      }

      await whatsapp.sendTyping({
        sessionId: payload.session,
        to: payload.to,
        duration: Math.min(5000, payload.text.length * 100),
        isGroup: payload.is_group,
      });

      // Prepare send options
      const sendOptions: any = {
        sessionId: payload.session,
        to: payload.to,
        text: payload.text,
        isGroup: payload.is_group,
      };

      // If quoted_message_id is provided, retrieve the original message and add it
      if (payload.quoted_message_id) {
        const quotedMessage = messageStore.getMessage(
          payload.session,
          payload.quoted_message_id
        );

        if (quotedMessage) {
          sendOptions.answering = quotedMessage;
        } else {
          console.warn(
            `Message ${payload.quoted_message_id} not found in store for quoting`
          );
        }
      }

      const response = await whatsapp.sendTextMessage(sendOptions);
      registrarEnvio(payload.session, response?.key?.id ?? undefined, payload.to);

      return c.json({
        data: response,
      });
    }
  );

  /**
   * @deprecated
   * This endpoint is deprecated, use POST /send-text instead
   */
  app.get(
    "/send-text",
    requestValidator("query", sendMessageSchema),
    async (c) => {
      const payload = c.req.valid("query");
      const user = c.get("user") as User;
      
      // For non-admin users, ensure they can only use their own sessions (username = session name)
      const expectedSession = user.username;
      if (user.is_admin !== 1 && payload.session !== expectedSession) {
        throw new HTTPException(403, {
          message: `You can only use your session: ${expectedSession}`,
        });
      }
      
      const isExist = whatsapp.getSession(payload.session);
      if (!isExist) {
        throw new HTTPException(400, {
          message: "Session does not exist",
        });
      }

      const response = await whatsapp.sendTextMessage({
        sessionId: payload.session,
        to: payload.to,
        text: payload.text,
      });

      return c.json({
        data: response,
      });
    }
  );

  app.post(
    "/send-image",
    requestValidator(
      "json",
      sendMessageSchema.merge(
        z.object({
          image_url: z.string(),
        })
      )
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const user = c.get("user") as User;
      
      // For non-admin users, ensure they can only use their own sessions
      const expectedSession = user.username;
      if (user.is_admin !== 1 && payload.session !== expectedSession) {
        throw new HTTPException(403, {
          message: `You can only use your session: ${expectedSession}`,
        });
      }
      
      const isExist = whatsapp.getSession(payload.session);
      if (!isExist) {
        throw new HTTPException(400, {
          message: "Session does not exist",
        });
      }

      await whatsapp.sendTyping({
        sessionId: payload.session,
        to: payload.to,
        duration: Math.min(5000, payload.text.length * 100),
        isGroup: payload.is_group,
      });

      // Build send options
      const sendOptions: any = {
        sessionId: payload.session,
        to: payload.to,
        text: payload.text,
        media: payload.image_url,
        isGroup: payload.is_group,
      };

      // If quoted_message_id is provided, retrieve and add the original message
      if (payload.quoted_message_id) {
        const quotedMessage = messageStore.getMessage(
          payload.session,
          payload.quoted_message_id
        );

        if (quotedMessage) {
          sendOptions.answering = quotedMessage;
        }
      }

      const response = await whatsapp.sendImage(sendOptions);

      return c.json({
        data: response,
      });
    }
  );
  app.post(
    "/send-document",
    requestValidator(
      "json",
      sendMessageSchema.merge(
        z.object({
          document_url: z.string(),
          document_name: z.string(),
        })
      )
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const user = c.get("user") as User;
      
      // For non-admin users, ensure they can only use their own sessions
      const expectedSession = user.username;
      if (user.is_admin !== 1 && payload.session !== expectedSession) {
        throw new HTTPException(403, {
          message: `You can only use your session: ${expectedSession}`,
        });
      }
      
      const isExist = whatsapp.getSession(payload.session);
      if (!isExist) {
        throw new HTTPException(400, {
          message: "Session does not exist",
        });
      }

      await whatsapp.sendTyping({
        sessionId: payload.session,
        to: payload.to,
        duration: Math.min(5000, payload.text.length * 100),
        isGroup: payload.is_group,
      });

      // Build send options
      const sendOptions: any = {
        sessionId: payload.session,
        to: payload.to,
        text: payload.text,
        media: payload.document_url,
        filename: payload.document_name,
        isGroup: payload.is_group,
      };

      // If quoted_message_id is provided, retrieve and add the original message
      if (payload.quoted_message_id) {
        const quotedMessage = messageStore.getMessage(
          payload.session,
          payload.quoted_message_id
        );

        if (quotedMessage) {
          sendOptions.answering = quotedMessage;
        }
      }

      const response = await whatsapp.sendDocument(sendOptions);

      return c.json({
        data: response,
      });
    }
  );

  app.post(
    "/send-sticker",
    requestValidator(
      "json",
      sendMessageSchema.merge(
        z.object({
          image_url: z.string(),
        })
      )
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const user = c.get("user") as User;
      
      // For non-admin users, ensure they can only use their own sessions
      const expectedSession = user.username;
      if (user.is_admin !== 1 && payload.session !== expectedSession) {
        throw new HTTPException(403, {
          message: `You can only use your session: ${expectedSession}`,
        });
      }
      
      const isExist = whatsapp.getSession(payload.session);
      if (!isExist) {
        throw new HTTPException(400, {
          message: "Session does not exist",
        });
      }

      // Build send options
      const sendOptions: any = {
        sessionId: payload.session,
        to: payload.to,
        media: payload.image_url,
        isGroup: payload.is_group,
      };

      // If quoted_message_id is provided, retrieve and add the original message
      if (payload.quoted_message_id) {
        const quotedMessage = messageStore.getMessage(
          payload.session,
          payload.quoted_message_id
        );

        if (quotedMessage) {
          sendOptions.answering = quotedMessage;
        }
      }

      const response = await whatsapp.sendSticker(sendOptions);

      return c.json({
        data: response,
      });
    }
  );

  return app;
};
