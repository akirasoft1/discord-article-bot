# Discord Article Bot - Development Guidelines

## Feature Development Workflow (TDD + Build + Deploy)

When implementing new features or fixes, follow this complete workflow:

### 1. Create Feature Branch
```bash
git checkout main && git pull origin main
git checkout -b feat/<feature-name>
# or fix/<issue-name> for bug fixes
```

### 2. TDD: Write Tests First (Red Phase)
- Write failing tests in `__tests__/` that define expected behavior
- Run tests to confirm they fail: `npm test -- --testPathPatterns="<TestFile>"`
- Tests should cover: happy path, edge cases, error handling

### 3. Implement Feature (Green Phase)
- Write minimal code to make tests pass
- Run tests frequently to verify progress
- Commit checkpoints with descriptive messages

### 4. Refactor (if needed)
- Clean up implementation while keeping tests green
- Ensure code follows existing patterns in codebase

### 5. Run Full Test Suite
```bash
npm test
```
All tests must pass before proceeding.

### 6. Update Documentation
- Update `features.md` with new capabilities
- Update `README.md` if user-facing features changed
- Update `CLAUDE.md` if development practices changed

### 7. Commit Changes
```bash
git add -A
git commit -m "feat: <description>

<detailed explanation>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 8. Bump Version
```bash
npm version patch --no-git-tag-version  # for fixes
npm version minor --no-git-tag-version  # for features
git add package.json package-lock.json
git commit -m "chore: bump version to <version>"
```

### 9. Build and Push Docker Image
```bash
docker build -t mvilliger/discord-article-bot:<version> .
docker push mvilliger/discord-article-bot:<version>
```

### 10. Deploy to Kubernetes
```bash
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:<version> -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=120s
```

### 11. Verify Deployment
```bash
kubectl get pods -n discord-article-bot
kubectl logs -f deployment/discord-article-bot -n discord-article-bot
```

### 12. Push Branch and Create PR
```bash
git push -u origin feat/<feature-name>
# Create PR via GitHub (gh auth may be expired)
```

### Checkpoint Commits
For larger features, commit checkpoints along the way:
- After tests are written (even if failing)
- After major implementation milestones
- Before risky refactoring

---

## Important Notes
- **Development Methodology**: Follow Test-Driven Development (TDD) practices. Write tests before implementing features or fixes.

## Deployment

- **Namespace**: Always deploy to `discord-article-bot` namespace, not `default`
- **Container name**: The deployment container is named `bot`, not `discord-article-bot`
- **Source of truth**: `k8s/overlays/deployed/` (gitignored, contains real secrets)
- **Do NOT use kustomize**: The `k8s/base/` and `k8s/overlays/prod/` are out of sync and contain placeholder secrets

### Deployment Steps

1. Build and push Docker image:
   ```bash
   docker build -t mvilliger/discord-article-bot:<version> .
   docker push mvilliger/discord-article-bot:<version>
   ```

2. Update image version in `k8s/overlays/deployed/deployment.yaml`

3. Apply the deployment:
   ```bash
   kubectl apply -f k8s/overlays/deployed/ -n discord-article-bot
   ```

   Or for image-only updates:
   ```bash
   kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:<version> -n discord-article-bot
   ```

4. Verify rollout:
   ```bash
   kubectl rollout status deployment/discord-article-bot -n discord-article-bot
   ```

### NetworkPolicy Configuration

**IMPORTANT**: This namespace uses a restrictive NetworkPolicy that blocks egress to private IP ranges by default.

When adding a new external service integration (especially services on local/home network IPs like `192.168.x.x`, `10.x.x.x`, `172.16.x.x`):

1. **Update the NetworkPolicy** in `k8s/overlays/deployed/networkpolicy.yaml`
2. Add an egress rule for the specific IP and port:
   ```yaml
   # Example: Allow Local LLM (Ollama) on home network
   - to:
       - ipBlock:
           cidr: 192.168.1.164/32
     ports:
       - protocol: TCP
         port: 11434
   ```
3. Apply the change: `kubectl apply -f k8s/overlays/deployed/networkpolicy.yaml -n discord-article-bot`
4. Restart the pod to re-initialize the service

**Debugging connectivity issues**:
```bash
# Check current NetworkPolicy
kubectl get networkpolicies -n discord-article-bot -o yaml

# Test connectivity from a fresh pod (no NetworkPolicy restrictions)
kubectl run test-curl --rm -it --image=curlimages/curl -- curl http://<ip>:<port>/endpoint
```

## Slash Command Development Guidelines

When creating or modifying slash commands:

1. **Service method signatures**: Verify correct method names and parameter order by checking the service implementation
   - Example: `resetConversation(channelId, personalityId)` - channelId comes first
   - Example: `listUserConversations(userId, guildId)` - requires guildId parameter

2. **Service enabled checks**: Optional services (Mem0, Qdrant, etc.) need `isEnabled()` checks at the start of execute()
   ```javascript
   if (!this.mem0Service.isEnabled()) {
     await this.sendReply(interaction, {
       content: 'Memory feature is not enabled on this bot.',
       ephemeral: true
     });
     return;
   }
   ```

3. **Error handling patterns**: Some errors should not have "Error:" prefix
   - Conversation limit reasons ('expired', 'message_limit', 'token_limit') are informational, not errors

4. **Default values**: All chat commands should default to `friendly` personality when none specified

5. **Formatter usage**: Use service formatters (e.g., `qdrantService.formatResult()`) for consistent output

## Discord Embed Limits

- Embed field name: max 256 characters
- Embed field value: max 1024 characters (NOT 4000)
- Empty field values cause validation errors - always provide fallback text

## Testing

- Run `npm test` before deployment
- Slash command tests need to mock all service methods including `isEnabled()`
- Global slash commands take up to 1 hour to propagate; use `DISCORD_TEST_GUILD_ID` for faster testing

## Debugging Common Issues

### Duplicate Messages / Multiple Replies

**ALWAYS CHECK FIRST**: Are there multiple bot instances running with the same Discord token?

```bash
# Check ALL namespaces for bot deployments
kubectl get pods -A | grep -i discord
kubectl get deployments -A | grep -i discord
```

Multiple instances with the same token will ALL receive Discord events and ALL respond, causing:
- Duplicate replies (different content if conversation contexts differ)
- One reply faster than the other
- Replies with stale/old conversation context

**Root cause example (Dec 2025)**: A forgotten deployment in `default` namespace ran alongside the production deployment in `discord-article-bot` namespace for 10 days, causing duplicate replies to every message.

## File Locations

- Slash commands: `commands/slash/`
- Base command class: `commands/base/BaseSlashCommand.js`
- Services: `services/`
- Tests: `__tests__/`
