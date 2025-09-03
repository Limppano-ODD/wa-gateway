# WA Gateway - ECS Deployment

Este repositório contém o serviço wa-gateway configurado para deploy automático no Amazon ECS.

## 🚀 Deploy Automático

O deploy é feito automaticamente via GitHub Actions quando há push na branch `master`.

### Recursos Configurados

- **ECS Cluster**: `cluster-1`
- **ECS Service**: `wa-gateway-service`
- **Target Group**: `wa-gateway-tg`
- **ECR Repository**: `wa-gateway`
- **EFS Volume**: Para persistir `wa_credentials`
- **ALB**: Compartilhado com `data-gateway`

### Configurações Importantes

#### 🔒 Sem Escalamento Horizontal
O serviço está configurado para **não escalar horizontalmente** (sempre 1 instância):
- `desiredCount: 1`
- `maximumPercent: 100`
- `minimumHealthyPercent: 0`

#### 💾 Volume Persistente
A pasta `wa_credentials` é montada em um volume EFS para persistir as configurações dos perfis entre deployments.

#### 🔐 Secrets
As variáveis sensíveis são armazenadas no AWS Secrets Manager:
- `NODE_ENV`
- `PORT`
- `KEY`
- `WEBHOOK_BASE_URL`

## 📁 Estrutura do Projeto

```
.
├── .github/
│   └── workflows/
│       └── deploy-ecs.yml      # GitHub Actions workflow
├── .aws/
│   └── task-definition.json    # ECS Task Definition
├── src/                        # Código fonte
├── Dockerfile                  # Container configuration
└── package.json               # Dependencies
```

## 🔧 Configuração Local para Deploy Manual

Se precisar fazer deploy manual via AWS CLI:

```bash
# 1. Build e push da imagem
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 590183660812.dkr.ecr.us-east-1.amazonaws.com
docker build -t wa-gateway .
docker tag wa-gateway:latest 590183660812.dkr.ecr.us-east-1.amazonaws.com/wa-gateway:latest
docker push 590183660812.dkr.ecr.us-east-1.amazonaws.com/wa-gateway:latest

# 2. Update do serviço
aws ecs update-service --cluster cluster-1 --service wa-gateway-service --force-new-deployment
```

## 🩺 Health Check

O serviço expõe um endpoint de health check em `/health` na porta 5001.

## 🌐 Acesso

O serviço é acessível através do Application Load Balancer compartilhado com o data-gateway.

## ⚠️ Troubleshooting

### Service não consegue iniciar tasks

1. Verificar roles IAM:
   - `wa-gateway-execution-role`
   - `wa-gateway-task-role`

2. Verificar secrets no Secrets Manager:
   - `wa-gateway-secrets`

3. Verificar EFS mount targets:
   ```bash
   aws efs describe-mount-targets --file-system-id fs-0e0ada9e77d3e6432
   ```

### Health Check falhando

1. Verificar se a aplicação está rodando na porta 5001
2. Verificar se o endpoint `/health` está respondendo
3. Verificar logs no CloudWatch: `/ecs/wa-gateway`

## 📝 Logs

Os logs da aplicação são enviados para o CloudWatch Logs no grupo `/ecs/wa-gateway`.

```bash
# Visualizar logs
aws logs get-log-events --log-group-name /ecs/wa-gateway --log-stream-name <stream-name>
```
