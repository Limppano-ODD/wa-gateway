import { Hono } from "hono";
import { sessionDb } from "../database/db";
import { env } from "../env";
import { statusTokenMiddleware } from "../middlewares/status-token.middleware";
import { buildSessionStatus, buildStatusReport } from "../status/report";
import type { ReportDeps } from "../status/report";
import { hasCredentials, isConnected } from "../status/probes";

/**
 * Endpoints de verdade sobre as sessões, para o Gatus consumir com condição
 * sobre o CORPO da resposta.
 *
 * Por que não usar o /health para isso: o /health é o healthcheck do Docker. Se
 * ele passar a falhar quando uma sessão cai, o container entra em loop de
 * restart e some a janela para escanear o QR — que é exatamente o que a queda
 * exige de um humano. Liveness do processo e saúde da integração são perguntas
 * diferentes e precisam de endpoints diferentes.
 *
 * Uso no Gatus:
 *   agregado      -> "[BODY].sessions_connected == [BODY].sessions_expected"
 *   por sessão    -> "[BODY].connected == true" e "[BODY].credentials_present == true"
 *
 * O endpoint por sessão existe porque o Gatus alerta por endpoint: com só o
 * agregado, o alerta chega dizendo que algo caiu, sem dizer o quê.
 */

export const createStatusController = () => {
  const app = new Hono();

  app.use("*", statusTokenMiddleware(env.STATUS_TOKEN));

  const deps: ReportDeps = {
    isConnected,
    hasCredentials,
    now: () => new Date(),
  };

  app.get("/", (c) => c.json(buildStatusReport(sessionDb.getAll(), deps)));

  app.get("/:session", (c) => {
    const name = c.req.param("session");
    const row = sessionDb.getByName(name);

    if (!row) {
      return c.json({ error: `Sessão '${name}' não cadastrada` }, 404);
    }

    return c.json({
      tag: "wa_session_status",
      ts: deps.now().toISOString(),
      ...buildSessionStatus(row, deps),
    });
  });

  return app;
};
