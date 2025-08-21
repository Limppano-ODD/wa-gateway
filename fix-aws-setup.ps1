# PowerShell script to set up AWS infrastructure for GitHub Actions OIDC

$AWS_ACCOUNT_ID = "590183660812"
$AWS_REGION = "us-east-1"
$GITHUB_REPO = "Limppano-ODD/wa-gateway"

Write-Host "Setting up AWS infrastructure for GitHub Actions OIDC..." -ForegroundColor Green

# 1. Create OIDC Identity Provider for GitHub Actions (if not exists)
Write-Host "Creating OIDC Identity Provider..." -ForegroundColor Yellow
try {
    aws iam create-open-id-connect-provider `
        --url https://token.actions.githubusercontent.com `
        --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 `
        --client-id-list sts.amazonaws.com
    Write-Host "OIDC provider created successfully" -ForegroundColor Green
} catch {
    Write-Host "OIDC provider already exists or error occurred" -ForegroundColor Yellow
}

# 2. Create the trust policy for GitHub Actions
$trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:$GITHUB_REPO`:*"
        }
      }
    }
  ]
}
"@

$trustPolicy | Out-File -FilePath "temp-trust-policy.json" -Encoding UTF8

# 3. Create the IAM role
Write-Host "Creating IAM role GitHubActions-wa-gateway..." -ForegroundColor Yellow
try {
    aws iam create-role `
        --role-name GitHubActions-wa-gateway `
        --assume-role-policy-document file://temp-trust-policy.json
    Write-Host "IAM role created successfully" -ForegroundColor Green
} catch {
    Write-Host "IAM role already exists or error occurred" -ForegroundColor Yellow
}

# 4. Create the permissions policy
$permissionsPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:UpdateClusterConfig",
        "eks:ListClusters",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:BatchImportImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "*"
    }
  ]
}
"@

$permissionsPolicy | Out-File -FilePath "temp-permissions-policy.json" -Encoding UTF8

# 5. Create and attach the policy
Write-Host "Creating and attaching permissions policy..." -ForegroundColor Yellow
try {
    aws iam create-policy `
        --policy-name GitHubActions-wa-gateway-Policy `
        --policy-document file://temp-permissions-policy.json
    
    aws iam attach-role-policy `
        --role-name GitHubActions-wa-gateway `
        --policy-arn "arn:aws:iam::$AWS_ACCOUNT_ID`:policy/GitHubActions-wa-gateway-Policy"
    
    Write-Host "Permissions policy created and attached successfully" -ForegroundColor Green
} catch {
    Write-Host "Policy already exists or error occurred" -ForegroundColor Yellow
}

# Clean up
Remove-Item -Path "temp-trust-policy.json" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "temp-permissions-policy.json" -Force -ErrorAction SilentlyContinue

Write-Host "" 
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Add this secret to your GitHub repository:" -ForegroundColor Red
Write-Host "AWS_ROLE_ARN = arn:aws:iam::$AWS_ACCOUNT_ID`:role/GitHubActions-wa-gateway" -ForegroundColor Cyan
Write-Host ""
Write-Host "Go to: https://github.com/$GITHUB_REPO/settings/secrets/actions" -ForegroundColor Yellow
Write-Host "And add the AWS_ROLE_ARN secret with the value above." -ForegroundColor Yellow
