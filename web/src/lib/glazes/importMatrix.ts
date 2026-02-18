import type { ComboKey, Glaze } from "./types";

type ParseResult = {
  glazes: Glaze[];
  comboKeys: ComboKey[];
  baseNames: string[];
  topNames: string[];
};

type CellLocation = {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;
  colLabel?: string;
};

function normalizeApostrophes(value: string) {
  return value.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeName(value: string) {
  return normalizeWhitespace(normalizeApostrophes(value));
}

function toSlug(value: string) {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCsvLike(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '"') {
      const nextChar = normalized[i + 1];
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t")) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!inQuotes && char === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows;
}

function trimTrailingEmptyRows(rows: string[][]) {
  let lastIndex = rows.length - 1;
  while (lastIndex >= 0) {
    const row = rows[lastIndex];
    const hasValue = row.some((cell) => normalizeWhitespace(cell) !== "");
    if (hasValue) break;
    lastIndex -= 1;
  }
  return rows.slice(0, lastIndex + 1);
}

function trimTrailingEmptyColumns(rows: string[][]) {
  let lastIndex = 0;
  rows.forEach((row) => {
    row.forEach((cell, idx) => {
      if (normalizeWhitespace(cell) !== "") {
        lastIndex = Math.max(lastIndex, idx);
      }
    });
  });
  return rows.map((row) => row.slice(0, lastIndex + 1));
}

function parseComboId(value: string, location: CellLocation): number {
  const trimmed = normalizeWhitespace(value);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `Combo ID must be an integer at row ${location.rowIndex + 1}, col ${
        location.colIndex + 1
      } (${location.rowLabel ?? "row"} / ${location.colLabel ?? "col"}).`
    );
  }
  return parsed;
}

function buildGlaze(glazeName: string): Glaze {
  const normalized = normalizeName(glazeName);
  return {
    id: toSlug(normalized) || `glaze-${Math.random().toString(16).slice(2)}`,
    name: normalized,
    family: "studio",
  };
}

export function importGlazeMatrix(raw: string): ParseResult {
  if (!raw || normalizeWhitespace(raw) === "") {
    throw new Error("Matrix input is empty.");
  }

  let rows = parseCsvLike(raw);
  rows = trimTrailingEmptyRows(rows);
  rows = trimTrailingEmptyColumns(rows);

  if (rows.length < 2) {
    throw new Error("Matrix must include a header row and at least one data row.");
  }

  const headerRow = rows[0].map((cell) => normalizeName(cell));
  if (headerRow.length < 2) {
    throw new Error("Header row must include base glaze names.");
  }

  const baseNames = headerRow.slice(1).filter((name) => name !== "");
  if (baseNames.length === 0) {
    throw new Error("No base glaze names found in header row.");
  }

  const glazeByName = new Map<string, Glaze>();
  const comboKeys: ComboKey[] = [];
  const seenIds = new Set<number>();
  const topNames: string[] = [];

  baseNames.forEach((base) => {
    if (!glazeByName.has(base)) {
      glazeByName.set(base, buildGlaze(base));
    }
  });

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowLabelRaw = normalizeName(row[0] ?? "");
    if (!rowLabelRaw) {
      const rowHasData = row.slice(1).some((cell) => normalizeWhitespace(cell) !== "");
      if (rowHasData) {
        throw new Error(`Missing top glaze name on row ${rowIndex + 1}.`);
      }
      continue;
    }

    if (!glazeByName.has(rowLabelRaw)) {
      glazeByName.set(rowLabelRaw, buildGlaze(rowLabelRaw));
      topNames.push(rowLabelRaw);
    }

    for (let colIndex = 1; colIndex <= baseNames.length; colIndex += 1) {
      const cell = row[colIndex];
      const colLabel = baseNames[colIndex - 1];
      if (normalizeWhitespace(cell ?? "") === "") {
        throw new Error(
          `Missing combo ID at row ${rowIndex + 1}, col ${colIndex + 1} (${rowLabelRaw} / ${colLabel}).`
        );
      }
      const comboId = parseComboId(cell ?? "", {
        rowIndex,
        colIndex,
        rowLabel: rowLabelRaw,
        colLabel,
      });
      if (seenIds.has(comboId)) {
        throw new Error(`Duplicate combo ID ${comboId} found at row ${rowIndex + 1}, col ${colIndex + 1}.`);
      }
      seenIds.add(comboId);
      comboKeys.push({
        id: comboId,
        baseGlazeId: glazeByName.get(colLabel)!.id,
        topGlazeId: glazeByName.get(rowLabelRaw)!.id,
      });
    }
  }

  return {
    glazes: Array.from(glazeByName.values()),
    comboKeys,
    baseNames,
    topNames,
  };
}
