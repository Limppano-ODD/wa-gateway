# 04 — Rodar tudo local

Provar o cano na máquina sem tocar em prd. Precisa de 3 processos + o zip instalado.

## Pré-requisitos

- Node 24 + pnpm. `pnpm install` na raiz do wa-gateway.
- `better-sqlite3`/`bcrypt` são **nativos** — se der `bindings not found` no Node 24,
  recompilar: `cd node_modules/better-sqlite3 && npx node-gyp rebuild` (lento).
- `cloudflared` instalado (túnel rápido, sem conta).
- Azure Bot já criado com canal Teams (doc 01) e endpoint apontando pro túnel.

## .env local (exemplo)

```ini
NODE_ENV=DEVELOPMENT
PORT=5001
ADMIN_USER=admin
ADMIN_PASSWORD=<qualquer>
DB_PATH=/tmp
WEBHOOK_BASE_URL=https://<tunel>.trycloudflare.com
BRIDGE_TENANTS=[{"name":"teams-teste","channel":"teams","wsToken":"<wsToken>","config":{"appId":"62d5251f-...","appPassword":"<secret>","tenantId":"6fdfcb68-..."}}]
```

## Os 3 processos

```bash
# 1) wa-gateway (porta 5001)
cd /home/weslan/projetos/wa-gateway
./node_modules/.bin/tsx src/index.ts        # (script: /tmp/wa-run.sh)

# 2) túnel público → aponta pro 5001
cloudflared tunnel --url http://localhost:5001 --no-autoupdate
#   copia a URL gerada (muda a cada start!) e:
#   - põe no endpoint do Azure Bot: az bot update --endpoint https://<url>/ingress/teams-teste
#   - põe em validDomains do manifest + WEBHOOK_BASE_URL

# 3) agente de TESTE (shim) — conecta no bridge e responde
cd /home/weslan/projetos/wa-gateway
WS_TOKEN=<wsToken> node teams-shim.mjs
```

## Verificações rápidas

```bash
curl -s http://localhost:5001/bridge/status        # {"tenants_online":{"teams-teste":1}}  ← shim conectado
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://<tunel>.trycloudflare.com/ingress/teams-teste -d '{"ping":1}'   # 200 = túnel ok
```

- `tenants_online.teams-teste == 1` → o shim/agente está plugado.
- Túnel 200 → o Azure consegue alcançar o wa-gateway.

## O shim de teste (teams-shim.mjs)

Programinha WebSocket (usa o `WebSocket` **nativo** do Node 24 — sem dependência)
que:

- conecta em `ws://localhost:5001/bridge/agent?token=<WS_TOKEN>`;
- ao receber `message`, checa `from.aadObjectId` contra o ID do Weslan
  (`5ef79d00-...`) — **bloqueia qualquer outro**;
- responde `✅ recebido pelo agente (teste): "<texto>"`;
- reconecta sozinho se cair.

É só um **stub** pra provar o transporte. O agente real entra no doc
[06](06-integrar-plataforma.md).

## Pegadinhas

- **URL do túnel muda a cada restart.** Reiniciou → atualiza endpoint do Azure +
  validDomains + WEBHOOK_BASE_URL. (Some em prd.)
- `import WebSocket from "ws"` quebra sob pnpm (ERR_MODULE_NOT_FOUND) → usar o
  `WebSocket` **global** do Node 24.
- Não confundir `pkill -f wa-gateway` com o control-plane local — nomes de processo
  parecidos já derrubaram o CP por engano.
