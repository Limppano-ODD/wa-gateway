# WA Gateway - Updated Configuration Summary

## ✅ Updated to Match Your Infrastructure Pattern

I've updated the wa-gateway configuration to follow the same pattern as your existing pega-nota application:

### **Changed from External Secrets Operator to AWS Secrets Store CSI Driver**

This matches your existing `pega-nota` setup that uses:
- **SecretProviderClass** instead of External Secrets
- **AWS Secrets Store CSI Driver** for direct secret mounting
- **Same secret naming convention**: `prd/app/wa-gateway`

### **Updated Configuration Files:**

#### **1. k8s/secrets.yaml - Now uses SecretProviderClass**
```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: wa-gateway-secrets
  namespace: wa-gateway
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "prd/app/wa-gateway"
        objectType: "secretsmanager"
        jmesPath:
          - path: "KEY"
            objectAlias: "KEY"
          - path: "WEBHOOK_BASE_URL"
            objectAlias: "WEBHOOK_BASE_URL"
  secretObjects:
  - secretName: wa-gateway-secret-production
    type: Opaque
    data:
    - objectName: KEY
      key: KEY
    - objectName: WEBHOOK_BASE_URL
      key: WEBHOOK_BASE_URL
```

#### **2. k8s/service.yaml - Now uses NGINX Ingress**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: wa-gateway-ingress
  namespace: wa-gateway
  annotations:
    kubernetes.io/ingress.class: "nginx"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-dns"
spec:
  tls:
  - hosts:
    - wa-gateway.odd.com.br
    secretName: wa-gateway-tls
  rules:
  - host: wa-gateway.odd.com.br
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: wa-gateway-service
            port:
              number: 80
```

#### **3. k8s/deployment.yaml - Updated secret reference and volume mounts**
- Secret name: `wa-gateway-secret-production` (matches your naming pattern)
- Added CSI volume mount for secrets
- Maintained existing persistent volume for media files

### **Infrastructure Already Available:**
✅ **AWS Secrets Store CSI Driver** - Already installed in your cluster  
✅ **NGINX Ingress Controller** - Already running  
✅ **Cert-Manager** - Already configured with `letsencrypt-dns`  
✅ **AWS Secrets Manager** - Secret created: `prd/app/wa-gateway`  
✅ **IAM Roles** - Both GitHub Actions and IRSA roles created  

### **Benefits of This Approach:**
1. **Consistency** - Matches your existing pega-nota pattern exactly
2. **Performance** - CSI driver is faster than External Secrets polling
3. **Security** - Direct mount from AWS Secrets Manager
4. **Simplicity** - No additional operators needed
5. **Cost** - Uses existing infrastructure

### **Ready to Deploy:**
The configuration now follows your established patterns and uses the same infrastructure components as your existing applications. You can deploy by pushing to your repository:

```bash
git add .
git commit -m "Update wa-gateway to use CSI driver and NGINX ingress"
git push origin master
```

### **GitHub Secrets Still Needed:**
```
AWS_ROLE_ARN: arn:aws:iam::590183660812:role/GitHubActions-wa-gateway
AWS_ACCOUNT_ID: 590183660812
AWS_CERTIFICATE_ID: 8c9e1f71-bb96-4dad-a5fb-ce6e2d5edc01
```

The deployment will now use the same reliable pattern as your other applications! 🎉
