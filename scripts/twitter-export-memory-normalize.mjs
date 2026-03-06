#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  stableHash,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Twitter export -> memory normalizer",
      "",
      "Usage:",
      "  node ./scripts/twitter-export-memory-normalize.mjs \\",
      "    --input-dir ./imports/zips-extracted/twitter-.../data \\",
      "    --output ./imports/zips-extracted/twitter-.../twitter-memory.jsonl",
      "",
      "Options:",
      "  --input-dir <path>               Twitter export data directory",
      "  --output <path>                  Output JSONL path",
      "  --source <value>                 Source tag (default: social:twitter-export)",
      "  --include-likes true|false       Include like.js entries (default: true)",
      "  --include-media-summary true|false Emit media inventory rollups (default: true)",
      "  --max-text-chars <n>             Clip long text fields (default: 2200)",
      "  --json true|false                Print summary JSON",
    ].join("\n")
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYtdArray(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  const equalIndex = raw.indexOf("=");
  if (equalIndex < 0) return [];
  const jsonLike = raw.slice(equalIndex + 1).trim().replace(/;?\s*$/, "");
  try {
    const parsed = JSON.parse(jsonLike);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function listMediaFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function buildMediaIndex(fileNames) {
  const map = new Map();
  for (const fileName of fileNames) {
    const prefix = normalizeText(fileName.split("-")[0] || "");
    if (!prefix) continue;
    const bucket = map.get(prefix) || [];
    bucket.push(fileName);
    map.set(prefix, bucket);
  }
  return map;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseTwitterDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString();
}

function writeRows(path, rows) {
  ensureParentDir(path);
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
}

function parseTextEntities(text) {
  const normalized = normalizeText(text);
  return {
    mentions: Array.from(new Set((normalized.match(/@([A-Za-z0-9_]{1,15})/g) || []).map((item) => item.slice(1)))).slice(0, 24),
    hashtags: Array.from(new Set((normalized.match(/#([A-Za-z0-9_]+)/g) || []).map((item) => item.slice(1)))).slice(0, 24),
  };
}

function loadTwitterIdentityMaps(inputDir) {
  const account = parseYtdArray(resolve(inputDir, "account.js"));
  const profile = parseYtdArray(resolve(inputDir, "profile.js"));
  const following = parseYtdArray(resolve(inputDir, "following.js"));
  const followers = parseYtdArray(resolve(inputDir, "follower.js"));

  const ownerAccount = account[0]?.account || {};
  const ownerId = normalizeText(ownerAccount.accountId || "");
  const ownerUsername = normalizeText(ownerAccount.username || "");
  const ownerDisplay = normalizeText(ownerAccount.accountDisplayName || ownerUsername || ownerId);

  const accountLabels = new Map();
  if (ownerId) {
    accountLabels.set(ownerId, ownerUsername ? `@${ownerUsername}` : ownerDisplay || `user:${ownerId}`);
  }

  for (const item of [...following, ...followers]) {
    const record = item?.following || item?.follower || {};
    const accountId = normalizeText(record.accountId || "");
    if (!accountId || accountLabels.has(accountId)) continue;
    accountLabels.set(accountId, `user:${accountId}`);
  }

  return {
    ownerId: ownerId || null,
    ownerUsername: ownerUsername || null,
    ownerDisplay: ownerDisplay || null,
    ownerBio: normalizeText(profile[0]?.profile?.description?.bio || "") || null,
    ownerLocation: normalizeText(profile[0]?.profile?.description?.location || "") || null,
    accountLabels,
  };
}

function labelAccount(id, identity) {
  const normalized = normalizeText(id);
  if (!normalized) return "";
  return identity.accountLabels.get(normalized) || `user:${normalized}`;
}

function detectRetweet(text) {
  return /^RT\s+@[A-Za-z0-9_]{1,15}\s*:/i.test(normalizeText(text));
}

function tweetToRow({ tweet, source, maxTextChars, tweetMediaIndex, deleted = false, identity }) {
  const id = normalizeText(tweet.id_str || tweet.id || "");
  const text = clipText(normalizeText(tweet.full_text || tweet.text || ""), maxTextChars);
  const createdAt = parseTwitterDate(tweet.created_at);
  const entityMentions = safeArray(tweet?.entities?.user_mentions).map((item) => normalizeText(item?.screen_name || "")).filter(Boolean);
  const entityHashtags = safeArray(tweet?.entities?.hashtags).map((item) => normalizeText(item?.text || "")).filter(Boolean);
  const urls = safeArray(tweet?.entities?.urls).map((item) => normalizeText(item?.expanded_url || item?.url || "")).filter(Boolean);
  const localMediaFiles = id ? (tweetMediaIndex.get(id) || []).slice(0, 16) : [];
  const inferred = parseTextEntities(text);
  const mentions = Array.from(new Set([...entityMentions, ...inferred.mentions])).slice(0, 24);
  const hashtags = Array.from(new Set([...entityHashtags, ...inferred.hashtags])).slice(0, 24);
  const retweeted = detectRetweet(text) || Boolean(tweet.retweeted);
  const twitterKind = deleted ? "deleted_tweet" : retweeted ? "retweet" : "tweet";

  const content = [
    deleted ? "Deleted tweet export item." : "Tweet export item.",
    createdAt ? `Created: ${createdAt}.` : "",
    text ? `Text: ${text}` : "(no text)",
    mentions.length > 0 ? `Mentions: ${mentions.join(", ")}.` : "",
    hashtags.length > 0 ? `Hashtags: ${hashtags.join(", ")}.` : "",
    urls.length > 0 ? `URLs: ${urls.join(", ")}.` : "",
    localMediaFiles.length > 0 ? `Local media files: ${localMediaFiles.join(", ")}.` : "",
  ].filter(Boolean).join(" ");

  return {
    unitType: "message",
    occurredAt: createdAt || undefined,
    content,
    source,
    tags: ["twitter", "tweet", deleted ? "deleted" : "active", retweeted ? "retweet" : "original"],
    clientRequestId: `twitter-tweet-${stableHash(`${deleted ? "d" : "a"}|${id}|${text}`, 20)}`,
    metadata: {
      type: deleted ? "twitter_deleted_tweet" : "twitter_tweet",
      twitterKind,
      visibility: "public",
      endorsementWeight: retweeted ? 0.7 : 1,
      affinityWeight: 0,
      sensitivity: deleted ? "sensitive" : "normal",
      participants: mentions.map((item) => `@${item}`),
      ownerAccountId: identity.ownerId,
      ownerUsername: identity.ownerUsername,
      ownerLabel: identity.ownerUsername ? `@${identity.ownerUsername}` : identity.ownerDisplay,
      tweetId: id || null,
      createdAt: createdAt || null,
      text,
      lang: normalizeText(tweet.lang || "") || null,
      sourceClient: normalizeText(tweet.source || "") || null,
      favoriteCount: Number.parseInt(String(tweet.favorite_count || "0"), 10) || 0,
      retweetCount: Number.parseInt(String(tweet.retweet_count || "0"), 10) || 0,
      retweeted,
      mentions,
      hashtags,
      urls,
      localMediaFiles,
    },
  };
}

function dmMessageToRow({ conversationId, message, source, maxTextChars, dmMediaIndex, group = false, identity }) {
  const messageCreate = message?.messageCreate;
  if (messageCreate && typeof messageCreate === "object") {
    const id = normalizeText(messageCreate.id || "");
    const senderId = normalizeText(messageCreate.senderId || "");
    const recipientId = normalizeText(messageCreate.recipientId || "");
    const senderLabel = labelAccount(senderId, identity);
    const recipientLabel = labelAccount(recipientId, identity);
    const text = clipText(normalizeText(messageCreate.text || ""), maxTextChars);
    const createdAt = parseTwitterDate(messageCreate.createdAt);
    const mediaUrls = safeArray(messageCreate.mediaUrls).map((entry) => normalizeText(entry)).filter(Boolean);
    const urls = safeArray(messageCreate.urls).map((entry) => normalizeText(entry?.url || entry?.expanded || entry)).filter(Boolean);
    const reactions = safeArray(messageCreate.reactions);
    const localMediaFiles = id ? (dmMediaIndex.get(id) || []).slice(0, 16) : [];

    const content = [
      group ? "Twitter group DM message." : "Twitter DM message.",
      createdAt ? `Created: ${createdAt}.` : "",
      `Conversation: ${conversationId}.`,
      senderLabel ? `From: ${senderLabel}.` : senderId ? `From: user:${senderId}.` : "",
      recipientLabel ? `To: ${recipientLabel}.` : recipientId ? `To: user:${recipientId}.` : "",
      text ? `Text: ${text}` : "(no text)",
      mediaUrls.length > 0 ? `Media URLs: ${mediaUrls.join(", ")}.` : "",
      localMediaFiles.length > 0 ? `Local media files: ${localMediaFiles.join(", ")}.` : "",
      urls.length > 0 ? `URLs: ${urls.join(", ")}.` : "",
      reactions.length > 0 ? `Reactions: ${JSON.stringify(reactions)}.` : "",
    ].filter(Boolean).join(" ");

    return {
      unitType: "message",
      occurredAt: createdAt || undefined,
      content,
      source,
      tags: ["twitter", "dm", group ? "group" : "direct"],
      clientRequestId: `twitter-dm-${stableHash(`${conversationId}|${id}|${senderId}|${recipientId}|${text}`, 20)}`,
      metadata: {
        type: group ? "twitter_group_dm_message" : "twitter_dm_message",
        twitterKind: "dm_message",
        visibility: "private",
        endorsementWeight: 0,
        affinityWeight: 0,
        sensitivity: "sensitive",
        participants: [senderLabel || `user:${senderId}`, recipientLabel || `user:${recipientId}`].filter(Boolean),
        conversationId,
        messageId: id || null,
        senderId: senderId || null,
        senderLabel: senderLabel || null,
        recipientId: recipientId || null,
        recipientLabel: recipientLabel || null,
        createdAt: createdAt || null,
        text,
        mediaUrls,
        localMediaFiles,
        urls,
        reactions,
      },
    };
  }

  const eventName = Object.keys(message || {}).find((key) => message[key] && typeof message[key] === "object");
  if (!eventName) return null;
  const payload = message[eventName];
  const createdAt = parseTwitterDate(payload?.createdAt || "");
  const participantIds = safeArray(payload?.userIds || payload?.participantsSnapshot).map((item) => normalizeText(item)).filter(Boolean);
  const participants = participantIds.map((id) => labelAccount(id, identity) || `user:${id}`);
  const initiatingUserId = normalizeText(payload?.initiatingUserId || "");
  const initiatingUserLabel = labelAccount(initiatingUserId, identity) || (initiatingUserId ? `user:${initiatingUserId}` : "");
  const content = [
    group ? "Twitter group DM event." : "Twitter DM event.",
    `Conversation: ${conversationId}.`,
    `Event: ${eventName}.`,
    createdAt ? `Created: ${createdAt}.` : "",
    initiatingUserLabel ? `Initiator: ${initiatingUserLabel}.` : "",
    participants.length > 0 ? `Participants: ${participants.join(", ")}.` : "",
  ].filter(Boolean).join(" ");

  return {
    unitType: "message",
    occurredAt: createdAt || undefined,
    content,
    source,
    tags: ["twitter", "dm", "event", group ? "group" : "direct"],
    clientRequestId: `twitter-dm-event-${stableHash(`${conversationId}|${eventName}|${createdAt}|${participants.join(",")}`, 20)}`,
    metadata: {
      type: group ? "twitter_group_dm_event" : "twitter_dm_event",
      twitterKind: "dm_event",
      visibility: "private",
      endorsementWeight: 0,
      affinityWeight: 0,
      sensitivity: "sensitive",
      participants,
      conversationId,
      eventType: eventName,
      createdAt: createdAt || null,
      initiatingUserId: initiatingUserId || null,
      initiatingUserLabel: initiatingUserLabel || null,
      payload,
    },
  };
}

function likeToRow({ like, source, maxTextChars, identity }) {
  const tweetId = normalizeText(like?.tweetId || "");
  const fullText = clipText(normalizeText(like?.fullText || ""), maxTextChars);
  const expandedUrl = normalizeText(like?.expandedUrl || "");
  const inferred = parseTextEntities(fullText);
  const content = [
    "Twitter liked tweet export item.",
    tweetId ? `Tweet ID: ${tweetId}.` : "",
    fullText ? `Text: ${fullText}` : "(no text)",
    expandedUrl ? `URL: ${expandedUrl}.` : "",
  ].filter(Boolean).join(" ");

  return {
    unitType: "message",
    content,
    source,
    tags: ["twitter", "like"],
    clientRequestId: `twitter-like-${stableHash(`${tweetId}|${fullText}|${expandedUrl}`, 20)}`,
    metadata: {
      type: "twitter_like",
      twitterKind: "like",
      visibility: "public",
      endorsementWeight: 0,
      affinityWeight: 0.45,
      sensitivity: "normal",
      participants: [],
      ownerAccountId: identity.ownerId,
      ownerUsername: identity.ownerUsername,
      ownerLabel: identity.ownerUsername ? `@${identity.ownerUsername}` : identity.ownerDisplay,
      tweetId: tweetId || null,
      fullText,
      expandedUrl: expandedUrl || null,
      mentions: inferred.mentions,
      hashtags: inferred.hashtags,
    },
  };
}

function mediaSummaryRow({ source, category, files, identity }) {
  const count = files.length;
  const samples = files.slice(0, 20);
  const extensions = new Map();
  for (const fileName of files) {
    const dot = fileName.lastIndexOf(".");
    const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "none";
    extensions.set(ext, (extensions.get(ext) || 0) + 1);
  }
  const topExtensions = Array.from(extensions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, value]) => ({ ext, count: value }));

  return {
    unitType: "attachment",
    content: `Twitter media inventory ${category}: ${count} files. Top extensions: ${topExtensions.map((item) => `${item.ext}(${item.count})`).join(", ")}.`,
    source,
    tags: ["twitter", "media", "inventory", category],
    clientRequestId: `twitter-media-summary-${stableHash(`${category}|${count}|${samples.join("|")}`, 20)}`,
    metadata: {
      type: "twitter_media_inventory",
      twitterKind: "media_inventory",
      visibility: "public",
      endorsementWeight: 0,
      affinityWeight: 0,
      sensitivity: "normal",
      participants: [],
      ownerAccountId: identity.ownerId,
      ownerUsername: identity.ownerUsername,
      ownerLabel: identity.ownerUsername ? `@${identity.ownerUsername}` : identity.ownerDisplay,
      category,
      count,
      topExtensions,
      samples,
      attachmentCount: count,
      attachmentNames: samples,
      attachmentMimeTypes: topExtensions.map((item) => item.ext).filter(Boolean),
    },
  };
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputDir = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "input-dir",
      "./imports/zips-extracted/twitter-2022-11-05-ae20eb107636a73b2c164f5a827dd5896fc313b88cc28cdce7581ce5eb8ba2bb/data"
    )
  );
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "output",
      "./imports/zips-extracted/twitter-2022-11-05-ae20eb107636a73b2c164f5a827dd5896fc313b88cc28cdce7581ce5eb8ba2bb/twitter-memory-deep.jsonl"
    )
  );
  const source = readStringFlag(flags, "source", "social:twitter-export");
  const includeLikes = readBoolFlag(flags, "include-likes", true);
  const includeMediaSummary = readBoolFlag(flags, "include-media-summary", true);
  const maxTextChars = readNumberFlag(flags, "max-text-chars", 2200, { min: 200, max: 200000 });
  const printJson = readBoolFlag(flags, "json", false);

  const identity = loadTwitterIdentityMaps(inputDir);

  const tweetMediaFiles = listMediaFiles(resolve(inputDir, "tweets_media"));
  const deletedTweetMediaFiles = listMediaFiles(resolve(inputDir, "deleted_tweets_media"));
  const dmMediaFiles = listMediaFiles(resolve(inputDir, "direct_messages_media"));
  const groupDmMediaFiles = listMediaFiles(resolve(inputDir, "direct_messages_group_media"));
  const communityTweetMediaFiles = listMediaFiles(resolve(inputDir, "community_tweet_media"));
  const momentsMediaFiles = listMediaFiles(resolve(inputDir, "moments_media"));
  const momentsTweetsMediaFiles = listMediaFiles(resolve(inputDir, "moments_tweets_media"));
  const twitterCircleTweetMediaFiles = listMediaFiles(resolve(inputDir, "twitter_circle_tweet_media"));
  const profileMediaFiles = listMediaFiles(resolve(inputDir, "profile_media"));

  const tweetMediaIndex = buildMediaIndex([...tweetMediaFiles, ...deletedTweetMediaFiles, ...communityTweetMediaFiles]);
  const dmMediaIndex = buildMediaIndex([...dmMediaFiles, ...groupDmMediaFiles]);

  const tweetsRaw = parseYtdArray(resolve(inputDir, "tweets.js"));
  const deletedTweetsRaw = parseYtdArray(resolve(inputDir, "deleted-tweets.js"));
  const dmsRaw = parseYtdArray(resolve(inputDir, "direct-messages.js"));
  const groupDmsRaw = parseYtdArray(resolve(inputDir, "direct-messages-group.js"));
  const likesRaw = includeLikes ? parseYtdArray(resolve(inputDir, "like.js")) : [];

  const rows = [];
  let tweetRows = 0;
  let deletedTweetRows = 0;
  let dmRows = 0;
  let groupDmRows = 0;
  let likeRows = 0;
  let eventRows = 0;

  for (const item of tweetsRaw) {
    const tweet = item?.tweet;
    if (!tweet || typeof tweet !== "object") continue;
    rows.push(tweetToRow({ tweet, source, maxTextChars, tweetMediaIndex, deleted: false, identity }));
    tweetRows += 1;
  }

  for (const item of deletedTweetsRaw) {
    const tweet = item?.tweet;
    if (!tweet || typeof tweet !== "object") continue;
    rows.push(tweetToRow({ tweet, source, maxTextChars, tweetMediaIndex, deleted: true, identity }));
    deletedTweetRows += 1;
  }

  for (const convo of dmsRaw) {
    const conversationId = normalizeText(convo?.dmConversation?.conversationId || "");
    const messages = safeArray(convo?.dmConversation?.messages);
    for (const message of messages) {
      const row = dmMessageToRow({ conversationId, message, source, maxTextChars, dmMediaIndex, group: false, identity });
      if (!row) continue;
      rows.push(row);
      if (row.metadata?.type === "twitter_dm_message") dmRows += 1;
      else eventRows += 1;
    }
  }

  for (const convo of groupDmsRaw) {
    const conversationId = normalizeText(convo?.dmConversation?.conversationId || "");
    const messages = safeArray(convo?.dmConversation?.messages);
    for (const message of messages) {
      const row = dmMessageToRow({ conversationId, message, source, maxTextChars, dmMediaIndex, group: true, identity });
      if (!row) continue;
      rows.push(row);
      if (row.metadata?.type === "twitter_group_dm_message") groupDmRows += 1;
      else eventRows += 1;
    }
  }

  for (const item of likesRaw) {
    const like = item?.like;
    if (!like || typeof like !== "object") continue;
    rows.push(likeToRow({ like, source, maxTextChars, identity }));
    likeRows += 1;
  }

  if (includeMediaSummary) {
    const mediaBuckets = [
      ["tweets_media", tweetMediaFiles],
      ["deleted_tweets_media", deletedTweetMediaFiles],
      ["direct_messages_media", dmMediaFiles],
      ["direct_messages_group_media", groupDmMediaFiles],
      ["community_tweet_media", communityTweetMediaFiles],
      ["moments_media", momentsMediaFiles],
      ["moments_tweets_media", momentsTweetsMediaFiles],
      ["twitter_circle_tweet_media", twitterCircleTweetMediaFiles],
      ["profile_media", profileMediaFiles],
    ];
    for (const [category, files] of mediaBuckets) {
      rows.push(mediaSummaryRow({ source, category, files, identity }));
    }
  }

  writeRows(outputPath, rows);

  const summary = {
    schema: "twitter-export-memory-normalize-report.v1",
    generatedAt: isoNow(),
    inputDir,
    outputPath,
    source,
    identity: {
      ownerId: identity.ownerId,
      ownerUsername: identity.ownerUsername,
      ownerDisplay: identity.ownerDisplay,
      ownerLocation: identity.ownerLocation,
    },
    options: {
      includeLikes,
      includeMediaSummary,
      maxTextChars,
    },
    totals: {
      rows: rows.length,
      tweetRows,
      deletedTweetRows,
      dmRows,
      groupDmRows,
      dmEventRows: eventRows,
      likeRows,
      mediaSummaryRows: includeMediaSummary ? 9 : 0,
      rawFiles: {
        tweets: tweetsRaw.length,
        deletedTweets: deletedTweetsRaw.length,
        dmConversations: dmsRaw.length,
        groupDmConversations: groupDmsRaw.length,
        likes: likesRaw.length,
      },
      mediaFiles: {
        tweets_media: tweetMediaFiles.length,
        deleted_tweets_media: deletedTweetMediaFiles.length,
        direct_messages_media: dmMediaFiles.length,
        direct_messages_group_media: groupDmMediaFiles.length,
        community_tweet_media: communityTweetMediaFiles.length,
        moments_media: momentsMediaFiles.length,
        moments_tweets_media: momentsTweetsMediaFiles.length,
        twitter_circle_tweet_media: twitterCircleTweetMediaFiles.length,
        profile_media: profileMediaFiles.length,
      },
    },
  };

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write("twitter-export-memory-normalize complete\n");
  process.stdout.write(`input-dir: ${inputDir}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`rows: ${rows.length}\n`);
}

main();
