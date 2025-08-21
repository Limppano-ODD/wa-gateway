# AWS Secrets Store CSI Driver Setup

## Prerequisites

Your EKS cluster needs to have the AWS Secrets Store CSI Driver installed and configured.

## 1. Install AWS Secrets Store CSI Driver

```bash
# Add the secrets-store-csi-driver Helm repository
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts

# Install the secrets-store-csi-driver
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
  --namespace kube-system \
  --set syncSecret.enabled=true

# Install the AWS provider
kubectl apply -f https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml
```

## 2. Verify Installation

```bash
# Check if the CSI driver pods are running
kubectl get pods -n kube-system -l app=secrets-store-csi-driver

# Check if the AWS provider is running
kubectl get pods -n kube-system -l app=csi-secrets-store-provider-aws
```

## 3. Service Account IAM Role

Make sure your service account `wa-gateway-sa` has the necessary IAM permissions to access the secret:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": "arn:aws:secretsmanager:us-east-1:590183660812:secret:prd/app/wa-gateway-4BSmPU"
        }
    ]
}
```

## 4. How It Works

1. The CSI driver mounts secrets from AWS Secrets Manager to `/mnt/secrets-store`
2. The `SecretProviderClass` configuration creates a Kubernetes secret `wa-gateway-secret-production`
3. The deployment uses standard `secretKeyRef` to access the secrets
4. The secrets are automatically synced from AWS Secrets Manager

## 5. Secret Structure

The AWS Secrets Manager secret should contain JSON with the following structure:

```json
{
    "KEY": "your-api-key-value",
    "WEBHOOK_BASE_URL": "your-webhook-url"
}
```

## 6. Deploy

After ensuring the CSI driver is installed and configured:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployment.yaml
```

## Troubleshooting

If the pod fails to start, check:

1. CSI driver pods are running
2. Service account has correct IAM permissions
3. Secret exists in AWS Secrets Manager
4. Secret contains the expected JSON structure

```bash
# Check pod events
kubectl describe pod -n wa-gateway -l app=wa-gateway

# Check CSI driver logs
kubectl logs -n kube-system -l app=secrets-store-csi-driver

# Check if secret was created
kubectl get secret wa-gateway-secret-production -n wa-gateway
```
