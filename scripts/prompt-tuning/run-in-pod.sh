#!/usr/bin/env bash
# scripts/prompt-tuning/run-in-pod.sh
# Run the prompt-tuning tool inside the production bot pod so it can reach the
# in-cluster MongoDB and use the bot's already-populated env vars.
#
# Usage:
#   ./scripts/prompt-tuning/run-in-pod.sh <candidate-path> [--n N] [--label LABEL] [--channel ID] [--days D] [--model NAME] [--seed N]
#
# See scripts/prompt-tuning/README.md for the full workflow.

set -euo pipefail

NAMESPACE="discord-article-bot"
SELECTOR="app.kubernetes.io/name=discord-article-bot"
CONTAINER="bot"
REMOTE_BASE="/usr/src/app/scripts/prompt-tuning"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <candidate-path> [--n N] [--label LABEL] [--channel ID] [--days D] [--model NAME] [--seed N]" >&2
  exit 1
fi

CANDIDATE_LOCAL="$1"
shift

if [[ ! -f "${CANDIDATE_LOCAL}" ]]; then
  echo "ERROR: candidate file not found at ${CANDIDATE_LOCAL}" >&2
  exit 1
fi

CANDIDATE_BASENAME="$(basename "${CANDIDATE_LOCAL}")"

# Resolve current bot pod
POD="$(kubectl get pod -n "${NAMESPACE}" \
  -l "${SELECTOR}" \
  -o jsonpath='{.items[0].metadata.name}')"

if [[ -z "${POD}" ]]; then
  echo "ERROR: no pod found in namespace ${NAMESPACE} matching ${SELECTOR}" >&2
  exit 1
fi

echo "Using pod: ${POD}"

# Copy candidate into the pod
echo "Copying candidate into pod..."
kubectl cp -c "${CONTAINER}" \
  "${CANDIDATE_LOCAL}" \
  "${NAMESPACE}/${POD}:${REMOTE_BASE}/candidates/${CANDIDATE_BASENAME}"

# Build the in-pod command, forwarding --candidate and any extra flags the user passed
REMOTE_CANDIDATE="${REMOTE_BASE}/candidates/${CANDIDATE_BASENAME}"

# Forward the cost-confirm env var if set locally
ENV_ARGS=()
if [[ "${PROMPT_TUNING_CONFIRM_COST:-}" == "1" ]]; then
  ENV_ARGS+=(env PROMPT_TUNING_CONFIRM_COST=1)
fi

echo "Running prompt-tuning script inside pod..."
# Capture the output so we can find the report filename the script wrote
RUN_OUTPUT="$(mktemp)"
trap 'rm -f "${RUN_OUTPUT}"' EXIT

kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  "${ENV_ARGS[@]}" node "${REMOTE_BASE}/run.js" \
  --candidate "${REMOTE_CANDIDATE}" \
  "$@" | tee "${RUN_OUTPUT}"

# Extract the report path from the run's stdout (the script prints "Report written: <path>")
REPORT_REMOTE_PATH="$(grep -E '^Report written:' "${RUN_OUTPUT}" | head -1 | sed 's/^Report written: //' || true)"

if [[ -z "${REPORT_REMOTE_PATH}" ]]; then
  echo "" >&2
  echo "WARN: could not find 'Report written:' line in the script output. The candidate was left in the pod at ${REMOTE_CANDIDATE} so you can inspect manually." >&2
  exit 1
fi

REPORT_FILENAME="$(basename "${REPORT_REMOTE_PATH}")"
LOCAL_RUNS_DIR="$(dirname "$0")/runs"
mkdir -p "${LOCAL_RUNS_DIR}"

echo ""
echo "Copying report back to local: ${LOCAL_RUNS_DIR}/${REPORT_FILENAME}"
kubectl cp -c "${CONTAINER}" \
  "${NAMESPACE}/${POD}:${REPORT_REMOTE_PATH}" \
  "${LOCAL_RUNS_DIR}/${REPORT_FILENAME}"

# Clean up the candidate file from the pod so it doesn't survive across rolls
echo "Cleaning up candidate from pod..."
kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  rm -f "${REMOTE_CANDIDATE}" || true

# Also clean up the report from the pod so /runs/ doesn't accumulate
kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  rm -f "${REPORT_REMOTE_PATH}" || true

echo ""
echo "Done. Local report: ${LOCAL_RUNS_DIR}/${REPORT_FILENAME}"
