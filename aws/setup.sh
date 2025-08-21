#!/bin/bash

# AWS Infrastructure Setup Script for wa-gateway
# Make sure to set these variables before running the script

set -e

# Configuration variables - UPDATE THESE
AWS_ACCOUNT_ID="YOUR_ACCOUNT_ID"
AWS_REGION="us-east-1"
EKS_CLUSTER_NAME="your-eks-cluster"
ECR_REPOSITORY="wa-gateway"
GITHUB_REPO="Limppano-ODD/wa-gateway"
DOMAIN_NAME="wa-gateway.yourdomain.com"

echo "Starting AWS infrastructure setup for wa-gateway..."

# 1. Create ECR Repository
echo "Creating ECR repository..."
aws ecr create-repository --repository-name $ECR_REPOSITORY --region $AWS_REGION || echo "ECR repository already exists"

# 2. Create Secrets Manager secret
echo "Creating Secrets Manager secret..."
aws secretsmanager create-secret \
  --name "prd/app/wa-gateway" \
  --description "WA Gateway API secrets" \
  --secret-string '{"KEY":"your-api-key-here","WEBHOOK_BASE_URL":"https://'$DOMAIN_NAME'"}' \
  --region $AWS_REGION || echo "Secret already exists"

# 3. Create OIDC Identity Provider for GitHub Actions
echo "Creating OIDC Identity Provider..."
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --client-id-list sts.amazonaws.com || echo "OIDC provider already exists"

# 4. Create GitHub Actions IAM Role
echo "Creating GitHub Actions IAM role..."
sed "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" aws/github-actions-trust-policy.json > temp-trust-policy.json
sed -i "s|Limppano-ODD/wa-gateway|$GITHUB_REPO|g" temp-trust-policy.json

aws iam create-role \
  --role-name GitHubActions-wa-gateway \
  --assume-role-policy-document file://temp-trust-policy.json || echo "Role already exists"

# 5. Create and attach policies for GitHub Actions
echo "Creating policies for GitHub Actions..."
sed "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" aws/github-actions-policy.json > temp-gh-policy.json

aws iam create-policy \
  --policy-name GitHubActions-wa-gateway-Policy \
  --policy-document file://temp-gh-policy.json || echo "Policy already exists"

aws iam attach-role-policy \
  --role-name GitHubActions-wa-gateway \
  --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/GitHubActions-wa-gateway-Policy || echo "Policy already attached"

# 6. Create Secrets Manager policy for IRSA
echo "Creating Secrets Manager policy..."
sed "s/YOUR_ACCOUNT_ID/$AWS_ACCOUNT_ID/g" aws/secrets-manager-policy.json > temp-secrets-policy.json

aws iam create-policy \
  --policy-name wa-gateway-secrets-policy \
  --policy-document file://temp-secrets-policy.json || echo "Policy already exists"

# 7. Get EKS OIDC issuer (requires cluster to exist)
if aws eks describe-cluster --name $EKS_CLUSTER_NAME --region $AWS_REGION > /dev/null 2>&1; then
    echo "Getting EKS OIDC issuer..."
    OIDC_ISSUER=$(aws eks describe-cluster --name $EKS_CLUSTER_NAME --region $AWS_REGION --query "cluster.identity.oidc.issuer" --output text)
    OIDC_ID=$(echo $OIDC_ISSUER | sed 's|https://oidc.eks.'$AWS_REGION'.amazonaws.com/id/||')
    
    # Create IRSA trust policy
    cat > temp-irsa-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$AWS_ACCOUNT_ID:oidc-provider/oidc.eks.$AWS_REGION.amazonaws.com/id/$OIDC_ID"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.$AWS_REGION.amazonaws.com/id/$OIDC_ID:sub": "system:serviceaccount:wa-gateway:wa-gateway-sa",
          "oidc.eks.$AWS_REGION.amazonaws.com/id/$OIDC_ID:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF

    # Create IRSA role
    echo "Creating IRSA role..."
    aws iam create-role \
      --role-name wa-gateway-irsa-role \
      --assume-role-policy-document file://temp-irsa-trust-policy.json || echo "IRSA role already exists"

    aws iam attach-role-policy \
      --role-name wa-gateway-irsa-role \
      --policy-arn arn:aws:iam::$AWS_ACCOUNT_ID:policy/wa-gateway-secrets-policy || echo "Policy already attached"

    echo "OIDC ID: $OIDC_ID"
else
    echo "EKS cluster not found. Please create the cluster first using:"
    echo "eksctl create cluster --name $EKS_CLUSTER_NAME --region $AWS_REGION --nodegroup-name wa-gateway-nodes --node-type t3.medium --nodes 2 --nodes-min 1 --nodes-max 4 --with-oidc --managed"
fi

# Clean up temporary files
rm -f temp-*.json

echo "Setup completed!"
echo ""
echo "Next steps:"
echo "1. Update your GitHub repository secrets with:"
echo "   - AWS_ROLE_ARN: arn:aws:iam::$AWS_ACCOUNT_ID:role/GitHubActions-wa-gateway"
echo "   - AWS_ACCOUNT_ID: $AWS_ACCOUNT_ID"
echo "   - AWS_CERTIFICATE_ID: (your ACM certificate ID)"
echo ""
echo "2. Update the Kubernetes manifests with your actual values"
echo "3. Install AWS Load Balancer Controller and External Secrets Operator on your EKS cluster"
