# WA Gateway - Kubernetes Deployment Guide

This guide provides step-by-step instructions to deploy the WA Gateway application to AWS EKS using GitHub Actions with OIDC authentication and AWS Secrets Manager.

## Architecture Overview

- **Application**: Node.js WhatsApp Gateway API
- **Container Registry**: Amazon ECR
- **Orchestration**: Amazon EKS (Kubernetes)
- **Secrets Management**: AWS Secrets Manager + External Secrets Operator
- **Load Balancing**: AWS Application Load Balancer
- **CI/CD**: GitHub Actions with OIDC
- **Authentication**: AWS IAM Roles with OIDC

## Prerequisites

- AWS Account with appropriate permissions
- Domain name and SSL certificate in ACM
- GitHub repository
- Local tools: AWS CLI, kubectl, eksctl, helm

## Quick Start

1. **Clone and setup the repository**:
   ```bash
   git clone https://github.com/Limppano-ODD/wa-gateway.git
   cd wa-gateway
   ```

2. **Configure AWS variables** in `aws/setup.sh`:
   ```bash
   AWS_ACCOUNT_ID="123456789012"
   EKS_CLUSTER_NAME="wa-gateway-cluster"
   DOMAIN_NAME="wa-gateway.yourdomain.com"
   ```

3. **Run the AWS setup script**:
   ```bash
   chmod +x aws/setup.sh
   ./aws/setup.sh
   ```

4. **Create EKS cluster** (if not exists):
   ```bash
   eksctl create cluster \
     --name wa-gateway-cluster \
     --region us-east-1 \
     --nodegroup-name wa-gateway-nodes \
     --node-type t3.medium \
     --nodes 2 \
     --nodes-min 1 \
     --nodes-max 4 \
     --with-oidc \
     --managed
   ```

5. **Install required cluster add-ons**:
   ```bash
   # AWS Load Balancer Controller
   eksctl create iamserviceaccount \
     --cluster=wa-gateway-cluster \
     --namespace=kube-system \
     --name=aws-load-balancer-controller \
     --role-name AmazonEKSLoadBalancerControllerRole \
     --attach-policy-arn=arn:aws:iam::YOUR_ACCOUNT_ID:policy/AWSLoadBalancerControllerIAMPolicy \
     --approve

   helm repo add eks https://aws.github.io/eks-charts
   helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
     -n kube-system \
     --set clusterName=wa-gateway-cluster \
     --set serviceAccount.create=false \
     --set serviceAccount.name=aws-load-balancer-controller

   # External Secrets Operator
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets external-secrets/external-secrets \
     -n external-secrets-system --create-namespace
   ```

6. **Configure GitHub repository secrets**:
   - `AWS_ROLE_ARN`: arn:aws:iam::YOUR_ACCOUNT_ID:role/GitHubActions-wa-gateway
   - `AWS_ACCOUNT_ID`: Your AWS Account ID
   - `AWS_CERTIFICATE_ID`: Your ACM Certificate ID

7. **Update Kubernetes manifests** with your actual values:
   - Replace `YOUR_ACCOUNT_ID` in all YAML files
   - Replace `YOUR_CERTIFICATE_ID` in `k8s/service.yaml`
   - Replace `wa-gateway.yourdomain.com` with your domain

8. **Push to GitHub** to trigger deployment:
   ```bash
   git add .
   git commit -m "Add Kubernetes deployment configuration"
   git push origin main
   ```

## File Structure

```
wa-gateway/
├── .github/workflows/
│   └── deploy.yml              # GitHub Actions workflow
├── aws/
│   ├── README.md              # Detailed AWS setup instructions
│   ├── setup.sh               # Automated setup script
│   ├── github-actions-trust-policy.json
│   ├── secrets-manager-policy.json
│   └── github-actions-policy.json
├── k8s/
│   ├── namespace.yaml         # Namespace and ServiceAccount
│   ├── secrets.yaml           # External Secrets configuration
│   ├── configmap.yaml         # Environment configuration
│   ├── deployment.yaml        # Application deployment
│   ├── service.yaml           # Service and Ingress
│   └── hpa.yaml              # Horizontal Pod Autoscaler
└── Dockerfile                 # Container definition
```

## Security Features

- **OIDC Authentication**: GitHub Actions uses OIDC to assume AWS roles without long-lived credentials
- **IRSA**: Kubernetes pods use IAM Roles for Service Accounts to access AWS services
- **Secrets Management**: Sensitive data stored in AWS Secrets Manager and injected via External Secrets Operator
- **Network Security**: Application Load Balancer with SSL/TLS termination
- **Least Privilege**: IAM roles with minimal required permissions

## Monitoring and Observability

The deployment includes:
- **Health Checks**: Liveness and readiness probes on `/health` endpoint
- **Resource Limits**: Memory and CPU limits for containers
- **Auto Scaling**: HPA based on CPU and memory utilization
- **Persistent Storage**: PVC for media file storage

## Environment Variables

The application uses the following environment variables:

| Variable | Source | Description |
|----------|--------|-------------|
| `NODE_ENV` | ConfigMap | Application environment (PRODUCTION) |
| `PORT` | ConfigMap | Application port (5001) |
| `KEY` | Secrets Manager | API authentication key |
| `WEBHOOK_BASE_URL` | Secrets Manager | Webhook callback URL |

## Troubleshooting

1. **Check pod status**:
   ```bash
   kubectl get pods -n wa-gateway
   kubectl describe pod <pod-name> -n wa-gateway
   ```

2. **Check logs**:
   ```bash
   kubectl logs -f deployment/wa-gateway -n wa-gateway
   ```

3. **Check secrets**:
   ```bash
   kubectl get externalsecrets -n wa-gateway
   kubectl describe externalsecret wa-gateway-secrets -n wa-gateway
   ```

4. **Check ingress**:
   ```bash
   kubectl get ingress -n wa-gateway
   kubectl describe ingress wa-gateway-ingress -n wa-gateway
   ```

## Updating the Application

To deploy new versions:

1. Update your code
2. Commit and push to the main branch
3. GitHub Actions will automatically build and deploy the new version

## Scaling

The application is configured with:
- **Min replicas**: 2
- **Max replicas**: 10
- **Auto-scaling triggers**: 70% CPU or 80% memory

To manually scale:
```bash
kubectl scale deployment wa-gateway --replicas=5 -n wa-gateway
```

## Cleanup

To remove all resources:
```bash
kubectl delete namespace wa-gateway
eksctl delete cluster --name wa-gateway-cluster
```
