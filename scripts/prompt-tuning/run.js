#!/usr/bin/env node
// scripts/prompt-tuning/run.js
// Local prompt tuning tool — see docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md

const fs = require('fs');
const path = require('path');

const config = require('../../config/config');

function parseArgs(argv) {
  const args = { n: 20, days: 7, baseline: path.resolve(__dirname, '..', '..', 'personalities', 'channel-voice.js') };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--candidate':
        args.candidate = path.resolve(next);
        i++;
        break;
      case '--n':
        args.n = parseInt(next, 10);
        i++;
        break;
      case '--label':
        args.label = next;
        i++;
        break;
      case '--channel':
        args.channel = next;
        i++;
        break;
      case '--days':
        args.days = parseInt(next, 10);
        i++;
        break;
      case '--baseline':
        args.baseline = path.resolve(next);
        i++;
        break;
      case '--model':
        args.model = next;
        i++;
        break;
      case '--seed':
        args.seed = parseInt(next, 10);
        i++;
        break;
      case '--help':
      case '-h':
        printHelpAndExit();
        break;
      default:
        if (flag.startsWith('--')) {
          console.error(`ERROR: unknown flag ${flag}`);
          process.exit(1);
        }
    }
  }

  if (!args.candidate) {
    console.error('ERROR: --candidate <path> is required');
    process.exit(1);
  }
  if (!fs.existsSync(args.candidate)) {
    console.error(`ERROR: candidate file not found at ${args.candidate}`);
    process.exit(1);
  }
  if (!fs.existsSync(args.baseline)) {
    console.error(`ERROR: baseline file not found at ${args.baseline}`);
    process.exit(1);
  }
  if (!args.label) {
    args.label = path.basename(args.candidate, path.extname(args.candidate));
  }
  if (!args.model) {
    args.model = config.openai?.model || 'gpt-5-mini';
  }
  if (!Number.isFinite(args.n) || args.n <= 0) {
    console.error('ERROR: --n must be a positive integer');
    process.exit(1);
  }
  if (!Number.isFinite(args.days) || args.days <= 0) {
    console.error('ERROR: --days must be a positive integer');
    process.exit(1);
  }
  return args;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/prompt-tuning/run.js --candidate <path> [--n N] [--label LABEL] [--channel ID] [--days D] [--baseline PATH] [--model NAME] [--seed N]

Replays the last --n user messages from MongoDB against the candidate AND baseline
systemPrompt templates, then writes a markdown side-by-side comparison report.

See docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md for the full spec.`);
  process.exit(0);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!config.openai?.apiKey) {
    console.error('ERROR: OPENAI_API_KEY is not set');
    process.exit(1);
  }
  if (!config.mongo?.uri) {
    console.error('ERROR: MONGO_URI is not set');
    process.exit(1);
  }
  console.log('Args:', { ...args, candidate: path.basename(args.candidate), baseline: path.basename(args.baseline) });
  // Task 3 onwards extend main()
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err);
  process.exit(1);
});
