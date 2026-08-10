# `/status` — o que monitorar, e por que não é o `/health`

## Por que existem dois endpoints

`GET /health` responde `200 {"status":"ok"}` **incondicionalmente**, e vai continuar assim. Ele é o healthcheck do Docker: mede se o processo está de pé.

Isso não é suficiente e já falhou de forma cara. Entre 21/07 e 10/08/2026 o serviço ficou 20 dias sem nenhuma sessão WhatsApp conectada, com o `/health` verde o tempo todo e o container marcado como `healthy` — ver [`docs/incidents/2026-08-10-sessao-whatsapp-apagada-20-dias.md`](incidents/2026-08-10-sessao-whatsapp-apagada-20-dias.md).

**E o `/health` não pode ser "consertado" para refletir as sessões.** Se ele falhar quando uma sessão cai, o Docker reinicia o container em loop — e some justamente a janela em que um humano precisa abrir o painel e escanear o QR. Liveness do processo e saúde da integração são perguntas diferentes, com consequências diferentes quando a resposta é "não".

## Autenticação

Bearer token, via `STATUS_TOKEN` (mínimo 24 caracteres).

Sem token configurado, os endpoints devolvem **503** — não 200 vazio. Fail-closed e barulhento: o monitoramento alerta que não está conseguindo medir, em vez de reportar verde sobre nada.

```
Authorization: Bearer <STATUS_TOKEN>
```

## `GET /status` — agregado

```json
{
  "tag": "wa_status",
  "ts": "2026-08-10T14:45:00.000Z",
  "sessions_expected": 2,
  "sessions_connected": 1,
  "sessions_down": ["compras1"],
  "sessions": [
    {
      "name": "crm-vendas",
      "monitored": true,
      "state": "connected",
      "connected": true,
      "credentials_present": true,
      "hours_without_message": 0.4,
      "hours_disconnected": 0,
      "disconnected_since": null,
      "last_message_at": "2026-08-10T14:21:19.000Z",
      "last_state_change_at": "2026-08-10T14:21:04.000Z",
      "last_state_reason": null
    }
  ]
}
```

## `GET /status/:session` — uma sessão

Mesmo objeto da lista, com `tag: "wa_session_status"` e `ts`. Responde **404** se a sessão não estiver cadastrada.

Existe porque o Gatus alerta **por endpoint**: com apenas o agregado, o alerta chega dizendo que algo caiu, sem dizer o quê. Um monitor por sessão faz o alerta já nascer identificando a sessão, e dá histórico de uptime separado.

## Os campos que importam

| Campo | Para que serve |
|---|---|
| `connected` | Verdade viva do socket: existe **e** está autenticado (`user` preenchido). Sessão em pareamento não conta como conectada |
| `credentials_present` | **Decide se um restart resolve.** A biblioteca apaga o diretório de credenciais em `loggedOut`; sem credencial, só QR humano religa. Era a informação que só se obtinha com `ls` no volume |
| `hours_disconnected` / `disconnected_since` | **Há quanto tempo está fora.** `hours_disconnected` é **`0` quando conectada** — literal, está fora há zero horas. Ser sempre número no caso saudável é o que permite a condição `[BODY].hours_disconnected == 0`: quando ela falha, o Gatus substitui o valor real na mensagem (`[BODY].hours_disconnected (12.4) == 0`), então **o alerta já chega dizendo há quanto tempo caiu**. `null` fica reservado ao caso em que não se sabe: fora, sem nenhum evento registrado. Sai de `last_state_change_at`, que vive no sqlite — **reiniciar o container não zera o relógio da queda** |
| `hours_without_message` | Número puro, sem juízo de valor — o limiar é decisão do monitoramento, não deste serviço. `null` = nunca recebeu nada. Conta qualquer mensagem recebida (inclusive `fromMe` e broadcast): mede o canal entregando, não atividade comercial. Pega o modo de falha que **não** gera evento de desconexão |
| `monitored` | Sessão pode estar cadastrada e deliberadamente fora do alerta. Só as monitoradas entram em `sessions_expected` / `sessions_connected` / `sessions_down` — alerta que grita para sempre ensina todo mundo a ignorar o painel |
| `last_state_reason` | Hoje quase sempre `null`: a `wa-multi-session` não repassa o `DisconnectReason` nos callbacks. O sinal prático de logout é `credentials_present: false` |

## Condições no Gatus

Agregado:

```yaml
- name: wa-gateway (agregado)
  url: "https://wa-gateway.odd.com.br/status"
  headers:
    Authorization: "Bearer ${STATUS_TOKEN}"
  conditions:
    - "[STATUS] == 200"
    - "[BODY].sessions_connected == [BODY].sessions_expected"
```

Por sessão:

```yaml
- name: wa-gateway / crm-vendas
  url: "https://wa-gateway.odd.com.br/status/crm-vendas"
  headers:
    Authorization: "Bearer ${STATUS_TOKEN}"
  conditions:
    - "[STATUS] == 200"
    - "[BODY].connected == true"
    - "[BODY].credentials_present == true"
    # Nao e redundante com `connected`: quando esta condicao falha, o Gatus
    # substitui o valor real na mensagem do alerta --
    #   [BODY].hours_disconnected (12.4) == 0
    # -- entao o alerta ja chega dizendo QUAL sessao caiu (nome do monitor) e
    # HA QUANTO TEMPO, sem ninguem precisar abrir o painel.
    - "[BODY].hours_disconnected == 0"
```

**Não monitorar com `[STATUS] == 200` apenas.** É o padrão dos outros endpoints do parque hoje, e é exatamente o que deixaria este serviço verde estando quebrado.

## Limitação conhecida

Com `sessions_expected == 0` (nenhuma sessão cadastrada ou todas desmarcadas), a condição `sessions_connected == sessions_expected` passa. Zero é igual a zero. O agregado sozinho não distingue "tudo bem" de "não há nada sendo medido" — é mais uma razão para manter também os monitores por sessão, que somem do Gatus de forma visível se a sessão deixar de existir.

## Operação

Tirar uma sessão do alerta sem apagar o histórico:

```sql
UPDATE sessions SET monitored = 0 WHERE name = 'compras1';
```

Histórico de transições de estado:

```sql
SELECT created_at, state FROM session_events
 WHERE session_name = 'crm-vendas'
 ORDER BY created_at DESC LIMIT 20;
```

## Backup do sqlite

O mesmo banco guarda usuários, callback URLs e tokens de autenticação de webhook, num arquivo só e num volume só. `DB_BACKUP_INTERVAL_HOURS` (padrão 24, `0` desliga) roda no boot e no intervalo, mantendo as `DB_BACKUP_KEEP` cópias mais recentes em `<dir do DB_PATH>/backups`.

Usa a API de backup online do sqlite, não `cp`: copiar o arquivo com o processo escrevendo produz cópia inconsistente e deixa o WAL de fora. Falha de backup loga em JSON e **não** derruba o processo — ficar sem cópia é ruim, ficar sem gateway é pior.
