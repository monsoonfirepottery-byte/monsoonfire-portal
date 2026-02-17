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
const indexPath = path.join(docsPoliciesPath, "policies-index.json");
const outputPath = path.join(repoRoot, "website", "data", "policies.json");

const toEntry = (policy) => ({
  title: policy.title,
  body: `<p>${String(policy.summary || "").replace(/[<>&]/g, "")}</p>`,
  tags: policy.tags || [],
  status: policy.status,
  effectiveDate: policy.effectiveDate,
});

const main = async () => {
  const policyFiles = await readPolicyFiles(docsPoliciesPath, fs);
  const policies = [];

  for (const filePath of policyFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    const policy = parseFrontmatter(raw);
    const errors = validatePolicyFrontmatter(policy);
    if (errors.length) {
      throw new Error(
        `Validation failed for ${path.basename(filePath)}: ${errors.join("; ")}`
      );
    }
    policies.push({
      slug: policy.slug,
      title: policy.title,
      summary: policy.summary || "Policy summary unavailable.",
      status: policy.status || "draft",
      tags: policy.tags || [],
      effectiveDate: policy.effectiveDate,
      reviewDate: policy.reviewDate,
      owner: policy.owner,
      sourceUrl: policy.sourceUrl,
      agent: policy.agent || null,
    });
  }

  const indexPayload = {
    generatedAt: new Date().toISOString(),
    policies,
  };

  await fs.writeFile(indexPath, `${JSON.stringify(indexPayload, null, 2)}\n`, "utf8");

  const entries = policies.map(toEntry);
  await fs.writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${entries.length} policy summaries to ${outputPath}\n`);
  process.stdout.write(`Updated policy source index at ${indexPath}\n`);
};

main().catch((error) => {
  process.stderr.write(`Policy sync failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
