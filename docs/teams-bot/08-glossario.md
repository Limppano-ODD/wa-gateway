# 08 — Glossário

Termos que aparecem no fluxo Teams + wa-gateway.

| Termo | O que é |
|-------|---------|
| **Bot Framework** | Serviço da Microsoft que fica entre o Teams e o teu bot. Recebe a mensagem do usuário e faz um POST (webhook) pro teu endpoint, assinado com JWT. |
| **Activity** | O JSON que o Bot Framework manda. Tem `type` (message, conversationUpdate…), `text`, `from`, `conversation`, `serviceUrl`. |
| **serviceUrl** | URL de volta (dá o Bot Framework em cada Activity) pra onde o bot POSTa a resposta. Não é fixo — vem na mensagem. |
| **conversation.id** | Id do chat específico. Usado pra postar a resposta no lugar certo. |
| **aadObjectId** | Id imutável do usuário no Entra ID (Azure AD). Vem em `from.aadObjectId`. É por ele que travamos acesso (ver [05](05-controle-acesso.md)). |
| **App ID / botId** | Id do app registration do bot no Entra. Mesmo valor no Azure Bot e no manifest. Identifica o bot. |
| **client secret / appPassword** | Senha do app registration. Usada pra pegar token AAD e postar a resposta. Segredo. |
| **JWT do Bot Connector** | Token que o Bot Framework põe no header `Authorization` de cada POST. Validamos contra o JWKS `login.botframework.com` pra garantir que a mensagem é legítima e é pro nosso bot (`aud == appId`). |
| **JWKS** | Conjunto de chaves públicas (JSON Web Key Set) pra validar assinaturas JWT. |
| **token AAD (client_credentials)** | Token que o bot pega (appId+appPassword) pra falar com a API do Bot Framework ao **responder**. Diferente do JWT que ele **recebe**. |
| **Azure Bot (recurso)** | Recurso no Azure que amarra o App ID + o messaging endpoint + os canais (Teams, etc). |
| **Canal (channel) no Azure Bot** | Liga o bot a uma plataforma (MsTeams, WebChat…). Sem o canal MsTeams, o Teams não fala com o bot. |
| **manifest / app package** | O zip que torna o bot instalável/visível no Teams. Aponta pro App ID. Não cria bot. |
| **sideload** | Subir o zip só pra tua conta ("Carregar aplicativo personalizado"). |
| **validDomains** | Lista no manifest de domínios que o app pode acessar. Precisa conter o host do endpoint. |
| **wa-gateway** | Nosso relay: recebe o webhook público, valida/traduz por adaptador, entrega pro agente pela ponte WS. Um por N bots. |
| **tenant (no wa-gateway)** | Uma "linha" de config no wa-gateway = um bot/canal. Isola credenciais e o `wsToken`. Não confundir com tenant do Azure AD. |
| **tenant (Azure AD / Entra)** | A organização no Entra (Limppano = `6fdfcb68-...`). |
| **bridge / ponte** | O WebSocket `/bridge/agent?token=...` por onde o agente disca pra fora e recebe/manda mensagens. |
| **wsToken** | Segredo que o agente usa pra provar que pode escutar um tenant no bridge. |
| **shim** | Programinha de teste (`teams-shim.mjs`) que finge ser o agente pra provar o cano. Substituído pelo agente real depois. |
| **identidade manager** | App de provisionamento (`agent-platform-manager`) que a plataforma usa pra falar com Azure (listar/criar bots). App-only, sem cargo Teams Admin (por isso não publica app no catálogo). |
| **cloudflared quick tunnel** | Túnel público temporário (sem conta) pra expor o wa-gateway local. Só teste; URL muda a cada start. |
