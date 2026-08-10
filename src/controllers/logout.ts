import { Hono } from "hono";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Mesmo realm do basicAuthMiddleware — isso NÃO é detalhe cosmético. O browser
 * indexa a credencial em cache pela dupla (origin, realm) e a reenvia sozinho.
 * Um 401 com realm diferente não limpa nada e o "logoff" falha em silêncio.
 */
export const BASIC_REALM = 'Basic realm="WA Gateway"';

/**
 * Rota de logoff. HTTP Basic não tem logout nativo: enquanto o browser guarda a
 * credencial, quem entrou como um usuário não consegue entrar como outro (era o
 * que bloqueava re-parear as sessões crm-vendas e compras1, cada uma exigindo
 * login com o usuário correspondente). O 401 no mesmo realm é o que faz
 * Chrome/Edge/Firefox descartarem o cache e voltarem a perguntar usuário e senha.
 *
 * PÚBLICA de propósito: se passasse pelo basicAuthMiddleware, alcançá-la já
 * exigiria a credencial que ela existe para descartar.
 */
export const createLogoutController = () => {
  const app = new Hono();

  app.get("/", (c) => {
    const html = readFileSync(join(__dirname, "../views/logout.html"), "utf-8");

    // Resposta montada à mão em vez de `throw new HTTPException(401)`: o
    // globalErrorMiddleware devolveria JSON e o WWW-Authenticate se perderia
    // no caminho — sem esse header o browser não limpa a credencial.
    return c.html(html, 401, { "WWW-Authenticate": BASIC_REALM });
  });

  return app;
};
