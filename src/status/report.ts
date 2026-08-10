import type { SessionRow } from "../database/db";

/**
 * Monta o retrato de saúde das sessões.
 *
 * Separado da rota e sem importar `wa-multi-session` de propósito: as
 * dependências entram por parâmetro, então dá para testar a lógica de "quantas
 * faltam" sem subir socket, sem abrir porta e sem tocar o WhatsApp de produção.
 */

export type SessionStatus = {
  name: string;
  monitored: boolean;
  state: string;
  connected: boolean;
  credentials_present: boolean;
  hours_without_message: number | null;
  /**
   * Há quantas horas a sessão está fora. `null` quando conectada — assim o
   * campo nunca precisa ser lido junto com `connected` para fazer sentido.
   *
   * Sai de `last_state_change_at`, que vive no sqlite e portanto sobrevive a
   * restart do container: reiniciar o processo não zera o relógio da queda.
   * `null` também quando a sessão nunca teve evento registrado (cadastrada mas
   * nunca pareada) — inventar "0 horas" ali seria mentir.
   */
  hours_disconnected: number | null;
  disconnected_since: string | null;
  last_message_at: string | null;
  last_state_change_at: string | null;
  last_state_reason: string | null;
};

export type StatusReport = {
  tag: "wa_status";
  ts: string;
  sessions_expected: number;
  sessions_connected: number;
  sessions_down: string[];
  sessions: SessionStatus[];
};

export type ReportDeps = {
  /** Sessão autenticada de verdade (socket com `user`), não só objeto existente. */
  isConnected: (name: string) => boolean;
  /** Credencial do baileys presente em disco. */
  hasCredentials: (name: string) => boolean;
  now: () => Date;
};

/**
 * O sqlite grava CURRENT_TIMESTAMP como "YYYY-MM-DD HH:MM:SS" em UTC, sem
 * marcador de fuso. `new Date("2026-08-10 14:21:30")` é interpretado pelo Node
 * como horário LOCAL — o que jogaria `hours_without_message` 3 horas para o
 * lado num servidor em America/Sao_Paulo, silenciosamente. Daí a normalização
 * explícita para ISO com Z.
 */
export function parseSqliteUtc(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursBetween(from: Date, to: Date): number {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  return Math.round(hours * 10) / 10;
}

export function buildSessionStatus(
  row: SessionRow,
  deps: ReportDeps
): SessionStatus {
  const connected = deps.isConnected(row.name);
  const lastMessage = parseSqliteUtc(row.last_message_at);
  const lastChange = parseSqliteUtc(row.last_state_change_at);
  // Só conta como "desde quando está fora" se ela está fora AGORA. Com a
  // sessão no ar, `last_state_change_at` é o momento em que ela CONECTOU —
  // reportar isso como tempo de queda seria o oposto da verdade.
  const downSince = !connected && lastChange ? lastChange : null;

  return {
    name: row.name,
    monitored: row.monitored === 1,
    // `connected` é a verdade viva do socket; `last_state` é o último evento
    // registrado. Podem divergir (processo reiniciado, evento antigo), então o
    // socket manda quando está conectado.
    state: connected ? "connected" : row.last_state ?? "unknown",
    connected,
    // A pergunta que decide se um restart resolve ou se precisa de gente com o
    // celular na mão: a lib apaga a credencial em loggedOut e aí só QR resolve.
    credentials_present: deps.hasCredentials(row.name),
    // Número puro, sem juízo de valor — quem decide se N horas é problema é o
    // monitoramento, não este serviço. `null` = nunca recebeu nada.
    hours_without_message: lastMessage
      ? hoursBetween(lastMessage, deps.now())
      : null,
    // "Qual caiu" vem do nome; "há quanto tempo" vem daqui. Número puro, pelo
    // mesmo motivo de hours_without_message: quem decide o que é grave é o
    // monitoramento. `null` quando conectada, e também quando a sessão nunca
    // teve evento — inventar 0 ali seria dizer "acabou de cair".
    hours_disconnected: downSince ? hoursBetween(downSince, deps.now()) : null,
    disconnected_since: downSince ? downSince.toISOString() : null,
    last_message_at: lastMessage ? lastMessage.toISOString() : null,
    last_state_change_at: lastChange ? lastChange.toISOString() : null,
    last_state_reason: row.last_state_reason,
  };
}

export function buildStatusReport(
  rows: SessionRow[],
  deps: ReportDeps
): StatusReport {
  const sessions = rows.map((row) => buildSessionStatus(row, deps));
  const monitored = sessions.filter((s) => s.monitored);

  return {
    tag: "wa_status",
    ts: deps.now().toISOString(),
    // Só sessão monitorada entra na conta. Sessão desligada de propósito não
    // pode manter o agregado vermelho para sempre — alerta que sempre grita
    // ensina todo mundo a ignorar o painel.
    sessions_expected: monitored.length,
    sessions_connected: monitored.filter((s) => s.connected).length,
    sessions_down: monitored.filter((s) => !s.connected).map((s) => s.name),
    // A lista completa inclui as não monitoradas: o painel humano mostra tudo,
    // a conta do alerta considera só o que se pediu para vigiar.
    sessions,
  };
}
