# AWS Infrastructure Setup for wa-gateway

This document describes the AWS infrastructure required for the wa-gateway application.

## Prerequisites

1. AWS CLI installed and configured
2. kubectl installed
3. eksctl installed
4. helm installed

## 1. Create ECR Repository

```bash
aws ecr create-repository --repository-name wa-gateway --region us-east-1
```

## 2. Create EKS Cluster

```bash
eksctl create cluster \
  --name your-eks-cluster \
  --region us-east-1 \
  --nodegroup-name wa-gateway-nodes \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 1 \
  --nodes-max 4 \
  --with-oidc \
  --ssh-access \
  --ssh-public-key your-key-pair \
  --managed
```

## 3. Create AWS Secrets Manager Secrets

```bash
# Create the secret in AWS Secrets Manager
aws secretsmanager create-secret \
  --name "wa-gateway/api" \
  --description "WA Gateway API secrets" \
  --secret-string '{"KEY":"your-api-key","WEBHOOK_BASE_URL":"https://wa-gateway.yourdomain.com"}' \
  --region us-east-1
```

## 4. Create OIDC Identity Provider for GitHub Actions

```bash
# Get the OIDC issuer URL
aws eks describe-cluster --name your-eks-cluster --query "cluster.identity.oidc.issuer" --output text

# Create OIDC identity provider (replace the URL with your cluster's OIDC issuer)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com
```

## 5. Create IAM Role for GitHub Actions

Create the trust policy file first:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Limppano-ODD/wa-gateway:*"
        }
      }
    }
  ]
}
```

Then create the role:

```bash
aws iam create-role \
  --role-name GitHubActions-wa-gateway \
  --assume-role-policy-document file://github-actions-trust-policy.json
```

## 6. Create IAM Role for IRSA (Pod Service Account)

```bash
# Create trust policy for the service account
cat > irsa-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/oidc.eks.us-east-1.amazonaws.com/id/YOUR_OIDC_ID"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.us-east-1.amazonaws.com/id/YOUR_OIDC_ID:sub": "system:serviceaccount:wa-gateway:wa-gateway-sa",
          "oidc.eks.us-east-1.amazonaws.com/id/YOUR_OIDC_ID:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name wa-gateway-irsa-role \
  --assume-role-policy-document file://irsa-trust-policy.json
```

## 7. Attach Policies

```bash
# For GitHub Actions role
aws iam attach-role-policy \
  --role-name GitHubActions-wa-gateway \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

aws iam attach-role-policy \
  --role-name GitHubActions-wa-gateway \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKSClusterPolicy

# Create custom policy for GitHub Actions
cat > github-actions-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:UpdateClusterConfig"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name GitHubActions-EKS-Policy \
  --policy-document file://github-actions-policy.json

aws iam attach-role-policy \
  --role-name GitHubActions-wa-gateway \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/GitHubActions-EKS-Policy

# For IRSA role (Secrets Manager access)
cat > secrets-manager-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:wa-gateway/*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name wa-gateway-secrets-policy \
  --policy-document file://secrets-manager-policy.json

aws iam attach-role-policy \
  --role-name wa-gateway-irsa-role \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/wa-gateway-secrets-policy
```

## 8. Install AWS Load Balancer Controller

```bash
# Download IAM policy
curl -O https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.2/docs/install/iam_policy.json

# Create IAM policy
aws iam create-policy \
    --policy-name AWSLoadBalancerControllerIAMPolicy \
    --policy-document file://iam_policy.json

# Create IAM role for service account
eksctl create iamserviceaccount \
  --cluster=your-eks-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --role-name AmazonEKSLoadBalancerControllerRole \
  --attach-policy-arn=arn:aws:iam::YOUR_ACCOUNT_ID:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Install AWS Load Balancer Controller
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=your-eks-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

## 9. Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
helm install external-secrets external-secrets/external-secrets -n external-secrets-system --create-namespace
```

## GitHub Repository Secrets

Add the following secrets to your GitHub repository:

- `AWS_ROLE_ARN`: arn:aws:iam::YOUR_ACCOUNT_ID:role/GitHubActions-wa-gateway
- `AWS_ACCOUNT_ID`: Your AWS Account ID
- `AWS_CERTIFICATE_ID`: Your ACM Certificate ID

## Environment Variables to Replace

Before deploying, replace the following placeholders:

- `YOUR_ACCOUNT_ID`: Your AWS Account ID
- `YOUR_CERTIFICATE_ID`: Your ACM Certificate ID
- `your-eks-cluster`: Your EKS cluster name
- `wa-gateway.yourdomain.com`: Your domain name
- `YOUR_OIDC_ID`: Your EKS OIDC provider ID
