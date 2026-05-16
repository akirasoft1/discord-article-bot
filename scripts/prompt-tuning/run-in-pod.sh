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
# /usr/src/app is read-only (readOnlyRootFilesystem: true on the bot pod).
# Stage everything we cp into the writable /tmp emptyDir volume and tell
# run.js to look at /usr/src/app for config/services/node_modules via the
# BOT_APP_ROOT env var.
REMOTE_BASE="/tmp/prompt-tuning"
APP_ROOT_IN_POD="/usr/src/app"

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

# Ensure the remote dirs exist under /tmp (writable emptyDir; /usr/src/app is RO).
echo "Ensuring remote directories exist..."
kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  mkdir -p "${REMOTE_BASE}/candidates" "${REMOTE_BASE}/runs"

# Always copy run.js into the pod. We stage it under /tmp/prompt-tuning/run.js
# (not /usr/src/app/scripts/prompt-tuning/) because the root filesystem is
# read-only. run.js uses createRequire(BOT_APP_ROOT/package.json) to find
# config/services/node_modules at /usr/src/app, so its physical location
# under /tmp doesn't break module resolution.
LOCAL_RUN_JS="$(dirname "$0")/run.js"
if [[ ! -f "${LOCAL_RUN_JS}" ]]; then
  echo "ERROR: local run.js not found at ${LOCAL_RUN_JS}" >&2
  exit 1
fi
echo "Copying run.js into pod..."
kubectl cp -c "${CONTAINER}" \
  "${LOCAL_RUN_JS}" \
  "${NAMESPACE}/${POD}:${REMOTE_BASE}/run.js"

# Copy candidate into the pod
echo "Copying candidate into pod..."
kubectl cp -c "${CONTAINER}" \
  "${CANDIDATE_LOCAL}" \
  "${NAMESPACE}/${POD}:${REMOTE_BASE}/candidates/${CANDIDATE_BASENAME}"

# Build the in-pod command, forwarding --candidate and any extra flags the user passed
REMOTE_CANDIDATE="${REMOTE_BASE}/candidates/${CANDIDATE_BASENAME}"

# Build the env-prefix for the in-pod exec. BOT_APP_ROOT tells run.js where to
# find config/services/node_modules; PROMPT_TUNING_CONFIRM_COST is forwarded
# only if the caller set it locally.
ENV_PREFIX=(env "BOT_APP_ROOT=${APP_ROOT_IN_POD}")
if [[ "${PROMPT_TUNING_CONFIRM_COST:-}" == "1" ]]; then
  ENV_PREFIX+=("PROMPT_TUNING_CONFIRM_COST=1")
fi

echo "Running prompt-tuning script inside pod..."
# Capture the output so we can find the report filename the script wrote
RUN_OUTPUT="$(mktemp)"
trap 'rm -f "${RUN_OUTPUT}"' EXIT

kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  "${ENV_PREFIX[@]}" node "${REMOTE_BASE}/run.js" \
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

# Clean up the candidate + report files from the pod so they don't survive across rolls.
# (We deliberately leave run.js in place — harmless and saves the next run a copy step.)
echo "Cleaning up candidate + report from pod..."
kubectl exec -n "${NAMESPACE}" "${POD}" -c "${CONTAINER}" -- \
  rm -f "${REMOTE_CANDIDATE}" "${REPORT_REMOTE_PATH}" || true

echo ""
echo "Done. Local report: ${LOCAL_RUNS_DIR}/${REPORT_FILENAME}"
