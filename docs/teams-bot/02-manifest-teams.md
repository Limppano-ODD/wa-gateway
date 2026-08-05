# 02 — Manifest e pacote do app Teams

O Azure registra o bot, mas ele só **aparece** no Teams de alguém depois de instalar
o **pacote do app** (um zip). Este doc explica o zip e as formas de instalar.

## O que é o zip

Um `.zip` com 3 arquivos:

- `manifest.json` — descreve o app (id, nome, o `botId`, domínios válidos).
- `color.png` — ícone colorido 192×192.
- `outline.png` — ícone contorno 32×32 (transparente).

O `manifest.json` **aponta** pro bot do Azure — não cria bot nenhum. Campos-chave:

```jsonc
{
  "manifestVersion": "1.17",
  "id": "62d5251f-...",              // id do app Teams (pode = botId)
  "name": { "short": "Agente Teste" },
  "bots": [{
    "botId": "62d5251f-...",         // = App ID do Azure (doc 01)
    "scopes": ["personal"]           // "personal" = chat 1:1
  }],
  "validDomains": ["<tunel>.trycloudflare.com"]
}
```

- `validDomains` precisa conter o host do endpoint público (senão o Teams bloqueia).
  Em local = domínio do túnel; em prd = `wa-gateway.odd.com.br`.
- `scopes: ["personal"]` = conversa privada 1:1. Pra grupos/canais, add `team`/`groupChat`.

Gerar o zip (exemplo usado): `manifest.json` + os 2 PNGs zipados na raiz.

## Como instalar — 3 caminhos

### A) Sideload (upload custom app) — o mais rápido pra teste

No cliente Teams: **Aplicativos → Gerenciar seus aplicativos → Carregar um
aplicativo → Carregar um aplicativo personalizado** → escolhe o zip.

- Instala **só na tua conta**. Ninguém mais vê.
- **Requisito:** a política do Teams precisa permitir "upload de apps personalizados"
  pro usuário. Se o botão não aparece / vem apagado, tá bloqueado → usar caminho B.
- ⚠️ A tela "Aplicativos → Adicionado pela sua organização" **não** tem botão de
  upload — ela só lista o que a org já publicou. O upload é em "Gerenciar seus
  aplicativos".

### B) Publicar no catálogo da org (Teams Admin Center) — "pra 1 pessoa só" de verdade

`admin.teams.microsoft.com` → **Aplicativos do Teams → Gerenciar aplicativos →
Carregar** → sobe o zip. Depois, numa **política de permissão de app**, libera o
app só pro usuário/grupo desejado e bloqueia pro resto.

- É o jeito "oficial". Exige cargo **Teams Administrator**.
- Restringe **quem enxerga/instala**. (Quem o bot **responde** já travamos no
  código — ver [05](05-controle-acesso.md).)

### C) Publicar por API (Graph) — automação futura

`POST /appCatalogs/teamsApps` com o zip. **Hoje dá 403** com a identidade manager
(app-only sem cargo Teams Admin). Pra automatizar pela plataforma, resolver o cargo
antes — ver [06](06-integrar-plataforma.md).

## Resumo mental

- Zip **não** cria bot. Só dá **acesso/visibilidade** ao bot que já existe no Azure.
- Teste rápido → caminho A. Oficial/restrito → caminho B. Automático → C (pendente).
