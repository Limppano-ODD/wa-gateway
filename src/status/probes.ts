import fs from "fs";
import path from "path";
import * as whatsapp from "wa-multi-session";

/**
 * Sondas reais, isoladas do `report.ts` para que a lógica do relatório continue
 * testável sem importar `wa-multi-session` (importar a lib num teste puxa
 * baileys e o socket junto).
 */

/**
 * Espelha o caminho que a wa-multi-session usa internamente:
 * `path.resolve(CREDENTIALS.DIR_NAME, sessionId + CREDENTIALS.PREFIX)`.
 * Se a lib mudar essa convenção, isto tem que mudar junto — daí a constante
 * estar aqui e não espalhada.
 */
const CREDENTIALS_DIR = "wa_credentials";
const CREDENTIALS_SUFFIX = "_credentials";

export function credentialsPath(sessionName: string): string {
  return path.resolve(CREDENTIALS_DIR, `${sessionName}${CREDENTIALS_SUFFIX}`);
}

/**
 * Diretório existir não basta: a lib faz `rmSync(dir, {recursive:true})` no
 * logout, e já foi observado o diretório-pai existir vazio. Só há credencial
 * se houver arquivo dentro.
 */
export function hasCredentials(sessionName: string): boolean {
  try {
    return fs.readdirSync(credentialsPath(sessionName)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Conectada = socket existe E está autenticado (`user` preenchido). Só checar a
 * existência do objeto daria "conectado" para sessão em processo de pareamento,
 * que é o mesmo engano do /health devolver 200 sem sessão nenhuma.
 */
export function isConnected(sessionName: string): boolean {
  const session = whatsapp.getSession(sessionName) as
    | { user?: unknown }
    | undefined;
  return !!session?.user;
}
