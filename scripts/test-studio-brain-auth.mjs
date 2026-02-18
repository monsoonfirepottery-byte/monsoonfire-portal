import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { setTimeout as setAbortTimeout } from "node:timers";

const parseArgs = () => {
  const parsed = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const keyValue = arg.slice(2);
    let key = keyValue;
    let value = "true";

    if (keyValue.includes("=")) {
      const [rawKey, ...rest] = keyValue.split("=");
      key = rawKey;
      value = rest.join("=");
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      value = args[i + 1];
      i += 1;
    }

    parsed[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }

  return parsed;
};

const preview = (value, max = 220) => {
  if (!value) {
    return "";
  }
  const singleLine = String(value).replace(/\r/g, "").replace(/\n/g, " ").trim();
  if (singleLine.length <= max) {
    return singleLine;
  }
  return `${singleLine.slice(0, max)}...`;
};

const redactToken = (token) => {
  if (!token) {
    return "<empty>";
  }
  const trimmed = String(token).trim();
  const prefix = trimmed.length <= 12 ? trimmed : trimmed.slice(0, 12);
  return `${prefix}... (len=${trimmed.length})`;
};

const probe = async (label, url, headers = {}) => {
  const controller = new AbortController();
  const timer = setAbortTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await response.text();
    return {
      label,
      statusCode: response.status,
      body,
      error: null,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      label,
      statusCode: 0,
      body: "",
      error: error?.message || String(error),
    };
  }
};

const promptToken = async () => {
  const readline = createInterface({ input, output });
  const token = await new Promise((resolve) => {
    readline.question("Enter Firebase ID token for Authorization header: ", (value) => {
      readline.close();
      resolve(value.trim());
    });
  });
  return token;
};

const findWorkingCapabilitiesPath = async (baseUrl, preferredPath) => {
  const candidates = [preferredPath, "/api/capabilities", "/capabilities"].filter(
    (value, index, array) => array.indexOf(value) === index,
  );

  for (const path of candidates) {
    const probeResult = await probe(`path-probe:${path}`, `${baseUrl}${path}`, {});
    if (probeResult.statusCode !== 404) {
      return {
        path,
        statusCode: probeResult.statusCode,
      };
    }
  }

  return {
    path: preferredPath,
    statusCode: 404,
  };
};

const run = async () => {
  const options = parseArgs();
  const baseUrl =
    String(
      options.baseUrl || options.baseURL || process.env.STUDIO_BRAIN_BASE_URL || "http://127.0.0.1:8787",
    ).replace(/\/$/, "");
  const capabilitiesPath =
    options.capabilitiesPath || "/api/capabilities";
  let idToken = (options.idToken || process.env.STUDIO_BRAIN_ID_TOKEN || "").trim();
  const adminToken = (options.adminToken || process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim();
  const promptForToken = options.promptForToken === "true" || options.promptForToken === "1";

  if (!idToken && promptForToken) {
    idToken = await promptToken();
  }

  const pathResolution = await findWorkingCapabilitiesPath(baseUrl, capabilitiesPath);
  const targetPath = pathResolution.path;
  const targetUrl = `${baseUrl}${targetPath}`;

  console.log(`Studio Brain auth probe target: ${targetUrl}`);
  console.log(`Capabilities path detection status: ${pathResolution.statusCode}`);
  console.log(`ID token source: ${idToken ? redactToken(idToken) : "missing"}`);
  console.log(`Admin token source: ${adminToken ? redactToken(adminToken) : "missing"}`);

  const cases = [];
  cases.push(await probe("A no headers", targetUrl, {}));

  if (idToken) {
    cases.push(await probe("B Authorization only", targetUrl, { Authorization: `Bearer ${idToken}` }));
  } else {
    cases.push({
      label: "B Authorization only",
      statusCode: -1,
      body: "",
      error: "Skipped: no ID token. Set STUDIO_BRAIN_ID_TOKEN or pass --prompt-for-token.",
    });
  }

  if (idToken && adminToken) {
    cases.push(
      await probe("C Authorization + x-studio-brain-admin-token", targetUrl, {
        Authorization: `Bearer ${idToken}`,
        "x-studio-brain-admin-token": adminToken,
      }),
    );
  } else {
    cases.push({
      label: "C Authorization + x-studio-brain-admin-token",
      statusCode: -1,
      body: "",
      error:
        "Skipped: missing STUDIO_BRAIN_ID_TOKEN or STUDIO_BRAIN_ADMIN_TOKEN.",
    });
  }

  console.log("");
  console.log("Results:");
  cases.forEach((item) => {
    console.log(`- ${item.label}: status=${item.statusCode}`);
    if (item.error) {
      console.log(`  error=${preview(item.error, 180)}`);
    }
    if (item.body) {
      console.log(`  body=${preview(item.body, 220)}`);
    }
  });

  const caseA = cases[0];
  const caseB = cases[1];
  const caseC = cases[2];
  const caseABody = String(caseA.body || "").toLowerCase();
  const caseBBody = String(caseB.body || "").toLowerCase();
  const caseCBody = String(caseC.body || "").toLowerCase();

  const passA = [401, 403].includes(caseA.statusCode) || caseABody.includes("missing authorization header");
  const passB =
    caseB.statusCode === -1 ? false : (caseB.statusCode === 200 || !caseBBody.includes("missing authorization header"));
  const passC =
    caseC.statusCode === -1 ? true : (caseC.statusCode === 200 || !caseCBody.includes("missing authorization header"));

  console.log("");
  console.log(`PASS A (no headers rejected): ${passA}`);
  console.log(`PASS B (authorization accepted/non-missing-auth): ${passB}`);
  console.log(`PASS C (authorization+admin accepted/non-missing-auth): ${passC}`);

  if (passA && passB && passC) {
    console.log("Overall: PASS");
    return;
  }

  console.log("Overall: FAIL");
  process.exit(1);
};

run().catch((error) => {
  console.error("Studio Brain auth probe failed:", error);
  process.exit(1);
});
