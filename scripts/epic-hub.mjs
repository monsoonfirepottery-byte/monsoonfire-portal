#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TICKETS_DIR = resolve(ROOT, "tickets");
const AGENTIC_MANIFEST_VERSION = "1.0.0";

const args = process.argv.slice(2);
const outputJson = args.includes("--json");
const outputJsonl = args.includes("--jsonl");
const includeCompleted = args.includes("--include-completed");
const showOnlyEpic = parseEpicSelection(getArgValue(args, "--epic", null));
const ownerFilter = getArgValue(args, "--owner", null);
const command = getCommand(args);
const outputMarkdown = args.includes("--markdown");
const outputMarkdownPath = getArgValue(args, "--out", null);
const workLimit = parsePositiveIntArg(args, "--limit");
const generatedAt = new Date().toISOString();
const markdownOutPath = outputMarkdownPath || resolve(ROOT, "output", `epic-hub-${generatedAt.slice(0, 10)}-${generatedAt.slice(11, 19).replace(/:/g, "-")}.md`);
const EPIC_01_TO_08_PATH_PREFIX = "tickets/P1-EPIC-";
const EPIC_01_TO_08_MAX = 9;

if (!existsSync(TICKETS_DIR)) {
  fail(`Tickets folder not found at ${TICKETS_DIR}`);
}

const entries = readdirSync(TICKETS_DIR, { withFileTypes: true }).filter(
  (entry) => entry.isFile() && entry.name.endsWith(".md"),
);

const documents = entries
  .map((entry) => readDoc(resolve(TICKETS_DIR, entry.name)))
  .filter((doc) => doc && doc.type);

const epics = documents.filter((doc) => normalizeType(doc.type).toLowerCase() === "epic");
const ticketsByPath = new Map(documents.map((doc) => [doc.path, doc]));

for (const epic of epics) {
  epic.ownedTickets = listEpicTickets(epic, ticketsByPath);
}

const blockerEpicCatalog = epics
  .filter((epic) => isPriorityBlockerEpicPath(epic.path))
  .sort((a, b) => parseEpicNumber(a.path) - parseEpicNumber(b.path));
const blockerEpicOpen = blockerEpicCatalog.filter((epic) => !isEpicDone(epic));
const blockOthers = blockerEpicOpen.length > 0;

for (const epic of epics) {
  epic.blockedByEpic08 = Boolean(blockOthers && !isPriorityBlockerEpicPath(epic.path));
  epic.blockerEpicDependencies = blockOthers
    ? blockerEpicOpen.map((entry) => entry.path).sort((a, b) => a.localeCompare(b))
    : [];
}

const sortedEpics = epics
  .filter((epic) => showOnlyEpic.length === 0 || showOnlyEpic.some((candidate) => matchesEpicSelection(epic.path, candidate)))
  .sort(compareEpicPriority);

if (sortedEpics.length === 0) {
  fail("No matching epics found.");
}

if (command === "next") {
  const queue = buildNextQueue(sortedEpics);
  printResult({ command: "next", epics: sortedEpics, queue, includeCompleted, outputJson, outputJsonl });
  process.exit(0);
}

if (command === "list") {
  printResult({ command: "list", epics: sortedEpics, includeCompleted, outputJson, outputJsonl });
  process.exit(0);
}

if (command === "work") {
  const work = buildWorkPlan(sortedEpics, workLimit);
  printResult({ command: "work", epics: sortedEpics, queue: work, includeCompleted, outputJson, outputJsonl });
  process.exit(0);
}

if (command === "swarm") {
  const work = buildWorkPlan(sortedEpics, workLimit);
  printResult({ command: "swarm", epics: sortedEpics, queue: work, includeCompleted, outputJson, outputJsonl });
  process.exit(0);
}

if (command === "agentic") {
  const work = buildWorkPlan(sortedEpics, workLimit);
  printResult({ command: "agentic", epics: sortedEpics, queue: work, includeCompleted, outputJson, outputJsonl });
  process.exit(0);
}

if (command === "show") {
  const target = args.find((arg, index) => args[index - 1] === "show") || null;
  if (!target) {
    fail("show command requires an epic file path argument.");
  }
  const normalizedTarget = normalizeEpicArg(target);
  const selected = sortedEpics.find((epic) => epic.path === normalizedTarget || epic.file === normalizedTarget);
  if (!selected) {
    fail(`Epic not found: ${target}`);
  }
  printResult({
    command: "show",
    epics: [selected],
    includeCompleted,
    outputJson,
    outputJsonl,
    showEpicDetail: true,
  });
  process.exit(0);
}

if (!["status", "next", "list", "show", "work", "swarm", "agentic"].includes(command)) {
  fail(`Unknown command: ${command}. Try: status | next | list | show | work | swarm | agentic`);
}

printResult({ command: "status", epics: sortedEpics, includeCompleted, outputJson, outputJsonl });

function readDoc(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    return null;
  }

  return {
    file: filePath,
    path: `tickets/${filePath.slice(TICKETS_DIR.length + 1).replace(/\\/g, "/")}`,
    title: extractLine(content, /^#\s*(.+)$/m, "Untitled"),
    status: extractLine(content, /^Status:\s*(.+)$/m, "Unknown"),
    priority: extractLine(content, /^Priority:\s*(.+)$/m, "P3"),
    type: extractLine(content, /^Type:\s*(.+)$/m, "Ticket"),
    owner: extractLine(content, /^Owner:\s*(.+)$/m, ""),
    parentEpic: extractLine(content, /^Parent Epic:\s*(.+)$/m, ""),
    content,
  };
}

function listEpicTickets(epic, ticketIndex) {
  const lines = epic.content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s*Tickets\b/i.test(line));
  if (headingIndex < 0) {
    return [];
  }

  const ownedTickets = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/i.test(line)) {
      break;
    }
    const match = /^\s*-\s+`([^`]+\.md)`/.exec(line);
    if (!match) {
      continue;
    }

    const candidate = ensureRelativeTicketPath(match[1]);
    const ticket = ticketIndex.get(candidate) || null;
    ownedTickets.push({
      ref: candidate,
      title: ticket?.title || "Missing ticket",
      status: ticket?.status || "Missing",
      priority: ticket?.priority || "P3",
      statusNormalized: normalizeStatus(ticket?.status),
      owner: ticket?.owner || "",
      type: ticket?.type || "Ticket",
      path: candidate,
    });
  }

  return ownedTickets;
}

function buildNextQueue(epicList) {
  const queue = [];
  for (const epic of epicList) {
    if (epic.blockedByEpic08) {
      continue;
    }
    const next = findNextTicket(epic);
    if (next && (includeCompleted || !next.isDone)) {
      queue.push({
        epic: epic.path,
        epicTitle: epic.title,
        priority: epic.priority,
        ticket: next,
      });
    }
  }
  return queue.sort((a, b) => {
    const epicPriority = comparePriority(a.epic.priority, b.epic.priority);
    if (epicPriority !== 0) {
      return epicPriority;
    }
    return comparePriority(a.ticket.priority, b.ticket.priority);
  });
}

function findNextTicket(epic) {
  for (const ticket of epic.ownedTickets) {
    if (!includeCompleted && ticket.statusNormalized === "done") {
      continue;
    }
    return {
      ref: ticket.ref,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      isDone: ticket.statusNormalized === "done",
      isBlocked: ticket.statusNormalized === "blocked",
    };
  }
  return includeCompleted ? {
    ref: "n/a",
    title: "All tickets complete",
    status: "Completed",
    priority: "P3",
    isDone: true,
    isBlocked: false,
  } : null;
}

function printResult({ command, epics, includeCompleted: includeDone, outputJson, outputJsonl, showEpicDetail = false, queue = [] }) {
  if (outputJson) {
    const manifest = command === "agentic" ? buildAgenticManifest(queue) : null;
    const payload = {
      generatedAt,
      command,
      epics: epics.map((epic) => epicSummary(epic, includeDone)),
      queue,
      manifest: manifest ? manifest.tasks : null,
      agenticManifestVersion: manifest ? AGENTIC_MANIFEST_VERSION : null,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    writeMarkdownOutput(payload);
    return;
  }

  if (outputJsonl) {
    const summary = epics.map((epic) => epicSummary(epic, includeDone));
    const manifest = command === "agentic" ? buildAgenticManifest(queue) : null;
    process.stdout.write(`${JSON.stringify({
      kind: "meta",
      generatedAt,
      command,
      includeCompleted: includeDone,
      showEpicDetail,
      epics: summary.length,
      queueCount: queue.length,
    })}\n`);

    if (command === "next" || command === "work" || command === "swarm") {
      for (const item of queue) {
        process.stdout.write(`${JSON.stringify({ kind: "queue-item", command, ...item })}\n`);
      }
    } else if (command === "agentic" && manifest) {
      for (const task of manifest.tasks) {
        process.stdout.write(`${JSON.stringify({ kind: "agentic-task", command, ...task })}\n`);
      }
    } else {
      for (const item of summary) {
        process.stdout.write(`${JSON.stringify({ kind: "epic", ...item })}\n`);
      }
    }
    return;
  }

  if (command === "next") {
    console.log("Epic queue (next actionable ticket per epic)");
    if (queue.length === 0) {
      console.log("No open tickets found in selected epics.");
    } else {
      for (const item of queue) {
        const statusBadge = item.ticket.isDone ? "[done]" : item.ticket.isBlocked ? "[blocked]" : "[open]";
        console.log(`- ${item.epicTitle} (${item.epic})`);
        console.log(`  ${statusBadge} ${item.ticket.ref} — ${item.ticket.title}`);
        console.log(`  status: ${item.ticket.status}`);
      }
    }
  } else if (command === "work") {
    console.log("Work queue (open/blocked tickets across epics)");
    if (queue.length === 0) {
      console.log("No open tickets found in selected epics.");
    } else {
      for (const item of queue) {
        const statusBadge = item.ticket.statusNormalized === "done" ? "[done]" : item.ticket.statusNormalized === "blocked" ? "[blocked]" : "[open]";
        console.log(`- ${item.epicTitle} (${item.epic})`);
        if (item.blockedByEpic08) {
          console.log("  status: BLOCKED_BY_EPIC_01_TO_08");
        }
        console.log(`  ${statusBadge} ${item.ticket.ref} — ${item.ticket.title}`);
        console.log(`  status: ${item.ticket.status} | priority: ${item.epicPriority || item.epic?.priority || "P3"} / ${item.ticket.priority}`);
      }
    }
  } else if (command === "swarm") {
    const byOwner = new Map();
    for (const item of queue) {
      const owner = item.ticket.owner || "unassigned";
      if (!byOwner.has(owner)) {
        byOwner.set(owner, []);
      }
      byOwner.get(owner).push(item);
    }

    console.log("Swarm queue grouped by ticket owner");
    if (queue.length === 0) {
      console.log("No open tickets found in selected epics.");
    } else {
      for (const [owner, items] of byOwner) {
        console.log(`Owner: ${owner}`);
        for (const item of items) {
          const statusBadge = item.ticket.statusNormalized === "done" ? "[done]" : item.ticket.statusNormalized === "blocked" ? "[blocked]" : "[open]";
          console.log(`- ${item.epicTitle} (${item.epic})`);
          console.log(`  ${statusBadge} ${item.ticket.ref} — ${item.ticket.title}`);
          console.log(`  status: ${item.ticket.status} | priority: ${item.epicPriority || item.epic?.priority || "P3"} / ${item.ticket.priority}`);
        }
      }
    }
  } else if (command === "agentic") {
    const manifest = buildAgenticManifest(queue);
    const byOwner = new Map();
    for (const item of manifest.tasks) {
      const owner = item.owner || "unassigned";
      if (!byOwner.has(owner)) {
        byOwner.set(owner, []);
      }
      byOwner.get(owner).push(item);
    }

    console.log(`Agentic swarm manifest (v${AGENTIC_MANIFEST_VERSION})`);
    console.log(`Tasks: ${manifest.taskCount}`);
    if (manifest.tasks.length === 0) {
      console.log("No open tasks found in selected epics.");
    } else {
      for (const [owner, items] of byOwner) {
        console.log(`Owner: ${owner}`);
        for (const item of items) {
          const statusBadge = item.ticketStatusNormalized === "done"
            ? "[done]"
            : item.ticketStatusNormalized === "blocked"
              ? "[blocked]"
              : "[open]";
          console.log(`- ${statusBadge} ${item.ticketRef} — ${item.ticketTitle}`);
          console.log(`  epic: ${item.epicTitle} (${item.epic})`);
          if (item.acceptanceCriteria.length > 0) {
            console.log(`  acceptance: ${item.acceptanceCriteria.slice(0, 3).join(" | ")}`);
          }
          if (item.definitionOfDone.length > 0) {
            console.log(`  dod: ${item.definitionOfDone.slice(0, 2).join(" | ")}`);
          }
        }
      }
    }
  } else if (command === "list") {
    for (const epic of epics) {
      const summary = epicSummary(epic, includeDone);
      console.log(`${summary.title} (${summary.path})`);
      const blockerHint = summary.blockedByEpic08 ? " | blocked-by-epics-01-to-09" : "";
      console.log(`  status=${summary.status}, priority=${summary.priority}, open=${summary.open}, done=${summary.done}, blocked=${summary.blocked}${blockerHint}`);
    }
  } else {
    for (const epic of epics) {
      const summary = epicSummary(epic, includeDone);
      console.log(`${summary.title}`);
      console.log(`Path: ${summary.path}`);
      console.log(`Status: ${summary.status}`);
      console.log(`Priority: ${summary.priority}`);
      if (summary.blockedByEpic08) {
        console.log(`Blocked-by: ${summary.blockerEpicDependencies.join(", ") || "P1-EPIC-01 through P1-EPIC-09"}`);
      }
      console.log(`Progress: open ${summary.open} | blocked ${summary.blocked} | done ${summary.done}`);
      if (showEpicDetail) {
        const ticketList = summary.tickets;
        if (ticketList.length === 0) {
          console.log("Tickets: none");
        } else {
          console.log("Tickets:");
          for (const ticket of ticketList) {
            if (!includeDone && ticket.statusNormalized === "done") {
              continue;
            }
            const statusBadge = ticket.statusNormalized === "done" ? "[done]" : ticket.statusNormalized === "blocked" ? "[blocked]" : "[open]";
            console.log(`  ${statusBadge} ${ticket.ref} — ${ticket.title} (${ticket.status})`);
          }
        }
      }
      console.log("");
    }
  }

  const summaryPayload = {
    generatedAt,
    command,
    epics: epics.map((epic) => epicSummary(epic, includeDone)),
    queue,
  };
  writeMarkdownOutput(summaryPayload);
}

function buildAgenticManifest(queue) {
  const tasks = queue.map((item) => {
    const ticketContent = readTicketContent(item.ticket.ref);
    const acceptanceCriteria = extractSectionLines(ticketContent, /^##\s*Acceptance Criteria/i, 8);
    const definitionOfDone = extractSectionLines(ticketContent, /^##\s*Definition of Done/i, 8);
    const taskOutline = extractSectionLines(ticketContent, /^##\s*Tasks/i, 12);

    return {
      taskId: `${item.epic}::${item.ticket.ref}`,
      epic: item.epic,
      epicTitle: item.epicTitle,
      epicPriority: item.epicPriority,
      epicStatus: item.epicStatus,
      blockerDependencies: item.blockerDependencies || [],
      ticketRef: item.ticket.ref,
      ticketPath: item.ticket.ref,
      ticketTitle: item.ticket.title,
      ticketStatus: item.ticket.status,
      ticketStatusNormalized: item.ticket.statusNormalized || normalizeStatus(item.ticket.status),
      ticketPriority: item.ticket.priority,
      owner: item.owner || "unassigned",
      acceptanceCriteria,
      definitionOfDone,
      taskOutline,
      suggestedRunbook: [
        `node ./scripts/epic-hub.mjs show ${item.epic}`,
        `sed -n '1,240p' ${item.ticket.ref}`,
      ],
      runHints: [
        `Run task ordering: ${item.epicPriority || "P3"} / ${item.ticket.priority}`,
        "After implementation, update the ticket Status line in source control before handing back.",
      ],
    };
  });

  return {
    manifestVersion: AGENTIC_MANIFEST_VERSION,
    taskCount: tasks.length,
    tasks,
  };
}

function buildWorkPlan(epicList, limit = null) {
  const work = [];
  const normalizedOwnerFilter = normalizeOwner(ownerFilter);
  for (const epic of epicList) {
    if (epic.blockedByEpic08) {
      continue;
    }
    const { open, blocked } = classifyTickets(epic.ownedTickets);
    for (const ticket of open.concat(blocked)) {
      if (!includeCompleted && ticket.statusNormalized === "done") {
        continue;
      }
      if (normalizedOwnerFilter && !normalizeOwner(ticket.owner || "").includes(normalizedOwnerFilter)) {
        continue;
      }
      work.push({
        epic: epic.path,
        epicTitle: epic.title,
        epicPriority: epic.priority,
        epicStatus: epic.status,
        blockerDependencies: epic.blockerEpicDependencies || [],
        blockedByEpic08: epic.blockedByEpic08,
        owner: ticket.owner || "",
        ticket,
      });
    }
  }

  const sorted = work.sort((a, b) => {
    const epicPriority = comparePriority(a.epicPriority, b.epicPriority);
    if (epicPriority !== 0) {
      return epicPriority;
    }
    const ticketPriority = comparePriority(a.ticket.priority, b.ticket.priority);
    if (ticketPriority !== 0) {
      return ticketPriority;
    }
    return a.ticket.ref.localeCompare(b.ticket.ref);
  });

  if (Number.isInteger(limit) && limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

function writeMarkdownOutput(payload) {
  if (!outputMarkdown) {
    return;
  }

  const header = `# Epic Hub Report`;
  const lines = [];
  lines.push(header);
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push(`Command: ${payload.command}`);
  lines.push("");

  if (payload.command === "next" || payload.command === "work" || payload.command === "swarm" || payload.command === "agentic") {
    if (payload.queue.length === 0) {
      lines.push("No actionable items found.");
    } else {
      lines.push("## Work Queue");
      lines.push("");
      if (payload.command === "agentic") {
        lines.push(`### Agentic manifest (v${AGENTIC_MANIFEST_VERSION})`);
        const byOwner = new Map();
        for (const item of payload.manifest || []) {
          const owner = item.owner || "unassigned";
          if (!byOwner.has(owner)) {
            byOwner.set(owner, []);
          }
          byOwner.get(owner).push(item);
        }
        for (const [owner, items] of byOwner) {
          lines.push(`### Owner: ${owner}`);
          for (const item of items) {
            lines.push(`- ${item.ticketRef}`);
            lines.push(`  - Epic: ${item.epicTitle} (${item.epic})`);
            lines.push(`  - Title: ${item.ticketTitle}`);
            lines.push(`  - Status: ${item.ticketStatus}`);
            lines.push(`  - Priority: ${item.epicPriority} / ${item.ticketPriority}`);
            if (item.acceptanceCriteria.length > 0) {
              lines.push(`  - Acceptance: ${item.acceptanceCriteria.slice(0, 3).join(" | ")}`);
            }
          }
        }
      } else if (payload.command === "swarm") {
        const byOwner = new Map();
        for (const item of payload.queue) {
          const owner = item.owner || "unassigned";
          if (!byOwner.has(owner)) {
            byOwner.set(owner, []);
          }
          byOwner.get(owner).push(item);
        }
        for (const [owner, items] of byOwner) {
          lines.push(`### Owner: ${owner}`);
          for (const item of items) {
            lines.push(`- ${item.ticket.ref}`);
            lines.push(`  - Epic: ${item.epicTitle} (${item.epic})`);
            lines.push(`  - Title: ${item.ticket.title}`);
            lines.push(`  - Status: ${item.ticket.status}`);
            lines.push(`  - Priority: ${item.epicPriority} / ${item.ticket.priority}`);
          }
        }
      } else {
        const typeLabel = payload.command === "work" ? "Task" : "Next";
        for (const item of payload.queue) {
          if (payload.command === "work") {
            lines.push(`- ${typeLabel}: ${item.ticket.ref}`);
            lines.push(`  - Epic: ${item.epicTitle} (${item.epic})`);
            lines.push(`  - Title: ${item.ticket.title}`);
            lines.push(`  - Status: ${item.ticket.status}`);
            lines.push(`  - Priority: ${item.epicPriority} / ${item.ticket.priority}`);
          } else {
            lines.push(`- ${item.epicTitle} (${item.epic})`);
            lines.push(`  - ${item.ticket.ref} — ${item.ticket.title} (${item.ticket.status})`);
          }
        }
      }
    }
  } else {
    lines.push("## Epic Summary");
    lines.push("");
    for (const epic of payload.epics) {
      lines.push(`- ${epic.title}`);
      lines.push(`  - Path: ${epic.path}`);
      lines.push(`  - Status: ${epic.status} | Priority: ${epic.priority}`);
      lines.push(`  - Open: ${epic.open}, Blocked: ${epic.blocked}, Done: ${epic.done}`);
    }
  }

  mkdirSync(dirname(markdownOutPath), { recursive: true });
  writeFileSync(markdownOutPath, `${lines.join("\n")}\n`);
}

function epicSummary(epic, includeDone) {
  const buckets = classifyTickets(epic.ownedTickets);
  const openCount = buckets.open.length;
  const doneCount = buckets.done.length;
  const blockedCount = buckets.blocked.length;
  const total = epic.ownedTickets.length;
  return {
    path: epic.path,
    title: epic.title,
    status: epic.status,
    priority: epic.priority,
    open: openCount,
    done: doneCount,
    blocked: blockedCount,
    total,
    blockedByEpic08: Boolean(epic.blockedByEpic08),
    blockerEpicDependencies: epic.blockerEpicDependencies || [],
    tickets: includeDone ? epic.ownedTickets : [...buckets.open, ...buckets.blocked],
  };
}

function classifyTickets(tickets) {
  const buckets = {
    open: [],
    blocked: [],
    done: [],
  };
  for (const ticket of tickets) {
    const normalized = normalizeStatus(ticket.status);
    if (normalized === "done") {
      buckets.done.push(ticket);
    } else if (normalized === "blocked") {
      buckets.blocked.push(ticket);
    } else {
      buckets.open.push(ticket);
    }
  }
  return buckets;
}

function normalizeStatus(raw = "Unknown") {
  const value = String(raw || "Unknown").toLowerCase();
  if (value.includes("complete") || value.includes("done")) {
    return "done";
  }
  if (value.includes("blocked") || value.includes("hold") || value.includes("blocked(s)")) {
    return "blocked";
  }
  return "open";
}

function normalizeType(raw = "") {
  return String(raw).trim();
}

function compareEpicPriority(a, b) {
  const priorityA = parsePriority(a.priority);
  const priorityB = parsePriority(b.priority);
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }
  const aBlocker = isPriorityBlockerEpicPath(a.path);
  const bBlocker = isPriorityBlockerEpicPath(b.path);
  if (aBlocker && !bBlocker) {
    return -1;
  }
  if (!aBlocker && bBlocker) {
    return 1;
  }
  if (aBlocker && bBlocker) {
    return parseEpicNumber(a.path) - parseEpicNumber(b.path);
  }
  if (a.status === "In Progress" && b.status !== "In Progress") {
    return -1;
  }
  if (a.status !== "In Progress" && b.status === "In Progress") {
    return 1;
  }
  return a.title.localeCompare(b.title);
}

function comparePriority(a, b) {
  return parsePriority(a) - parsePriority(b);
}

function parsePriority(value = "P3") {
  const match = String(value).match(/P(\d)/i);
  if (!match) {
    return 99;
  }
  return Number.parseInt(match[1], 10);
}

function readTicketContent(ticketPath) {
  if (!ticketPath) {
    return "";
  }
  const resolved = resolve(ROOT, ticketPath);
  try {
    return readFileSync(resolved, "utf8");
  } catch {
    return "";
  }
}

function extractSectionLines(content, headingRegex, maxItems = 8) {
  if (!content) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRegex.test(line));
  if (start < 0) {
    return [];
  }

  const bullets = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^-\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const cleaned = trimmed.replace(/^[-\d\.\s]+/, "").trim();
      if (cleaned) {
        bullets.push(cleaned);
        if (bullets.length >= maxItems) {
          break;
        }
      }
    }
  }
  return bullets;
}

function isPriorityBlockerEpicPath(rawPath) {
  const match = parseEpicNumber(rawPath);
  if (!Number.isInteger(match)) {
    return false;
  }
  return rawPath.includes(EPIC_01_TO_08_PATH_PREFIX) && match <= EPIC_01_TO_08_MAX;
}

function parseEpicNumber(rawPath) {
  const match = rawPath.match(new RegExp(`^${escapeRegex(EPIC_01_TO_08_PATH_PREFIX)}(\\d+)`, "i"));
  if (!match || !match[1]) {
    return Number.NaN;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function parseEpicSelection(rawValue) {
  if (!rawValue) {
    return [];
  }
  const expanded = [];
  const seen = new Set();
  const rawEntries = String(rawValue).split(",");

  for (const rawEntry of rawEntries) {
    for (const token of expandEpicToken(rawEntry)) {
      const normalized = token.trim();
      if (!normalized || seen.has(normalized.toLowerCase())) {
        continue;
      }
      seen.add(normalized.toLowerCase());
      expanded.push(normalized);
    }
  }

  return expanded;
}

function expandEpicToken(rawEntry) {
  const normalized = String(rawEntry || "").trim().replace(/^tickets\//i, "");
  if (!normalized) {
    return [];
  }

  const rangeMatch = normalized.match(/^p?\s*(\d+)\s*-\s*p?\s*(\d+)$/i);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end > 0) {
      const lower = Math.min(start, end);
      const upper = Math.max(start, end);
      const rangeEntries = [];
      for (let index = lower; index <= upper; index += 1) {
        rangeEntries.push(`P1-EPIC-${index.toString().padStart(2, "0")}`);
      }
      return rangeEntries;
    }
  }

  const singleMatch = normalized.match(/^p?\s*(\d+)$/i);
  if (singleMatch && singleMatch[1]) {
    const index = Number.parseInt(singleMatch[1], 10);
    if (Number.isInteger(index) && index > 0) {
      return [`P1-EPIC-${index.toString().padStart(2, "0")}`];
    }
  }

  return [normalized];
}

function matchesEpicSelection(epicPath, rawCandidate) {
  const candidate = normalizeEpicCandidate(rawCandidate);
  if (!candidate) {
    return false;
  }
  const normalizedEpicPath = epicPath.toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();

  if (normalizedEpicPath === normalizedCandidate) {
    return true;
  }

  if (normalizedEpicPath === `tickets/${normalizedCandidate}` || normalizedEpicPath === `tickets/${normalizedCandidate}.md`) {
    return true;
  }

  const trimmedCandidate = normalizedCandidate.endsWith(".md") ? normalizedCandidate.slice(0, -3) : normalizedCandidate;
  if (normalizedEpicPath === `tickets/${trimmedCandidate}` || normalizedEpicPath === `tickets/${trimmedCandidate}.md`) {
    return true;
  }

  if (normalizedEpicPath.startsWith(`tickets/${trimmedCandidate}-`) || normalizedEpicPath.includes(`/${trimmedCandidate}-`)) {
    return true;
  }

  return false;
}

function normalizeEpicCandidate(rawCandidate) {
  const trimmed = String(rawCandidate || "").trim();
  if (!trimmed) {
    return "";
  }
  const withoutPrefix = trimmed.replace(/^tickets\//i, "").replace(/\.md$/i, "").trim();
  if (!withoutPrefix) {
    return "";
  }
  return withoutPrefix;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEpicDone(epic) {
  const { open, blocked, done } = classifyTickets(epic.ownedTickets || []);
  const total = epic.ownedTickets ? epic.ownedTickets.length : 0;
  return total === 0 ? true : open.length === 0 && blocked.length === 0;
}

function parsePositiveIntArg(args, name) {
  const raw = getArgValue(args, name, null);
  if (raw === null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function extractLine(content, regex, fallback) {
  const result = content.match(regex);
  return result ? result[1].trim() : fallback;
}

function ensureRelativeTicketPath(rawPath) {
  const trimmed = rawPath.replace(/`/g, "").trim();
  if (trimmed.startsWith("tickets/")) {
    return trimmed;
  }
  return `tickets/${trimmed}`;
}

function normalizeEpicArg(value) {
  return value.includes(".md") ? value : `tickets/${value}.md`;
}

function normalizeOwner(value) {
  if (!value) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function getArgValue(args, name, fallback) {
  const index = args.findIndex((arg) => arg === name);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }
  return fallback;
}

function getCommand(args) {
  const consumesNext = new Set(["--epic", "--limit", "--out", "--owner"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (consumesNext.has(arg)) {
        index += 1;
      }
      continue;
    }
    return arg;
  }
  return "status";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
