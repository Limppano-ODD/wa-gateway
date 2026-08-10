# Sessão WhatsApp apagada e 20 dias de silêncio

- **Data da descoberta:** 2026-08-10
- **Janela da falha:** 2026-07-21 15:08 → 2026-08-10 14:21 (~20 dias)
- **Componentes:** `wa-gateway` (causa), `limppano-crm` e `data-gateway` (afetados)
- **Impacto:** nenhuma mensagem WhatsApp entrou ou saiu. O bot de vendas do CRM ficou mudo pros vendedores. O lembrete de entrega do data-gateway parou de entregar.

## Sintoma

O CRM não recebia nem enviava WhatsApp. Nada indicava problema:

- `docker ps` mostrava `wa-gateway` e `limppano-crm` como `Up (healthy)`
- `GET /health` do wa-gateway devolvia `200 {"status":"ok"}`
- Nenhum erro nos logs do wa-gateway além de healthchecks

O único sinal era do lado de quem chamava: o data-gateway registrava, a cada rodada do cron de lembrete, ~30 falhas em sequência:

```
POST /message/send-text → 400 {"message":"Session does not exist"}
```

## Causa raiz

**O wa-gateway não tinha nenhuma sessão WhatsApp.** As credenciais do baileys tinham sido apagadas do disco.

Evidência:

| Verificação | Resultado |
|---|---|
| `ls /app/wa-gateway/wa_credentials/` | **vazio**, `mtime` do diretório em 28/07 22:04 |
| `users.session_name` no sqlite | **NULL** pros dois usuários (`crm-vendas` id=1, `compras1` id=2) |
| Log de boot de 05/08 | `loadSessionsFromStorage()` carregou zero; nenhum `session: '<x>' connected` |
| `message_log` do CRM | última mensagem WhatsApp em **21/07 15:08** |

O apagamento é comportamento da biblioteca, não bug nosso. Em `wa-multi-session@3.8.3`, `dist/Socket/*.js:104-114`:

```js
if (code != DisconnectReason.loggedOut && retryAttempt < 10) {
  // reconecta
} else {
  deleteSession(sessionId);   // → fs.rmSync(dir, { force: true, recursive: true })
}
```

Ou seja: em `loggedOut`, **ou** depois de 10 tentativas de reconexão falhas, a biblioteca **apaga o diretório de credenciais**. O celular desvinculou por volta de 21/07, os retries se esgotaram, e em 28/07 22:04 as credenciais foram removidas. O deploy de 05/08 (que trouxe a ponte multi-canal) simplesmente subiu um processo sem sessão nenhuma pra carregar.

**Consequência operacional que não é óbvia:** credencial apagada não se resolve com restart. Exige um humano com o celular do número corporativo escaneando QR. Distinguir "caiu e reconecta sozinho" de "credencial apagada, precisa de gente" é a informação mais valiosa do diagnóstico, e hoje ela só existe fazendo `ls` no volume.

## Por que ficou 20 dias no escuro

A queda do WhatsApp é normal e vai acontecer de novo. **O incidente real é a cegueira**, e ela tinha três causas independentes — qualquer uma delas resolvida teria cortado o tempo de detecção pra minutos.

### 1. O webhook de status do wa-gateway aponta pra uma rota que não existe

O wa-gateway notifica mudança de estado de sessão em `${callback_url}/session`:

```ts
whastapp.onDisconnected((session) => {
  console.log(`session: '${session}' disconnected`);
  sendSessionWebhook(session, "disconnected");
});
```

No CRM, essa rota nunca foi implementada:

```
POST https://crm.odd.com.br/api/webhooks/whatsapp/session → 404
```

O evento `disconnected` foi disparado e descartado. E `sendWebhookWithAuth` engole a falha num `console.error` — ninguém no CRM soube, e ninguém no wa-gateway se importou.

### 2. `/health` mente por construção

```ts
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});
```

Esse endpoint devolveu `200 {"status":"ok"}` durante os 20 dias inteiros, com zero sessões conectadas. O healthcheck do Docker bateu nele a cada 30s e reportou `healthy`. Liveness do processo é uma pergunta legítima — mas era a única pergunta que alguém estava fazendo, e não era a pergunta que importava.

### 3. O monitoramento dormia, e nem monitorava este serviço

O Gatus do parque roda no host de homologação, que é **desligado fora do horário comercial** — todo container de lá aparece como `Up Nh` porque a máquina sobe de manhã. As credenciais foram apagadas às **22:04**: Gatus desligado.

E ainda que estivesse ligado, não faria diferença: `wa-gateway` não constava no `config.yaml`. Todos os checks existentes são apenas `[STATUS] == 200`, sem nenhuma condição sobre corpo de resposta — então, se tivesse sido adicionado nesse padrão, teria ficado verde os 20 dias inteiros por causa do item 2.

## Correção aplicada

1. **Re-pareamento da sessão `crm-vendas`** via QR no `/dashboard`. Credencial recriada em `wa_credentials/crm-vendas_credentials`. Validado ponta a ponta: inbound processado às 14:21:19, resposta do CRM às 14:21:30, `session-info` reportando `is_connected: true`.
2. **PR #20** — `GET /logout` público devolvendo `401` com `WWW-Authenticate: Basic realm="WA Gateway"`, mais botão "Sair" no dashboard e no admin. Não é cosmético: Basic auth não tem logoff, e sem isso não havia como trocar de usuário no painel pra re-parear a segunda sessão sem abrir janela anônima.
3. **`data-gateway` PR #309** — remoção da env `WA_DISABLED`, um kill-switch que existia só no `docker-compose.yml` e no `deploy.yml`, sem nenhuma referência no código nem no bundle de produção. Aparecia como `WA_DISABLED=true` no `docker inspect`, dando a entender que o envio estava desligado enquanto o cron disparava normalmente contra o gateway morto. Kill-switch inexistente disfarçado de kill-switch atrasa o diagnóstico mais do que a ausência de um.

## Prevenção

Decidido em 10/08/2026, na ordem de execução:

1. **`GET /status` e `GET /status/:session`** (autenticados por bearer token) expondo o que o `/health` esconde: sessões esperadas (da tabela) versus conectadas, `credentials_present` — que separa "reconecta sozinho" de "precisa de QR humano" —, `hours_without_message` como número puro, e `last_state_reason` (guarda o `loggedOut`). `/health` permanece bobo e sempre 200, porque é o healthcheck do Docker: se ele falhar quando a sessão cai, o container entra em loop de restart e se perde até a janela pra escanear o QR.
2. **Tabela `session_events`** persistindo cada transição de estado. Hoje isso só existe em `console.log`, e `docker logs` é volátil — o histórico da queda foi perdido quando o container foi recriado em 05/08.
3. **Gatus migrado pro servidor local** (sempre ligado), com o wa-gateway registrado usando **condição sobre corpo de resposta**, não `[STATUS] == 200`. Um monitor que dorme na janela em que as coisas quebram é teatro.
4. **Rota `/api/webhooks/whatsapp/session` no CRM**, pra que o evento de desconexão pare de cair no vazio.

## Notas pra quem for mexer nisso

- **Nome de sessão é imutável na prática.** A credencial no disco é `wa_credentials/<sessionId>_credentials`, e o CRM e o data-gateway mandam `session: "crm-vendas"` / `"compras1"` no payload de todo envio. Renomear órfã a credencial **e** quebra os dois consumidores.
- **O `deploy.yml` preserva `db`, `wa_credentials` e `media`** no passo de limpeza, deliberadamente. Não "simplifique" esse `find`.
- **O formulário de auth de webhook do dashboard apaga o token se salvo com o campo vazio.** O `session-info` não devolve segredo (correto), então o campo sempre renderiza em branco, e o submit faz `formData.get('webhook_auth_token') || null`. Salvar sem digitar nada grava `null` e o CRM passa a receber `401` em todo webhook. Restaurar via `PUT /admin/users/1/session-config`.
- **O sqlite (`db/wa_gateway.db`) não tem backup.** Usuários, callbacks e tokens de webhook vivem num único arquivo, num único volume.
