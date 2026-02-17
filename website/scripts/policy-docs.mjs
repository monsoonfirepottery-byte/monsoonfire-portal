import path from "node:path";

const parseScalar = (raw) => {
  const value = String(raw).trim();
  if (!value || value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value[0] === '"' || value[0] === "'") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

export const parseFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  let index = 0;

  const parseList = (indent) => {
    const list = [];
    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent < indent) {
        break;
      }
      if (!trimmed.startsWith("-")) {
        break;
      }

      const item = trimmed.replace(/^- /, "");
      index += 1;
      list.push(parseScalar(item));
    }

    return list;
  };

  const parseObject = (indent) => {
    const obj = {};

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      const currentIndent = line.length - line.trimStart().length;
      const trimmed = line.trim();
      if (currentIndent < indent) {
        break;
      }
      if (currentIndent > indent) {
        index += 1;
        continue;
      }

      const match = trimmed.match(/^([^:]+):\s*(.*)$/);
      if (!match) {
        index += 1;
        continue;
      }

      const [, key, rawValue] = match;
      const value = rawValue.trim();
      index += 1;

      if (value) {
        obj[key] = parseScalar(value);
        continue;
      }

      if (index >= lines.length) {
        obj[key] = [];
        continue;
      }

      const nextLine = lines[index] ?? "";
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed) {
        obj[key] = [];
        continue;
      }

      const nextIndent = nextLine.length - nextLine.trimStart().length;
      if (nextTrimmed.startsWith("-")) {
        obj[key] = parseList(nextIndent);
      } else {
        obj[key] = parseObject(nextIndent);
      }
    }

    return obj;
  };

  return parseObject(0);
};

export const readPolicyFiles = async (docsPoliciesPath, fs) => {
  const filenames = await fs.readdir(docsPoliciesPath);
  return filenames
    .filter((name) => /^[a-z][\w-]*\.md$/.test(name))
    .sort()
    .map((name) => path.join(docsPoliciesPath, name));
};

export const REQUIRED_POLICY_FIELDS = ["slug", "title", "status", "summary", "tags", "sourceUrl"];
export const REQUIRED_AGENT_FIELDS = [
  "canActForSelf",
  "canActForOthers",
  "decisionDomain",
  "defaultActions",
  "requiredSignals",
  "escalateWhen",
  "replyTemplate",
];

const isStringArray = (value) => {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  );
};

export const validatePolicyFrontmatter = (policy) => {
  const errors = [];

  if (!policy || typeof policy !== "object") {
    return ["missing_or_invalid_frontmatter"];
  }

  for (const field of REQUIRED_POLICY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(policy, field)) {
      errors.push(`missing policy field: ${field}`);
    }
  }

  if (!Array.isArray(policy.tags) || !policy.tags.every((value) => typeof value === "string")) {
    errors.push("policy field 'tags' must be an array of strings");
  }

  if (!policy.agent || typeof policy.agent !== "object") {
    errors.push("missing or invalid policy field 'agent'");
    return errors;
  }

  for (const field of REQUIRED_AGENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(policy.agent, field)) {
      errors.push(`missing agent field: ${field}`);
    }
  }

  if (typeof policy.agent.canActForSelf !== "boolean") {
    errors.push("agent.canActForSelf must be boolean");
  }
  if (typeof policy.agent.canActForOthers !== "boolean") {
    errors.push("agent.canActForOthers must be boolean");
  }
  if (typeof policy.agent.decisionDomain !== "string" || !policy.agent.decisionDomain.trim()) {
    errors.push("agent.decisionDomain must be a non-empty string");
  }
  if (!isStringArray(policy.agent.defaultActions)) {
    errors.push("agent.defaultActions must be an array of non-empty strings");
  }
  if (!isStringArray(policy.agent.requiredSignals)) {
    errors.push("agent.requiredSignals must be an array of non-empty strings");
  }
  if (!isStringArray(policy.agent.escalateWhen)) {
    errors.push("agent.escalateWhen must be an array of non-empty strings");
  }
  if (typeof policy.agent.replyTemplate !== "string" || !policy.agent.replyTemplate.trim()) {
    errors.push("agent.replyTemplate must be a non-empty string");
  }

  return errors;
};
