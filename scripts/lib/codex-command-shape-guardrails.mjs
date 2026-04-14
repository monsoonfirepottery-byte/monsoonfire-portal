function clean(value) {
  return String(value ?? "").trim();
}

function readFlagValues(command, flags) {
  const escapedFlags = flags.map((flag) => flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`(?:^|\\s)(?:${escapedFlags})\\s+(?:\"([^\"]*)\"|'([^']*)'|(\\S+))`, "gi");
  const values = [];
  let match = pattern.exec(command);
  while (match) {
    values.push(clean(match[1] || match[2] || match[3]));
    match = pattern.exec(command);
  }
  return values.filter(Boolean);
}

function hasFlag(command, flags) {
  return readFlagValues(command, flags).length > 0;
}

function buildFinding(id, message, suggestion) {
  return {
    id,
    severity: "warn",
    message,
    suggestion,
  };
}

export function recommendedWindowsCommandPatterns() {
  return [
    {
      area: "ripgrep search roots",
      safePattern: 'rg -n "startup" scripts',
    },
    {
      area: "ripgrep globs",
      safePattern: 'rg -n --glob "scripts/*.mjs" "startup" .',
    },
    {
      area: "PowerShell JSON reads",
      safePattern: "Get-Content -Raw .codex/toolcalls.ndjson | ConvertFrom-Json",
    },
    {
      area: "file read",
      safePattern: "Get-Content -Path scripts/codex-startup-preflight.mjs -TotalCount 40",
    },
    {
      area: "inline ESM evaluation",
      safePattern: 'node --input-type=module -e "import fs from \\"node:fs\\"; console.log(fs.existsSync(\\"package.json\\"))"',
    },
    {
      area: "long-running process checks",
      safePattern: "Get-Process node,pwsh -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path",
    },
    {
      area: "npm/npx execution",
      safePattern: "npm.cmd run codex:doctor",
    },
  ];
}

export function auditWindowsCommandShape(command) {
  const source = clean(command);
  if (!source) return [];

  const findings = [];
  const addFinding = (finding) => {
    if (!findings.some((entry) => entry.id === finding.id)) {
      findings.push(finding);
    }
  };

  if (/\brg(?:\.exe)?\b/i.test(source) && hasFlag(source, ["-g", "--glob"])) {
    for (const globValue of readFlagValues(source, ["-g", "--glob"])) {
      if (globValue.includes("\\")) {
        addFinding(
          buildFinding(
            "rg-glob-backslashes",
            "ripgrep glob filters are slash-based even on Windows, so backslashes in `-g/--glob` usually misfire.",
            'Rewrite the glob with `/`, for example `rg -n --glob "scripts/*.mjs" "startup" .`.'
          )
        );
      }
      if ((/^[A-Za-z]:[\\/]/.test(globValue) || /^\.{0,2}[\\/]/.test(globValue)) && !/[*?[{\]]/.test(globValue)) {
        addFinding(
          buildFinding(
            "rg-glob-path-like",
            "This `-g/--glob` value looks like a filesystem path, not a glob filter.",
            'Pass the search root as a trailing path argument, for example `rg -n "startup" scripts`, and reserve `--glob` for include/exclude patterns.'
          )
        );
      }
    }
  }

  if (
    /\bnode(?:\.exe)?\b/i.test(source) &&
    /\s-e(?:val)?\s+/i.test(source) &&
    /\bimport\s+[\w*{]/.test(source) &&
    !/(?:^|\s)--input-type(?:=|\s+)module\b/i.test(source)
  ) {
    addFinding(
      buildFinding(
        "node-e-import-without-module",
        "`node -e` with ESM `import` will fail unless module mode is enabled.",
        'Use `node --input-type=module -e "import ..."` or move the snippet into a `.mjs` file.'
      )
    );
  }

  if (
    /\b(?:Get-Content|gc)\b/i.test(source) &&
    /\|\s*ConvertFrom-Json\b/i.test(source) &&
    !/\b(?:Get-Content|gc)\b[^\r\n|]*\s-Raw\b/i.test(source)
  ) {
    addFinding(
      buildFinding(
        "get-content-json-without-raw",
        "`Get-Content` without `-Raw` streams an array of lines, which commonly breaks JSON parsing and produces empty-output retries.",
        "Use `Get-Content -Raw <path> | ConvertFrom-Json` when the target is JSON."
      )
    );
  }

  return findings;
}
