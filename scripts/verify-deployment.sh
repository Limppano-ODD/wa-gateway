#!/bin/bash

# Local testing and verification script for wa-gateway Kubernetes deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}WA Gateway - Kubernetes Deployment Verification${NC}"
echo "=============================================="

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}kubectl is not installed. Please install kubectl first.${NC}"
    exit 1
fi

# Check if current context is set
CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "none")
if [ "$CURRENT_CONTEXT" = "none" ]; then
    echo -e "${RED}No kubectl context set. Please configure your kubeconfig.${NC}"
    exit 1
fi

echo -e "${YELLOW}Current kubectl context: ${CURRENT_CONTEXT}${NC}"

# Check namespace
echo -e "\n${YELLOW}Checking namespace...${NC}"
if kubectl get namespace wa-gateway &> /dev/null; then
    echo -e "${GREEN}✓ Namespace 'wa-gateway' exists${NC}"
else
    echo -e "${RED}✗ Namespace 'wa-gateway' not found${NC}"
    echo "Creating namespace..."
    kubectl apply -f k8s/namespace.yaml
fi

# Check External Secrets Operator
echo -e "\n${YELLOW}Checking External Secrets Operator...${NC}"
if kubectl get deployment external-secrets -n external-secrets-system &> /dev/null; then
    echo -e "${GREEN}✓ External Secrets Operator is installed${NC}"
else
    echo -e "${RED}✗ External Secrets Operator not found${NC}"
    echo "Please install External Secrets Operator first"
fi

# Check AWS Load Balancer Controller
echo -e "\n${YELLOW}Checking AWS Load Balancer Controller...${NC}"
if kubectl get deployment aws-load-balancer-controller -n kube-system &> /dev/null; then
    echo -e "${GREEN}✓ AWS Load Balancer Controller is installed${NC}"
else
    echo -e "${RED}✗ AWS Load Balancer Controller not found${NC}"
    echo "Please install AWS Load Balancer Controller first"
fi

# Apply all manifests
echo -e "\n${YELLOW}Applying Kubernetes manifests...${NC}"
kubectl apply -f k8s/

# Wait for deployment
echo -e "\n${YELLOW}Waiting for deployment to be ready...${NC}"
kubectl rollout status deployment/wa-gateway -n wa-gateway --timeout=300s

# Check pod status
echo -e "\n${YELLOW}Pod status:${NC}"
kubectl get pods -n wa-gateway

# Check service status
echo -e "\n${YELLOW}Service status:${NC}"
kubectl get services -n wa-gateway

# Check ingress status
echo -e "\n${YELLOW}Ingress status:${NC}"
kubectl get ingress -n wa-gateway

# Check external secrets
echo -e "\n${YELLOW}External Secrets status:${NC}"
kubectl get externalsecrets -n wa-gateway

# Check HPA status
echo -e "\n${YELLOW}HPA status:${NC}"
kubectl get hpa -n wa-gateway

# Get application logs
echo -e "\n${YELLOW}Recent application logs:${NC}"
kubectl logs deployment/wa-gateway -n wa-gateway --tail=20

# Test health endpoint (if service is available)
echo -e "\n${YELLOW}Testing health endpoint...${NC}"
if kubectl get service wa-gateway-service -n wa-gateway &> /dev/null; then
    # Port forward for testing
    echo "Setting up port forward to test health endpoint..."
    kubectl port-forward service/wa-gateway-service 8080:80 -n wa-gateway &
    PORT_FORWARD_PID=$!
    
    # Wait a moment for port forward to establish
    sleep 5
    
    # Test health endpoint
    if curl -s http://localhost:8080/health > /dev/null; then
        echo -e "${GREEN}✓ Health endpoint is responding${NC}"
        curl -s http://localhost:8080/health | jq .
    else
        echo -e "${RED}✗ Health endpoint is not responding${NC}"
    fi
    
    # Cleanup port forward
    kill $PORT_FORWARD_PID 2>/dev/null || true
fi

echo -e "\n${GREEN}Verification completed!${NC}"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Check if your domain is pointing to the ALB"
echo "2. Verify SSL certificate is properly configured"
echo "3. Update your secrets in AWS Secrets Manager"
echo "4. Monitor the application logs for any issues"
