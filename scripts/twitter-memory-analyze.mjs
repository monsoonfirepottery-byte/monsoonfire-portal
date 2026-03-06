#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipText,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJsonl,
  readNumberFlag,
  readStringFlag,
  stableHash,
  writeJson,
  writeJsonl,
} from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const AFFINITY_STOPWORDS = new Set([
  'item','url','this','that','with','have','from','your','will','would','could','should','there','their','about','into',
  'https','http','tweet','twitter','liked','like','text','created','export','what','when','where','which','them','they','then','than',
  'you','the','and','for','not','just','are','all','who','but','how','one','can','was','has','new','get','got','our','out','too',
  'its','it\'s','ive','i\'ve','dont','don\'t','did','didn\'t','more','most','very','after','before','over','under','because','people'
]);

function usage() {
  process.stdout.write([
    'Twitter native analysis stage',
    '',
    'Usage:',
    '  node ./scripts/twitter-memory-analyze.mjs --input ./output/memory/twitter-memory.jsonl --output ./output/memory/twitter-analysis-memory.jsonl',
    '',
    'Options:',
    '  --input <path>     Normalized Twitter JSONL',
    '  --output <path>    Analysis JSONL output',
    '  --report <path>    Analysis report JSON output',
    '  --max-output <n>   Max analyzed rows (default: 90)',
    '  --json             Print report JSON',
  ].join('\n'));
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function quarterKey(value) {
  const iso = parseDate(value);
  if (!iso) return null;
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function tokenize(value) {
  return uniqueStrings(
    String(value || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9#@._-]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !AFFINITY_STOPWORDS.has(token))
  ).slice(0, 24);
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

function addCount(map, key, amount = 1) {
  const normalized = normalizeWhitespace(key);
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + amount);
}

function topicTokensForRow(row) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const hashtagTokens = safeArray(metadata.hashtags).map((tag) => `#${String(tag).replace(/^#/, '')}`);
  const mentionTokens = safeArray(metadata.mentions).map((item) => `@${item}`);
  const lexicalTokens = tokenize(metadata.text || metadata.fullText || row.content || '');
  return uniqueStrings([...hashtagTokens, ...mentionTokens, ...lexicalTokens]).slice(0, 20);
}

function baseMetadata(row, extra = {}) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const occurredAt = parseDate(row?.occurredAt || metadata.createdAt || '');
  const sourceClientRequestIds = [String(row?.clientRequestId || '').trim()].filter(Boolean);
  return {
    ...extra,
    occurredAt,
    timeWindow: quarterKey(occurredAt || metadata.createdAt || ''),
    sourceClientRequestIds,
    sourceClientRequestId: sourceClientRequestIds[0] || null,
    topicTokens: topicTokensForRow(row),
    participantSet: uniqueStrings([
      ...safeArray(metadata.participants),
      ...safeArray(metadata.mentions).map((item) => `@${item}`),
      metadata.senderLabel,
      metadata.recipientLabel,
      metadata.initiatingUserLabel,
      metadata.ownerLabel,
    ]).slice(0, 12),
  };
}

function buildPublicExpressionRows(rows) {
  const scored = [];
  const byQuarter = new Map();
  for (const row of rows) {
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const kind = normalizeWhitespace(metadata.twitterKind || metadata.type);
    if (!['tweet', 'deleted_tweet', 'retweet'].includes(kind)) continue;
    const text = normalizeWhitespace(metadata.text || '');
    if (!text) continue;
    const mentions = safeArray(metadata.mentions);
    const hashtags = safeArray(metadata.hashtags);
    const urls = safeArray(metadata.urls);
    const isAuthored = kind === 'tweet' || kind === 'deleted_tweet';
    const score = Math.min(12, 3 + (isAuthored ? 3 : 0) + Math.min(3, Math.floor(text.length / 120)) + Math.min(2, hashtags.length) + Math.min(1, mentions.length) + Math.min(1, urls.length));
    if (score < 6) continue;
    scored.push({
      content: `${kind === 'retweet' ? 'Public endorsement' : kind === 'deleted_tweet' ? 'Deleted public expression' : 'Public expression'} on ${normalizeWhitespace(metadata.createdAt) || 'unknown-date'}: ${clipText(text, 220)}`,
      source: row.source,
      tags: uniqueStrings([...(row.tags || []), 'twitter-native', 'public-expression']),
      occurredAt: parseDate(metadata.createdAt || row.occurredAt || ''),
      clientRequestId: `twitter-public-${stableHash(`${row.clientRequestId}|${kind}`)}`,
      metadata: baseMetadata(row, {
        analysisType: 'twitter_public_expression',
        twitterSignalFamily: 'public_expression',
        signalFamily: 'identity_time',
        signalLane: 'primary',
        score,
        evidenceRichness: text.length > 180 ? 'high' : 'medium',
        attributionStrength: isAuthored ? 'strong' : 'moderate',
        twitterKind: kind,
        visibility: 'public',
        endorsementWeight: kind === 'retweet' ? 0.7 : 1,
        affinityWeight: 0,
        sensitivity: kind === 'deleted_tweet' ? 'sensitive' : 'normal',
        text,
        tweetId: metadata.tweetId || null,
        mentions,
        hashtags,
        urls,
      }),
      _rankBias: isAuthored ? 2 : 0,
    });
    const q = quarterKey(metadata.createdAt || row.occurredAt || '');
    if (q) {
      const bucket = byQuarter.get(q) || { authored: 0, retweets: 0, deleted: 0, topics: new Map() };
      if (kind === 'retweet') bucket.retweets += 1;
      else if (kind === 'deleted_tweet') bucket.deleted += 1;
      else bucket.authored += 1;
      for (const token of topicTokensForRow(row).slice(0, 6)) addCount(bucket.topics, token, 1);
      byQuarter.set(q, bucket);
    }
  }
  const quarterRows = topEntries(new Map([...byQuarter.entries()].map(([q, bucket]) => [q, bucket.authored + bucket.retweets + bucket.deleted])), 8).map(([q]) => {
    const bucket = byQuarter.get(q);
    const topTopics = topEntries(bucket.topics, 4).map(([token]) => token);
    const total = bucket.authored + bucket.retweets + bucket.deleted;
    return {
      content: `Twitter activity rhythm in ${q}: ${total} public actions, with ${bucket.authored} original tweets, ${bucket.retweets} retweets, and ${bucket.deleted} deleted tweets. Top topics: ${topTopics.join(', ') || 'none'}.`,
      source: 'social:twitter-export:analysis',
      tags: ['twitter', 'identity', 'rhythm'],
      occurredAt: null,
      clientRequestId: `twitter-rhythm-${stableHash(q)}`,
      metadata: {
        analysisType: 'twitter_activity_rhythm',
        twitterSignalFamily: 'identity_time',
        signalFamily: 'identity_time',
        signalLane: 'primary',
        score: Math.min(9, 4 + Math.floor(total / 120)),
        evidenceRichness: total >= 120 ? 'high' : 'medium',
        attributionStrength: 'moderate',
        timeWindow: q,
        eraQuarter: q,
        temporalGrain: 'quarter',
        topicTokens: topTopics,
        participantSet: [],
        sourceClientRequestIds: [],
      },
      _rankBias: 0,
    };
  });
  return [...scored.sort((a, b) => (Number(b.metadata.score || 0) + Number(b._rankBias || 0)) - (Number(a.metadata.score || 0) + Number(a._rankBias || 0))).slice(0, 24), ...quarterRows];
}

function buildAffinityRows(rows) {
  const likes = rows.filter((row) => normalizeWhitespace(row?.metadata?.twitterKind || row?.metadata?.type) === 'like');
  const byTopic = new Map();
  for (const row of likes) {
    const metadata = row.metadata || {};
    const q = quarterKey(metadata.createdAt || row.occurredAt || '') || 'unknown';
    const preferredTokens = [
      ...safeArray(metadata.hashtags).map((tag) => `#${tag}`),
      ...safeArray(metadata.mentions).map((item) => `@${item}`),
      ...tokenize(metadata.fullText || row.content || ''),
    ];
    for (const token of uniqueStrings(preferredTokens).slice(0, 4)) {
      const plain = token.replace(/^[@#]/, '').toLowerCase();
      if (!plain || AFFINITY_STOPWORDS.has(plain)) continue;
      const key = `${q}|${token}`;
      const bucket = byTopic.get(key) || { quarter: q, token, count: 0, ids: [] };
      bucket.count += 1;
      bucket.ids.push(String(row.clientRequestId || ''));
      byTopic.set(key, bucket);
    }
  }
  return [...byTopic.values()]
    .filter((bucket) => bucket.count >= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
    .map((bucket) => ({
      content: `Affinity pattern in ${bucket.quarter}: liked tweets repeatedly clustered around ${bucket.token} (${bucket.count} likes).`,
      source: 'social:twitter-export:analysis',
      tags: ['twitter', 'affinity'],
      occurredAt: null,
      clientRequestId: `twitter-affinity-${stableHash(`${bucket.quarter}|${bucket.token}`)}`,
      metadata: {
        analysisType: 'twitter_affinity_pattern',
        twitterSignalFamily: 'affinity_signal',
        signalFamily: 'identity_time',
        signalLane: 'primary',
        score: Math.min(8, 2 + Math.floor(bucket.count / 4)),
        evidenceRichness: bucket.count >= 12 ? 'high' : 'medium',
        attributionStrength: 'moderate',
        timeWindow: bucket.quarter,
        eraQuarter: bucket.quarter !== 'unknown' ? bucket.quarter : null,
        temporalGrain: 'quarter',
        topicTokens: [bucket.token],
        participantSet: [],
        sourceClientRequestIds: bucket.ids.slice(0, 24),
        twitterKind: 'like',
        visibility: 'public',
        affinityWeight: 0.45,
      },
    }));
}

function buildRelationshipRows(rows) {
  const byConversation = new Map();
  for (const row of rows) {
    const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const kind = normalizeWhitespace(metadata.twitterKind || metadata.type);
    if (!kind.startsWith('dm')) continue;
    const conversationId = normalizeWhitespace(metadata.conversationId || '');
    if (!conversationId) continue;
    const bucket = byConversation.get(conversationId) || {
      conversationId,
      count: 0,
      participants: new Set(),
      topics: new Map(),
      firstAt: null,
      lastAt: null,
      sourceIds: [],
      eventCount: 0,
      messageCount: 0,
    };
    bucket.count += 1;
    if (kind.includes('event')) bucket.eventCount += 1; else bucket.messageCount += 1;
    for (const part of uniqueStrings([...safeArray(metadata.participants), metadata.senderLabel, metadata.recipientLabel, metadata.initiatingUserLabel])) bucket.participants.add(part);
    for (const token of topicTokensForRow(row).slice(0, 6)) addCount(bucket.topics, token, 1);
    const occurredAt = parseDate(metadata.createdAt || row.occurredAt || '');
    if (occurredAt && (!bucket.firstAt || occurredAt < bucket.firstAt)) bucket.firstAt = occurredAt;
    if (occurredAt && (!bucket.lastAt || occurredAt > bucket.lastAt)) bucket.lastAt = occurredAt;
    bucket.sourceIds.push(String(row.clientRequestId || ''));
    byConversation.set(conversationId, bucket);
  }

  const relationshipRows = [];
  const conversationRows = [];
  for (const bucket of [...byConversation.values()].sort((a, b) => b.count - a.count).slice(0, 20)) {
    const topTopics = topEntries(bucket.topics, 5).map(([token]) => token);
    const participants = [...bucket.participants].slice(0, 8);
    relationshipRows.push({
      content: `DM relationship thread ${bucket.conversationId} involved ${participants.join(', ') || 'unknown participants'} across ${bucket.count} events/messages from ${bucket.firstAt || 'unknown'} to ${bucket.lastAt || 'unknown'}. Top topics: ${topTopics.join(', ') || 'none'}.`,
      source: 'social:twitter-export:analysis',
      tags: ['twitter', 'dm', 'relationship'],
      occurredAt: bucket.lastAt,
      clientRequestId: `twitter-dm-rel-${stableHash(bucket.conversationId)}`,
      metadata: {
        analysisType: 'twitter_dm_relationship',
        twitterSignalFamily: 'relationship_signal',
        signalFamily: 'relationship',
        signalLane: 'primary',
        score: Math.min(10, 4 + Math.floor(bucket.count / 3) + Math.min(2, participants.length)),
        evidenceRichness: bucket.count >= 6 ? 'high' : 'medium',
        attributionStrength: 'strong',
        timeWindow: quarterKey(bucket.lastAt || bucket.firstAt || ''),
        eraQuarter: quarterKey(bucket.lastAt || bucket.firstAt || ''),
        temporalGrain: 'conversation',
        topicTokens: topTopics,
        participantSet: participants,
        sourceClientRequestIds: bucket.sourceIds.slice(0, 32),
        twitterKind: 'dm_message',
        visibility: 'private',
        sensitivity: 'sensitive',
        conversationId: bucket.conversationId,
        messageCount: bucket.messageCount,
        eventCount: bucket.eventCount,
      },
    });
    conversationRows.push({
      content: `DM conversation ${bucket.conversationId} ran for ${bucket.count} entries with ${bucket.messageCount} messages and ${bucket.eventCount} events. Top topics: ${topTopics.join(', ') || 'none'}.`,
      source: 'social:twitter-export:analysis',
      tags: ['twitter', 'dm', 'conversation'],
      occurredAt: bucket.lastAt,
      clientRequestId: `twitter-dm-convo-${stableHash(bucket.conversationId)}`,
      metadata: {
        analysisType: 'twitter_dm_conversation',
        twitterSignalFamily: 'conversation_signal',
        signalFamily: 'relationship',
        signalLane: 'primary',
        score: Math.min(8, 3 + Math.floor(bucket.count / 4)),
        evidenceRichness: bucket.count >= 5 ? 'medium' : 'low',
        attributionStrength: 'moderate',
        timeWindow: quarterKey(bucket.lastAt || bucket.firstAt || ''),
        eraQuarter: quarterKey(bucket.lastAt || bucket.firstAt || ''),
        temporalGrain: 'conversation',
        topicTokens: topTopics,
        participantSet: participants,
        sourceClientRequestIds: bucket.sourceIds.slice(0, 24),
        twitterKind: 'dm_message',
        visibility: 'private',
        sensitivity: 'sensitive',
        conversationId: bucket.conversationId,
      },
    });
  }
  return { relationshipRows, conversationRows };
}

function buildMediaRows(rows) {
  return rows
    .filter((row) => normalizeWhitespace(row?.metadata?.twitterKind || row?.metadata?.type) === 'media_inventory')
    .filter((row) => Number(row?.metadata?.count || 0) > 0)
    .slice(0, 9)
    .map((row) => {
      const metadata = row.metadata || {};
      return {
        content: clipText(`Twitter media inventory for ${metadata.category || 'unknown'}: ${metadata.count || 0} files.`, 220),
        source: row.source,
        tags: uniqueStrings([...(row.tags || []), 'twitter-native', 'media-signal']),
        occurredAt: null,
        clientRequestId: `twitter-media-${stableHash(String(row.clientRequestId || row.content || ''))}`,
        metadata: {
          ...baseMetadata(row, {}),
          analysisType: 'twitter_media_summary',
          twitterSignalFamily: 'media_signal',
          signalFamily: 'document_attachment',
          signalLane: 'pattern',
          score: Math.min(6, 2 + Math.floor(Number(metadata.count || 0) / 100)),
          evidenceRichness: Number(metadata.count || 0) >= 100 ? 'high' : 'medium',
          attributionStrength: 'moderate',
          twitterKind: 'media_inventory',
          visibility: 'public',
          mediaCategory: metadata.category || null,
          attachmentCount: Number(metadata.count || 0) || 0,
          attachmentNames: safeArray(metadata.samples).slice(0, 20),
          attachmentMimeTypes: safeArray(metadata.topExtensions).map((item) => item?.ext).filter(Boolean),
        },
      };
    });
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, 'help', false) || readBoolFlag(flags, 'h', false)) {
    usage();
    return;
  }
  const inputPath = resolve(REPO_ROOT, readStringFlag(flags, 'input', './output/memory/twitter-memory.jsonl'));
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, 'output', './output/memory/twitter-analysis-memory.jsonl'));
  const reportPath = resolve(REPO_ROOT, readStringFlag(flags, 'report', './output/memory/twitter-analysis-report.json'));
  const maxOutput = readNumberFlag(flags, 'max-output', 90, { min: 1, max: 2000 });
  const printJson = readBoolFlag(flags, 'json', false);

  const rows = readJsonl(inputPath).filter((row) => row && typeof row === 'object');
  const publicRows = buildPublicExpressionRows(rows);
  const affinityRows = buildAffinityRows(rows);
  const { relationshipRows, conversationRows } = buildRelationshipRows(rows);
  const mediaRows = buildMediaRows(rows);

  const allRows = [...publicRows, ...affinityRows, ...relationshipRows, ...conversationRows, ...mediaRows]
    .sort((a, b) => (Number(b?.metadata?.score || 0) + Number(b?._rankBias || 0)) - (Number(a?.metadata?.score || 0) + Number(a?._rankBias || 0)))
    .slice(0, maxOutput)
    .map((row) => {
      const next = { ...row };
      delete next._rankBias;
      return next;
    });

  writeJsonl(outputPath, allRows);
  const report = {
    schema: 'twitter-analysis-report.v1',
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    counts: {
      unitsTotal: rows.length,
      analyzedRows: allRows.length,
      publicExpressionRows: publicRows.length,
      affinityRows: affinityRows.length,
      relationshipRows: relationshipRows.length,
      conversationRows: conversationRows.length,
      mediaRows: mediaRows.length,
    },
  };
  writeJson(reportPath, report);
  if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try { run(); } catch (error) {
  process.stderr.write(`twitter-memory-analyze failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
