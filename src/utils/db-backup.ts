import fs from "fs";
import path from "path";
import db from "../database/db";
import { env } from "../env";

/**
 * Backup do sqlite.
 *
 * O banco guarda os usuários, as callback URLs e os tokens de autenticação dos
 * webhooks — tudo num arquivo só, num volume só, sem cópia em lugar nenhum.
 * Perder esse arquivo custa re-parear todas as sessões e reconfigurar os
 * webhooks na mão, sem ter de onde consultar os valores antigos.
 *
 * Usa `db.backup()` (API de backup online do sqlite) e não `fs.copyFile`:
 * copiar o arquivo com o processo escrevendo produz cópia inconsistente, e o
 * WAL fica de fora. O backup online lida com isso.
 *
 * Grava em `<dir do DB_PATH>/backups`, que em produção fica dentro do bind
 * mount `db/` — o único lugar que o deploy preserva.
 */

export function backupDir(): string {
  return path.join(path.dirname(path.resolve(env.DB_PATH)), "backups");
}

function timestampSuffix(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

/** Apaga os mais antigos, mantendo os `keep` mais recentes. */
export function pruneBackups(dir: string, keep: number): string[] {
  if (keep <= 0) return [];

  const removed: string[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("wa_gateway-") && f.endsWith(".db"))
    // O nome carrega timestamp ISO compactado, então ordem lexicográfica é
    // ordem cronológica — não depende de mtime, que muda ao copiar volume.
    .sort()
    .reverse();

  for (const file of files.slice(keep)) {
    fs.rmSync(path.join(dir, file), { force: true });
    removed.push(file);
  }

  return removed;
}

export async function runBackup(now: Date = new Date()): Promise<string> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const destination = path.join(dir, `wa_gateway-${timestampSuffix(now)}.db`);
  await db.backup(destination);
  pruneBackups(dir, env.DB_BACKUP_KEEP);

  return destination;
}

/**
 * Roda um backup no boot e reagenda no intervalo configurado. Falha de backup
 * NUNCA derruba o processo: ficar sem cópia é ruim, ficar sem gateway é pior.
 * Mas loga em JSON estruturado, para não falhar em silêncio — que é o padrão
 * que este serviço inteiro está tentando abandonar.
 */
export function scheduleBackups(): void {
  const hours = env.DB_BACKUP_INTERVAL_HOURS;

  if (!hours || hours <= 0) {
    console.log(JSON.stringify({ tag: "db_backup", event: "disabled" }));
    return;
  }

  const run = async () => {
    try {
      const file = await runBackup();
      console.log(
        JSON.stringify({ tag: "db_backup", event: "ok", file, keep: env.DB_BACKUP_KEEP })
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          tag: "db_backup",
          event: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  void run();
  setInterval(run, hours * 3_600_000).unref();
}
