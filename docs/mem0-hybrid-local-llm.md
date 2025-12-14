# Mem0 Hybrid Configuration: Local LLM + OpenAI Embeddings

## Overview

This document describes a cost-optimized configuration for Mem0 that uses:
- **OpenAI `text-embedding-3-small`** for vector embeddings (cheap, high quality)
- **Local Ollama LLM** for memory extraction (free, runs on RTX 4090)

### Cost Comparison

| Configuration | 10k msgs/day | Monthly Cost |
|---------------|--------------|--------------|
| Full OpenAI (current) | ~$3-5/day | ~$100-150 |
| Hybrid (this proposal) | ~$0.01/day | ~$3 |

---

## Prerequisites

### Hardware
- NVIDIA RTX 4090 (24GB VRAM) or similar
- CUDA drivers installed
- ~20GB disk space for models

### Software
- Ollama installed on GPU machine
- Network access from k8s cluster to Ollama host

---

## Setup Instructions

### 1. Install Ollama on GPU Machine

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull recommended models
ollama pull llama3.1:8b      # For memory extraction (~4.7GB)
ollama pull mistral:7b       # Alternative, faster (~4.1GB)

# Verify installation
ollama list
```

### 2. Configure Ollama for Network Access

By default, Ollama only listens on localhost. To expose it:

```bash
# Edit Ollama service configuration
sudo systemctl edit ollama

# Add these lines:
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"

# Restart Ollama
sudo systemctl restart ollama

# Verify it's listening on all interfaces
curl http://<GPU_MACHINE_IP>:11434/api/tags
```

### 3. Network Connectivity Options

#### Option A: Direct Network Access (Simplest)
If your k8s cluster can reach the GPU machine directly:
```
OLLAMA_BASE_URL=http://<GPU_MACHINE_IP>:11434
```

#### Option B: Kubernetes ExternalName Service
Create a service pointing to the external Ollama:

```yaml
# k8s/mem0/ollama-external.yaml
apiVersion: v1
kind: Service
metadata:
  name: ollama
  namespace: discord-article-bot
spec:
  type: ExternalName
  externalName: <GPU_MACHINE_HOSTNAME_OR_IP>
  ports:
    - port: 11434
      targetPort: 11434
```

#### Option C: Run Ollama in Kubernetes (if GPU node in cluster)
```yaml
# k8s/mem0/ollama-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  namespace: discord-article-bot
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          ports:
            - containerPort: 11434
          resources:
            limits:
              nvidia.com/gpu: 1
              memory: "24Gi"
          volumeMounts:
            - name: ollama-data
              mountPath: /root/.ollama
      volumes:
        - name: ollama-data
          persistentVolumeClaim:
            claimName: ollama-pvc
      nodeSelector:
        nvidia.com/gpu.present: "true"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama
  namespace: discord-article-bot
spec:
  selector:
    app: ollama
  ports:
    - port: 11434
      targetPort: 11434
```

---

## Code Changes

### 4. Update Configuration (config/default.js or environment)

```javascript
// Add to config
mem0: {
  enabled: true,
  openaiApiKey: process.env.OPENAI_API_KEY,

  // Hybrid configuration
  llmProvider: process.env.MEM0_LLM_PROVIDER || 'ollama',  // 'openai' or 'ollama'
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://ollama:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b',

  // Keep OpenAI for embeddings (cheap and high quality)
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',

  // Qdrant settings (unchanged)
  qdrantHost: process.env.MEM0_QDRANT_HOST || 'qdrant',
  qdrantPort: parseInt(process.env.MEM0_QDRANT_PORT) || 6333,
}
```

### 5. Update Mem0Service.js

```javascript
// services/Mem0Service.js - Updated constructor

const { Memory } = require('mem0ai/oss');
const logger = require('../logger');

class Mem0Service {
  constructor(config) {
    if (!config.mem0?.enabled) {
      this.enabled = false;
      return;
    }

    if (!config.mem0.openaiApiKey) {
      throw new Error('OPENAI_API_KEY required for Mem0 embeddings');
    }

    this.config = config.mem0;
    this.enabled = true;

    // Build LLM configuration based on provider
    let llmConfig;
    if (this.config.llmProvider === 'ollama') {
      llmConfig = {
        provider: 'ollama',
        config: {
          model: this.config.ollamaModel || 'llama3.1:8b',
          ollama_base_url: this.config.ollamaBaseUrl || 'http://localhost:11434',
          temperature: 0.1,  // Lower temperature for consistent extraction
        }
      };
      logger.info(`Mem0 using Ollama LLM: ${this.config.ollamaModel} at ${this.config.ollamaBaseUrl}`);
    } else {
      llmConfig = {
        provider: 'openai',
        config: {
          model: this.config.llmModel || 'gpt-4o-mini',
          api_key: this.config.openaiApiKey,
        }
      };
      logger.info(`Mem0 using OpenAI LLM: ${this.config.llmModel || 'gpt-4o-mini'}`);
    }

    // Always use OpenAI for embeddings (cost-effective and high quality)
    const embedderConfig = {
      provider: 'openai',
      config: {
        model: this.config.embeddingModel || 'text-embedding-3-small',
        api_key: this.config.openaiApiKey,
        embedding_dims: 1536,
      }
    };

    const mem0Config = {
      llm: llmConfig,
      embedder: embedderConfig,
      vector_store: {
        provider: 'qdrant',
        config: {
          collection_name: 'discord_memories',
          host: this.config.qdrantHost || 'localhost',
          port: this.config.qdrantPort || 6333,
          embedding_model_dims: 1536,
        }
      },
      version: 'v1.1'
    };

    this.memory = new Memory(mem0Config);
    logger.info('Mem0 service initialized with hybrid configuration');
  }

  // ... rest of the methods remain unchanged
}
```

### 6. Environment Variables

Add to your deployment:

```yaml
# k8s/overlays/deployed/configmap.yaml (add these)
MEM0_LLM_PROVIDER: "ollama"
OLLAMA_BASE_URL: "http://ollama.discord-article-bot.svc.cluster.local:11434"
OLLAMA_MODEL: "llama3.1:8b"
```

Or in `.env`:
```bash
MEM0_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://192.168.1.100:11434  # Your GPU machine IP
OLLAMA_MODEL=llama3.1:8b
```

---

## Performance Tuning

### Model Selection

| Model | VRAM | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| `llama3.1:8b` | ~5GB | Good | Excellent | Recommended default |
| `mistral:7b` | ~4GB | Excellent | Very Good | High throughput |
| `llama3.1:70b` | ~40GB | Slow | Best | If you have A100/H100 |
| `phi3:mini` | ~2GB | Fastest | Good | Resource constrained |

### Batching for High Volume

For 10k+ messages/day, consider batching memory extraction:

```javascript
// Instead of extracting on every message, batch hourly
class BatchedMem0Service extends Mem0Service {
  constructor(config) {
    super(config);
    this.pendingMessages = [];
    this.batchInterval = 60 * 60 * 1000; // 1 hour

    setInterval(() => this.flushBatch(), this.batchInterval);
  }

  async addMemory(messages, userId, metadata) {
    // Queue instead of immediate processing
    this.pendingMessages.push({ messages, userId, metadata, timestamp: Date.now() });

    // Flush if batch is large enough
    if (this.pendingMessages.length >= 100) {
      await this.flushBatch();
    }
  }

  async flushBatch() {
    if (this.pendingMessages.length === 0) return;

    const batch = this.pendingMessages.splice(0, 100);
    logger.info(`Processing batch of ${batch.length} messages for memory extraction`);

    for (const item of batch) {
      try {
        await super.addMemory(item.messages, item.userId, item.metadata);
      } catch (error) {
        logger.error(`Batch memory extraction failed: ${error.message}`);
      }
    }
  }
}
```

---

## Monitoring

### Health Check for Ollama

```javascript
// Add to Mem0Service.js
async checkOllamaHealth() {
  if (this.config.llmProvider !== 'ollama') return true;

  try {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/tags`);
    return response.ok;
  } catch (error) {
    logger.error(`Ollama health check failed: ${error.message}`);
    return false;
  }
}
```

### Metrics to Watch

- Ollama response latency (should be <2s for 8B model)
- GPU memory utilization (should stay <20GB for llama3.1:8b)
- Memory extraction queue depth (if batching)

---

## Fallback Strategy

If Ollama is unavailable, fall back to OpenAI:

```javascript
async addMemory(messages, userId, metadata) {
  try {
    return await this.memory.add(messages, userId, metadata);
  } catch (error) {
    if (this.config.llmProvider === 'ollama' && error.message.includes('connection')) {
      logger.warn('Ollama unavailable, skipping memory extraction');
      // Optionally: queue for retry or fall back to OpenAI
      return { results: [] };
    }
    throw error;
  }
}
```

---

## Migration Steps

1. Set up Ollama on GPU machine
2. Test connectivity from k8s cluster
3. Deploy with `MEM0_LLM_PROVIDER=ollama`
4. Monitor for 24h to ensure quality
5. Enable passive channel observation if satisfied

---

## Cost Summary

| Scenario | Daily Messages | OpenAI Cost | Hybrid Cost | Savings |
|----------|---------------|-------------|-------------|---------|
| Current (bot interactions only) | ~100 | ~$0.50 | ~$0.01 | 98% |
| Passive observation (1 channel) | 10,000 | ~$5.00 | ~$0.10 | 98% |
| Passive observation (10 channels) | 100,000 | ~$50.00 | ~$1.00 | 98% |

The hybrid approach makes passive channel observation economically viable.
