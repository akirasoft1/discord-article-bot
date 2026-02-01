#!/bin/bash
# Quick Ollama prompt testing script
# Usage: ./scripts/test-ollama.sh "your message here"

OLLAMA_URL="http://192.168.1.164:11434/api/chat"
MODEL="dolphin-llama3:8b-v2.9-fp16"

# Read system prompt from personality file
SYSTEM_PROMPT=$(node -e "console.log(require('./personalities/uncensored.js').systemPrompt)")

USER_MESSAGE="${1:-Hello, how are you?}"

echo "=== Testing Ollama with uncensored personality ==="
echo "Model: $MODEL"
echo "User: $USER_MESSAGE"
echo "---"

curl -s "$OLLAMA_URL" -d "$(jq -n \
  --arg model "$MODEL" \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_MESSAGE" \
  '{
    model: $model,
    stream: false,
    messages: [
      {role: "system", content: $system},
      {role: "user", content: $user}
    ]
  }')" | jq -r '.message.content'
