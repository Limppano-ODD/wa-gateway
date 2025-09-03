# GitHub Actions - Variáveis de Ambiente

Este documento lista todas as variáveis de ambiente configuradas para o deploy automático do wa-gateway.

## 📋 **Variáveis do Repositório** 

Criadas via `gh variable set`:

| Variável | Valor | Descrição |
|----------|-------|-----------|
| `AWS_REGION` | `us-east-1` | Região AWS onde os recursos estão |
| `ECR_REPOSITORY` | `wa-gateway` | Nome do repositório ECR |
| `ECS_SERVICE` | `wa-gateway-service` | Nome do serviço ECS |
| `ECS_CLUSTER` | `cluster-1` | Nome do cluster ECS |
| `ECS_TASK_DEFINITION` | `.aws/task-definition.json` | Caminho da task definition |
| `CONTAINER_NAME` | `wa-gateway` | Nome do container na task definition |

## 🔐 **Secrets do Repositório**

Configurados previamente:

| Secret | Descrição |
|--------|-----------|
| `AWS_ACCOUNT_ID` | ID da conta AWS |
| `AWS_CERTIFICATE_ID` | ID do certificado SSL |
| `AWS_ROLE_ARN` | ARN da role para GitHub Actions |

## ⚙️ **Como foram criadas as variáveis:**

```bash
# Verificar autenticação
gh auth status

# Criar variáveis do repositório
gh variable set AWS_REGION --body "us-east-1"
gh variable set ECR_REPOSITORY --body "wa-gateway"
gh variable set ECS_SERVICE --body "wa-gateway-service"
gh variable set ECS_CLUSTER --body "cluster-1"
gh variable set ECS_TASK_DEFINITION --body ".aws/task-definition.json"
gh variable set CONTAINER_NAME --body "wa-gateway"

# Listar variáveis criadas
gh variable list
```

## 🔄 **Uso no Workflow**

As variáveis são usadas no arquivo `.github/workflows/deploy-ecs.yml`:

```yaml
env:
  AWS_REGION: ${{ vars.AWS_REGION }}
  ECR_REPOSITORY: ${{ vars.ECR_REPOSITORY }}
  ECS_SERVICE: ${{ vars.ECS_SERVICE }}
  ECS_CLUSTER: ${{ vars.ECS_CLUSTER }}
  ECS_TASK_DEFINITION: ${{ vars.ECS_TASK_DEFINITION }}
  CONTAINER_NAME: ${{ vars.CONTAINER_NAME }}
```

## 🛠️ **Comandos para Gerenciar Variáveis**

```bash
# Listar todas as variáveis
gh variable list

# Atualizar uma variável
gh variable set NOME_VARIAVEL --body "novo_valor"

# Deletar uma variável
gh variable delete NOME_VARIAVEL

# Listar secrets
gh secret list
```

## ✅ **Configuração Completa**

O repositório está configurado com:
- ✅ Variáveis de ambiente
- ✅ Secrets sensíveis
- ✅ Workflow de deploy automático
- ✅ Task definition sem informações sensíveis
- ✅ OIDC para autenticação AWS sem chaves

O deploy será executado automaticamente a cada push na branch `master`.
