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

  const candidateModule = require(args.candidate);
  const baselineModule = require(args.baseline);

  for (const [name, mod] of [['candidate', candidateModule], ['baseline', baselineModule]]) {
    if (!mod || typeof mod.systemPrompt !== 'string') {
      console.error(`ERROR: ${name} (${name === 'candidate' ? args.candidate : args.baseline}) must export a personality module with a 'systemPrompt' string field`);
      process.exit(1);
    }
    if (!mod.systemPrompt.includes('{VOICE_INSTRUCTIONS}')) {
      console.warn(`WARN: ${name} systemPrompt does not contain {VOICE_INSTRUCTIONS} — voice profile will not be substituted`);
    }
  }

  const MongoService = require('../../services/MongoService');
  const mongoService = new MongoService(config.mongo.uri);
  await mongoService.connect();

  let voiceProfile;
  try {
    const collection = mongoService.db.collection('voice_profiles');
    voiceProfile = await collection.findOne({}, { sort: { version: -1 } });
  } catch (err) {
    console.warn(`WARN: failed to load voice_profiles: ${err.message}`);
  }

  let voiceInstructions = '[no voice profile available]';
  let voiceProfileMeta = { version: null, generatedAt: null };
  if (voiceProfile?.voiceInstructions) {
    voiceInstructions = voiceProfile.voiceInstructions;
    voiceProfileMeta = { version: voiceProfile.version, generatedAt: voiceProfile.generatedAt };
    console.log(`Loaded voice profile v${voiceProfile.version} (generated ${voiceProfile.generatedAt})`);
  } else {
    console.warn('WARN: no voice profile found in MongoDB — using stub placeholder');
  }

  console.log('voiceInstructions length:', voiceInstructions.length);

  // Sample input messages
  const messagesCollection = mongoService.db.collection('channel_messages');
  const sinceMs = Date.now() - (args.days * 24 * 60 * 60 * 1000);
  const sinceDate = new Date(sinceMs);

  const botUserId = config.discord?.clientId;
  if (!botUserId) {
    console.warn('WARN: config.discord.clientId is not set — bot replies will not be filtered out of the sample');
  }

  const filter = {
    timestamp: { $gte: sinceDate },
    content: { $exists: true, $type: 'string', $not: /^\/\w/ } // reject slash-command invocations
  };
  if (botUserId) {
    filter.authorId = { $ne: botUserId };
  }
  if (args.channel) {
    filter.channelId = args.channel;
  }

  const sampled = await messagesCollection
    .find(filter, { projection: { content: 1, authorId: 1, authorName: 1, channelId: 1, timestamp: 1 } })
    .sort({ timestamp: -1 })
    .limit(args.n)
    .toArray();

  if (sampled.length === 0) {
    const where = args.channel ? ` in channel ${args.channel}` : '';
    console.error(`ERROR: no eligible messages found for last ${args.days} days${where}`);
    await mongoService.disconnect();
    process.exit(1);
  }

  // Reverse so report shows oldest first (more natural reading order)
  sampled.reverse();
  console.log(`Sampled ${sampled.length} messages`);

  await mongoService.disconnect();
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const baselineSystem = baselineModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions);
  const candidateSystem = candidateModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions);

  async function callOnce(systemPrompt, userContent) {
    try {
      const params = {
        model: args.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      };
      if (typeof args.seed === 'number') params.seed = args.seed;
      const resp = await openai.chat.completions.create(params);
      return {
        ok: true,
        text: resp.choices?.[0]?.message?.content || '',
        usage: resp.usage || null
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  // Batch with concurrency 4
  const BATCH = 4;
  const results = new Array(sampled.length);
  let completed = 0;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const slice = sampled.slice(i, i + BATCH);
    const sliceResults = await Promise.all(slice.map(async (msg) => {
      const [base, cand] = await Promise.all([
        callOnce(baselineSystem, msg.content),
        callOnce(candidateSystem, msg.content)
      ]);
      return { msg, baseline: base, candidate: cand };
    }));
    sliceResults.forEach((r, j) => {
      results[i + j] = r;
      completed++;
      console.log(`[${completed}/${sampled.length}] case complete`);
    });
  }

  // Task 6 onwards extend main() — build + write the report
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err);
  process.exit(1);
});
