#!/usr/bin/env node
import fs from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readLastEvents(filePath, limit = 8) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: 'invalid_event', raw: line };
      }
    });
  } catch {
    return [];
  }
}

function render(status, events) {
  const lines = [];
  lines.push(`Full run: ${status?.waveId ?? 'unknown'}`);
  lines.push(`State: ${status?.state ?? 'unknown'}`);
  lines.push(`Phase: ${status?.currentPhase ?? 'unknown'}`);
  lines.push(`Elapsed ms: ${status?.elapsedMs ?? 'unknown'}`);
  if (status?.phases) {
    for (const [key, value] of Object.entries(status.phases)) {
      lines.push(`${key}: ${value?.status ?? 'unknown'}`);
    }
  }
  lines.push('');
  lines.push('Recent events:');
  for (const event of events) {
    lines.push(`- ${event.at ?? 'unknown'} ${event.type}${event.phase ? ` ${event.phase}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statusPath = args.status;
  const eventsPath = args.events;
  const refreshMs = Number(args['refresh-ms'] || 2000);
  const once = Boolean(args.once);
  if (!statusPath || !eventsPath) {
    console.error('Usage: node ./scripts/open-memory-full-production-watch.mjs --status <path> --events <path> [--refresh-ms 2000] [--once]');
    process.exit(1);
  }
  do {
    const status = readJson(statusPath);
    const events = readLastEvents(eventsPath, 10);
    process.stdout.write('\u001bc');
    process.stdout.write(render(status, events));
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, refreshMs));
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
