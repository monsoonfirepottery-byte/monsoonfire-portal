import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter,
  readPolicyFiles,
  validatePolicyFrontmatter,
} from "./policy-docs.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const docsPoliciesPath = path.join(repoRoot, "docs", "policies");

const printReport = (fileName, errors) => {
  process.stdout.write(`- ${fileName}\n`);
  for (const issue of errors) {
    const label = issue === "missing_or_invalid_frontmatter"
      ? "frontmatter not found or unreadable"
      : issue;
    process.stdout.write(`  - [ ] ${label}\n`);
  }
};

const main = async () => {
  const policyFiles = await readPolicyFiles(docsPoliciesPath, fs);
  let problemCount = 0;
  let policyCount = 0;

  for (const filePath of policyFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const policy = parseFrontmatter(raw);
    const errors = validatePolicyFrontmatter(policy);
    if (errors.length) {
      printReport(path.basename(filePath), errors);
      problemCount += errors.length;
    }
    policyCount += 1;
  }

  if (problemCount > 0) {
    process.stdout.write(
      `Policy lint found ${problemCount} issue(s) across ${policyCount} policy files.\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Policy lint passed for ${policyCount} policy files.\n`);
};

main().catch((error) => {
  process.stderr.write(`Policy lint failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
