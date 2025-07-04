# Kubernetes Deployment Guide

This guide provides instructions for deploying the Discord Article Bot to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (1.19+)
- kubectl configured to access your cluster
- Docker registry access (Docker Hub, GitHub Container Registry, etc.)
- MongoDB instance (can be deployed in-cluster or external)

## Quick Start

1. Create namespace
2. Create secrets
3. Deploy MongoDB (optional)
4. Deploy the bot
5. Monitor logs

## Step-by-Step Deployment

### 1. Create Namespace

```bash
kubectl create namespace discord-bot
```

### 2. Create Secrets

Create a file `secrets.yaml` with your sensitive configuration:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: discord-bot-secrets
  namespace: discord-bot
type: Opaque
stringData:
  DISCORD_TOKEN: "your-discord-bot-token"
  OPENAI_API_KEY: "your-openai-api-key"
  MONGO_PASSWORD: "your-mongo-password"
```

Apply the secret:

```bash
kubectl apply -f secrets.yaml
```

### 3. Create ConfigMap for Bot Configuration

Create `configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: discord-bot-config
  namespace: discord-bot
data:
  # Core Settings
  DISCORD_PREFIX: "!"
  OPENAI_BASE_URL: "https://api.openai.com/v1"
  OPENAI_METHOD: "completion"
  OPENAI_MODEL: "gpt-4.1-mini"
  DEBUG: "false"
  
  # Feature Toggles
  FACT_CHECKER_ENABLED: "true"
  SOURCE_CREDIBILITY_ENABLED: "true"
  RSS_FEEDS_ENABLED: "false"
  FOLLOW_UP_TRACKER_ENABLED: "false"
  SUMMARY_STYLES_ENABLED: "true"
  MOOD_BASED_SUMMARIES_ENABLED: "true"
  CELEBRITY_NARRATORS_ENABLED: "true"
  HISTORICAL_PERSPECTIVES_ENABLED: "true"
  BIAS_DETECTION_ENABLED: "false"
  ALTERNATIVE_PERSPECTIVES_ENABLED: "false"
  CONTEXT_PROVIDER_ENABLED: "false"
  AUTO_TRANSLATION_ENABLED: "true"
  LANGUAGE_LEARNING_ENABLED: "true"
  CULTURAL_CONTEXT_ENABLED: "true"
  
  # Feature Configuration
  RSS_INTERVAL_MINUTES: "60"
  FOLLOW_UP_INTERVAL_MINUTES: "1440"
  BIAS_THRESHOLD: "0.7"
  BIAS_TYPES: "political,gender,racial,corporate"
  CONTEXT_MIN_KEYWORDS: "3"
  AUTO_TRANSLATION_TARGET_LANGUAGE: "English"
  AUTO_TRANSLATION_SUPPORTED_LANGUAGES: "English,Spanish,French,German,Italian,Portuguese"
  LANGUAGE_LEARNING_TARGET_LANGUAGES: "Spanish,French"
  LANGUAGE_LEARNING_PRESENTATION_STYLE: "side-by-side"
  
  # System Prompt
  prompt.txt: |
    You are an AI assistant that specializes in summarizing news articles and web content.
    Your summaries should be:
    - Concise (under 1500 characters)
    - Objective and factual
    - Well-structured with clear main points
    - Free of personal opinions unless analyzing bias
    
    Always include:
    1. Main topic/headline
    2. Key facts and findings
    3. Important quotes if relevant
    4. Context or background when necessary
    
    Avoid:
    - Speculation beyond what's in the article
    - Personal commentary
    - Unnecessary details
    - URLs or links
```

Apply the configmap:

```bash
kubectl apply -f configmap.yaml
```

### 4. Deploy MongoDB (Optional - Skip if using external MongoDB)

Create `mongodb-deployment.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mongodb-pvc
  namespace: discord-bot
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
  namespace: discord-bot
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
      - name: mongodb
        image: mongo:6.0
        ports:
        - containerPort: 27017
        env:
        - name: MONGO_INITDB_ROOT_USERNAME
          value: "admin"
        - name: MONGO_INITDB_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: MONGO_PASSWORD
        - name: MONGO_INITDB_DATABASE
          value: "discord-bot"
        volumeMounts:
        - name: mongodb-storage
          mountPath: /data/db
      volumes:
      - name: mongodb-storage
        persistentVolumeClaim:
          claimName: mongodb-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: mongodb
  namespace: discord-bot
spec:
  selector:
    app: mongodb
  ports:
  - port: 27017
    targetPort: 27017
```

Apply MongoDB deployment:

```bash
kubectl apply -f mongodb-deployment.yaml
```

### 5. Deploy the Discord Bot

Create `bot-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discord-article-bot
  namespace: discord-bot
  labels:
    app: discord-article-bot
spec:
  replicas: 1  # Only run one instance to avoid duplicate responses
  selector:
    matchLabels:
      app: discord-article-bot
  template:
    metadata:
      labels:
        app: discord-article-bot
    spec:
      containers:
      - name: discord-bot
        image: your-registry/discord-article-bot:latest  # Replace with your image
        imagePullPolicy: Always
        env:
        # Secrets
        - name: DISCORD_TOKEN
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DISCORD_TOKEN
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: OPENAI_API_KEY
        - name: MONGO_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: MONGO_PASSWORD
        
        # MongoDB Connection
        - name: MONGO_URI
          value: "mongodb://admin:${MONGO_PASSWORD}@mongodb:27017/discord-bot?authSource=admin"
        
        # Load all config from ConfigMap
        envFrom:
        - configMapRef:
            name: discord-bot-config
        
        # Resources
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        # Volume for prompt.txt
        volumeMounts:
        - name: prompt-volume
          mountPath: /app/prompt.txt
          subPath: prompt.txt
        
        # Health checks
        livenessProbe:
          exec:
            command:
            - node
            - -e
            - "process.exit(0)"
          initialDelaySeconds: 30
          periodSeconds: 30
        
      volumes:
      - name: prompt-volume
        configMap:
          name: discord-bot-config
          items:
          - key: prompt.txt
            path: prompt.txt
```

Apply the bot deployment:

```bash
kubectl apply -f bot-deployment.yaml
```

### 6. Build and Push Docker Image

Create a `Dockerfile` in your project root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

# Start the bot
CMD ["node", "bot.js"]
```

Build and push:

```bash
docker build -t your-registry/discord-article-bot:latest .
docker push your-registry/discord-article-bot:latest
```

## Advanced Configuration

### Using External MongoDB

If using MongoDB Atlas or external MongoDB, update the `MONGO_URI` in the deployment:

```yaml
- name: MONGO_URI
  value: "mongodb+srv://username:${MONGO_PASSWORD}@cluster.mongodb.net/discord-bot?retryWrites=true&w=majority"
```

### Enabling RSS Feeds

Add RSS feed configuration to the ConfigMap:

```yaml
data:
  RSS_FEEDS_ENABLED: "true"
  RSS_FEEDS: |
    [
      {
        "url": "https://example.com/rss",
        "channelId": "123456789012345678"
      }
    ]
```

### Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: discord-bot-hpa
  namespace: discord-bot
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: discord-article-bot
  minReplicas: 1
  maxReplicas: 1  # Keep at 1 to avoid duplicate bot responses
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 80
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### Network Policies

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: discord-bot-network-policy
  namespace: discord-bot
spec:
  podSelector:
    matchLabels:
      app: discord-article-bot
  policyTypes:
  - Ingress
  - Egress
  egress:
  # Allow DNS
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: UDP
      port: 53
  # Allow MongoDB
  - to:
    - podSelector:
        matchLabels:
          app: mongodb
    ports:
    - protocol: TCP
      port: 27017
  # Allow external HTTPS (Discord, OpenAI)
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: TCP
      port: 443
  ingress: []  # No ingress needed
```

## Monitoring

### View Logs

```bash
kubectl logs -f deployment/discord-article-bot -n discord-bot
```

### Check Pod Status

```bash
kubectl get pods -n discord-bot
kubectl describe pod -n discord-bot <pod-name>
```

### Resource Usage

```bash
kubectl top pods -n discord-bot
```

## Troubleshooting

### Pod Crashes or Restarts

1. Check logs:
   ```bash
   kubectl logs deployment/discord-article-bot -n discord-bot --previous
   ```

2. Check events:
   ```bash
   kubectl get events -n discord-bot --sort-by='.lastTimestamp'
   ```

3. Verify secrets:
   ```bash
   kubectl get secrets -n discord-bot
   ```

### Connection Issues

1. Test MongoDB connection:
   ```bash
   kubectl run -it --rm debug --image=mongo:6.0 --restart=Never -n discord-bot -- mongosh mongodb://admin:password@mongodb:27017/discord-bot?authSource=admin
   ```

2. Check network policies:
   ```bash
   kubectl get networkpolicies -n discord-bot
   ```

### Resource Constraints

If the bot is being killed due to memory limits:

1. Check resource usage:
   ```bash
   kubectl top pod -n discord-bot
   ```

2. Increase limits in deployment:
   ```yaml
   resources:
     limits:
       memory: "1Gi"
       cpu: "1000m"
   ```

## Backup and Recovery

### MongoDB Backup

Create a CronJob for regular backups:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mongodb-backup
  namespace: discord-bot
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: mongodb-backup
            image: mongo:6.0
            command:
            - sh
            - -c
            - |
              mongodump --uri="mongodb://admin:${MONGO_PASSWORD}@mongodb:27017/discord-bot?authSource=admin" --archive=/backup/backup-$(date +%Y%m%d).gz --gzip
            env:
            - name: MONGO_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: discord-bot-secrets
                  key: MONGO_PASSWORD
            volumeMounts:
            - name: backup
              mountPath: /backup
          restartPolicy: OnFailure
          volumes:
          - name: backup
            persistentVolumeClaim:
              claimName: mongodb-backup-pvc
```

## Security Best Practices

1. **Use RBAC**: Create a service account with minimal permissions
2. **Scan Images**: Use tools like Trivy to scan Docker images
3. **Update Regularly**: Keep dependencies and base images updated
4. **Use Network Policies**: Restrict network access as shown above
5. **Encrypt Secrets**: Consider using Sealed Secrets or external secret managers
6. **Resource Limits**: Always set resource requests and limits

## Scaling Considerations

⚠️ **Important**: This bot should typically run as a single instance to avoid:
- Duplicate responses to commands
- Multiple reactions to the same message
- Conflicting RSS feed processing

If high availability is required, consider:
- Using leader election
- Implementing distributed locking
- Separating concerns (e.g., separate RSS processor)

## Clean Up

To remove all resources:

```bash
kubectl delete namespace discord-bot
```

This will delete all resources in the namespace including:
- Deployments
- Services
- Secrets
- ConfigMaps
- PersistentVolumeClaims