#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TICKETS_DIR = resolve(ROOT, "tickets");
const ENGINEERING_TODOS_PATH = resolve(ROOT, "docs/ENGINEERING_TODOS.md");
const SWARM_BOARD_PATH = resolve(ROOT, "docs/sprints/SWARM_BOARD.md");

const args = new Set(process.argv.slice(2));
const outputMarkdown = args.has("--markdown");
const outputJson = args.has("--json");
const outPath = getArgValue(process.argv.slice(2), "--out");
const generatedAt = new Date().toISOString();

const ticketDocs = loadTopLevelTicketDocs();
const ticketIndex = new Map(ticketDocs.map((row) => [row.path, row]));
const epicIndex = new Map(
  ticketDocs
    .filter((row) => row.typeNormalized === "epic")
    .map((row) => [row.path, row]),
);

const unresolvedTodos = collectUnresolvedTodos(readFileSync(ENGINEERING_TODOS_PATH, "utf8"));
const boardRows = collectBoardRows(readFileSync(SWARM_BOARD_PATH, "utf8"));

const report = buildReport({
  generatedAt,
  unresolvedTodos,
  boardRows,
  ticketIndex,
  epicIndex,
});

if (outputJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (outputMarkdown) {
  const markdown = renderMarkdown(report);
  const destination = outPath || resolve(ROOT, "docs/sprints/EPIC_06_BACKLOG_AUDIT_2026-02-22.md");
  writeFileSync(destination, markdown, "utf8");
  process.stdout.write(`[backlog-hygiene-audit] wrote ${destination}\n`);
}

if (!outputJson && !outputMarkdown) {
  process.stdout.write(renderSummary(report));
}

function getArgValue(argv, key) {
  const index = argv.indexOf(key);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function loadTopLevelTicketDocs() {
  const files = readDirTicketFiles(TICKETS_DIR);
  const docs = [];
  for (const fullPath of files) {
    const text = readFileSync(fullPath, "utf8");
    const relative = fullPath.slice(TICKETS_DIR.length + 1).replaceAll("\\", "/");
    docs.push({
      path: `tickets/${relative}`,
      file: relative,
      status: matchLine(text, /^Status:\s*(.+)$/m, "Unknown"),
      statusNormalized: normalizeStatus(matchLine(text, /^Status:\s*(.+)$/m, "Unknown")),
      type: matchLine(text, /^Type:\s*(.+)$/m, "Ticket"),
      typeNormalized: normalizeType(matchLine(text, /^Type:\s*(.+)$/m, "Ticket")),
      priority: matchLine(text, /^Priority:\s*(.+)$/m, ""),
      owner: matchLine(text, /^Owner:\s*(.+)$/m, ""),
      parentEpic: matchLine(text, /^Parent Epic:\s*(.+)$/m, ""),
      title:
        matchLine(text, /^#\s*(.+)$/m, "").trim() || relative,
    });
  }
  return docs;
}

function readDirTicketFiles(dirPath) {
  const out = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md") continue;
    out.push(resolve(dirPath, entry.name));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function matchLine(text, pattern, fallback = "") {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? fallback;
}

function normalizeType(type) {
  return String(type || "").trim().toLowerCase();
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["completed", "closed", "done"].includes(value)) return "done";
  if (value === "in progress" || value === "in_progress") return "in_progress";
  if (value === "on hold" || value === "on_hold") return "on_hold";
  if (value === "to do") return "todo";
  return value || "unknown";
}

function isActiveStatus(statusNormalized) {
  return ["planned", "open", "in_progress", "blocked", "todo", "on_hold"].includes(statusNormalized);
}

function collectUnresolvedTodos(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const todoMatch = line.match(/^\s*-\s+\[\s\]\s+(.+)$/);
    if (!todoMatch) continue;

    let mappedTicket = null;
    for (let lookAhead = 1; lookAhead <= 4; lookAhead += 1) {
      const nextLine = lines[index + lookAhead] || "";
      const ticketMatch = nextLine.match(/Ticket:\s*`(tickets\/[^`]+\.md)`/);
      if (!ticketMatch) continue;
      mappedTicket = ticketMatch[1];
      break;
    }
    rows.push({
      line: index + 1,
      text: todoMatch[1].trim(),
      mappedTicket,
    });
  }
  return rows;
}

function collectBoardRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let inOpenSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+Open Tickets\b/i.test(line)) {
      inOpenSection = true;
      continue;
    }
    if (inOpenSection && /^##\s+/.test(line)) {
      break;
    }
    if (!inOpenSection) continue;
    if (!line.includes("tickets/")) continue;

    const ticketMatch = line.match(/`(tickets\/[^`]+\.md)`/);
    if (!ticketMatch) continue;
    const boardStatus = line.match(/\(`([^`]+)`\)/)?.[1]?.trim().toLowerCase() ?? "";
    rows.push({
      line: index + 1,
      raw: line.trim(),
      ticketPath: ticketMatch[1],
      boardStatus: boardStatus || "unknown",
    });
  }
  return rows;
}

function buildReport(input) {
  const todoRows = input.unresolvedTodos.map((row) => {
    const ticket = row.mappedTicket ? input.ticketIndex.get(row.mappedTicket) : null;
    return {
      ...row,
      ticketExists: Boolean(ticket),
      ticketStatus: ticket?.status ?? null,
      owner: ticket?.owner ?? null,
      inScope: ticket ? !isExcludedTicket(ticket, input.epicIndex).excluded : false,
    };
  });

  const boardRows = input.boardRows.map((row) => {
    const ticket = input.ticketIndex.get(row.ticketPath) || null;
    const excluded = ticket ? isExcludedTicket(ticket, input.epicIndex) : { excluded: false, reason: null };
    const ticketStatus = ticket?.statusNormalized ?? "missing";
    const boardStatus = normalizeStatus(row.boardStatus);
    return {
      ...row,
      ticketExists: Boolean(ticket),
      ticketStatus: ticket?.status ?? "Missing",
      ticketStatusNormalized: ticketStatus,
      parentEpic: ticket?.parentEpic || null,
      excluded: excluded.excluded,
      excludedReason: excluded.reason,
      statusDrift: ticket ? boardStatus !== ticketStatus : true,
    };
  });

  const inScopeBoardRows = boardRows.filter((row) => row.ticketExists && !row.excluded);
  const excludedBoardRows = boardRows.filter((row) => row.excluded);
  const missingBoardTickets = boardRows.filter((row) => !row.ticketExists);
  const boardDriftRows = boardRows.filter((row) => row.ticketExists && row.statusDrift);
  const unresolvedWithoutTicket = todoRows.filter((row) => !row.mappedTicket || !row.ticketExists);

  return {
    generatedAt: input.generatedAt,
    filters: {
      ignoreClosedEpicChildren: true,
      ignoreEpic10And11: true,
    },
    todoAudit: {
      unresolvedCount: todoRows.length,
      unresolvedWithoutTicketCount: unresolvedWithoutTicket.length,
      rows: todoRows,
    },
    boardAudit: {
      totalRows: boardRows.length,
      inScopeRows: inScopeBoardRows.length,
      excludedRows: excludedBoardRows.length,
      missingTicketRows: missingBoardTickets.length,
      statusDriftRows: boardDriftRows.length,
      rows: boardRows,
      inScopeRowsDetail: inScopeBoardRows,
      excludedRowsDetail: excludedBoardRows,
      missingRowsDetail: missingBoardTickets,
      driftRowsDetail: boardDriftRows,
    },
  };
}

function isExcludedTicket(ticket, epicIndex) {
  if (/^S1[01]-/i.test(ticket.file)) {
    return { excluded: true, reason: "SPRINT_10_11_TICKET" };
  }
  const parentPath = ticket.parentEpic || "";
  if (/EPIC-(10|11)\b/i.test(parentPath)) {
    return { excluded: true, reason: "EPIC_10_11_PARENT" };
  }
  if (!parentPath) return { excluded: false, reason: null };
  const parentDoc = epicIndex.get(parentPath);
  if (parentDoc && parentDoc.statusNormalized === "done") {
    return { excluded: true, reason: `CLOSED_PARENT_EPIC:${parentPath}` };
  }
  return { excluded: false, reason: null };
}

function renderSummary(report) {
  return [
    "Backlog Hygiene Audit",
    `generatedAt: ${report.generatedAt}`,
    `unresolved todos: ${report.todoAudit.unresolvedCount}`,
    `unresolved todos missing ticket: ${report.todoAudit.unresolvedWithoutTicketCount}`,
    `board rows: ${report.boardAudit.totalRows}`,
    `board rows in scope: ${report.boardAudit.inScopeRows}`,
    `board rows excluded: ${report.boardAudit.excludedRows}`,
    `board rows missing ticket: ${report.boardAudit.missingTicketRows}`,
    `board rows with status drift: ${report.boardAudit.statusDriftRows}`,
    "",
  ].join("\n");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Epic 06 Backlog Hygiene Audit");
  lines.push("");
  lines.push(`Date: ${report.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push("## Scope Filters");
  lines.push("- Ignore tickets associated with closed epics.");
  lines.push("- Ignore tickets associated with Epic 10 and Epic 11 scope.");
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Unresolved TODO entries in \`docs/ENGINEERING_TODOS.md\`: ${report.todoAudit.unresolvedCount}`);
  lines.push(`- Unresolved TODO entries without a valid ticket link: ${report.todoAudit.unresolvedWithoutTicketCount}`);
  lines.push(`- Open-board rows audited: ${report.boardAudit.totalRows}`);
  lines.push(`- In-scope board rows: ${report.boardAudit.inScopeRows}`);
  lines.push(`- Excluded board rows: ${report.boardAudit.excludedRows}`);
  lines.push(`- Board rows with ticket-status drift: ${report.boardAudit.statusDriftRows}`);
  lines.push("");

  lines.push("## In-Scope Board Rows");
  if (report.boardAudit.inScopeRowsDetail.length === 0) {
    lines.push("- None.");
  } else {
    for (const row of report.boardAudit.inScopeRowsDetail) {
      lines.push(
        `- ${row.ticketPath} | board=\`${row.boardStatus}\` | ticket=\`${row.ticketStatusNormalized}\``
      );
    }
  }
  lines.push("");

  lines.push("## Excluded Board Rows");
  if (report.boardAudit.excludedRowsDetail.length === 0) {
    lines.push("- None.");
  } else {
    for (const row of report.boardAudit.excludedRowsDetail) {
      lines.push(`- ${row.ticketPath} | reason=\`${row.excludedReason}\``);
    }
  }
  lines.push("");

  lines.push("## Board Status Drift");
  if (report.boardAudit.driftRowsDetail.length === 0) {
    lines.push("- None.");
  } else {
    for (const row of report.boardAudit.driftRowsDetail) {
      lines.push(
        `- ${row.ticketPath} | board=\`${row.boardStatus}\` | ticket=\`${row.ticketStatusNormalized}\``
      );
    }
  }
  lines.push("");

  lines.push("## TODO Audit Detail");
  if (report.todoAudit.rows.length === 0) {
    lines.push("- No unresolved TODO checkbox entries remain in `docs/ENGINEERING_TODOS.md`.");
  } else {
    for (const row of report.todoAudit.rows) {
      lines.push(
        `- line ${row.line}: ${row.text} | ticket=${row.mappedTicket ?? "none"} | exists=${row.ticketExists}`
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
