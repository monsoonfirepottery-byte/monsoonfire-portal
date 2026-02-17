#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Usage:
 *   node functions/scripts/setStaffClaim.js --uid <firebaseUid>
 *   node functions/scripts/setStaffClaim.js --email <user@example.com>
 * Optional:
 *   --password <password>
 *   --display-name <name>
 *   --project-id <firebaseProjectId>
 *   --auth-emulator-host <host>
 *   --auth-emulator-port <port>
 *
 * If uid/email doesn't exist, this script creates the user when --password is provided,
 * then applies staff claims.
 */

const admin = require("firebase-admin");
const { randomBytes } = require("node:crypto");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_STAFF_EMAIL = "studio-brain-staff@monsoonfire.local";

function parseArgs(argv) {
  const out = {
    uid: "",
    email: "",
    password: "",
    displayName: "",
    projectId: "",
    authEmulatorHost: "",
    authEmulatorPort: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--uid" && argv[i + 1]) {
      out.uid = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--email" && argv[i + 1]) {
      out.email = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--password" && argv[i + 1]) {
      out.password = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--display-name" && argv[i + 1]) {
      out.displayName = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--project-id" && argv[i + 1]) {
      out.projectId = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--auth-emulator-host" && argv[i + 1]) {
      out.authEmulatorHost = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (token === "--auth-emulator-port" && argv[i + 1]) {
      out.authEmulatorPort = String(argv[i + 1]).trim();
      i += 1;
    }
  }

  return out;
}

function generatePassword() {
  return `STB-${randomBytes(16).toString("base64url")}a`;
}

async function main() {
  const args = parseArgs(process.argv);
  const email = args.email || DEFAULT_STAFF_EMAIL;

  if (!args.uid && !args.email) {
    console.log(`No user identifier provided. Using default Studio Brain staff email: ${email}`);
  }

  if (!args.uid && !args.email && !args.password) {
    console.log("A password was not provided; a random password will be generated if user creation is needed.");
  }

  const projectId = args.projectId || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const emulatorHost = args.authEmulatorHost || process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
  if (emulatorHost) {
    const host = emulatorHost.includes(":") ? emulatorHost : `${emulatorHost}:9099`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = host;
  }

  if (args.authEmulatorPort && process.env.FIREBASE_AUTH_EMULATOR_HOST && !args.authEmulatorHost) {
    const [host] = String(process.env.FIREBASE_AUTH_EMULATOR_HOST).split(":");
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `${host}:${args.authEmulatorPort}`;
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const auth = admin.auth();

  let user = null;
  let created = false;
  let passwordUpdated = false;
  let displayNameUpdated = false;
  let generatedPassword = "";

  if (args.uid) {
    user = await auth.getUser(args.uid);
  }

  if (!user) {
    try {
      user = await auth.getUserByEmail(email);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") {
        throw error;
      }
    }
  }

  if (!user) {
    if (!args.password) {
      generatedPassword = generatePassword();
      args.password = generatedPassword;
    }
    user = await auth.createUser({
      email,
      password: args.password,
      displayName: args.displayName || "Studio Brain Staff",
    });
    created = true;
    passwordUpdated = true;
    if (args.displayName) {
      displayNameUpdated = true;
    }
  } else {
    const updates = {};
    if (args.password) {
      updates.password = args.password;
    }
    if (args.displayName && args.displayName !== user.displayName) {
      updates.displayName = args.displayName;
    }

    if (Object.keys(updates).length > 0) {
      await auth.updateUser(user.uid, updates);
      if (updates.password) passwordUpdated = true;
      if (updates.displayName) displayNameUpdated = true;
      user = await auth.getUser(user.uid);
    }
  }

  const existing = user.customClaims || {};
  const existingRoles = Array.isArray(existing.roles) ? existing.roles.filter((value) => typeof value === "string") : [];
  const roles = Array.from(new Set([...existingRoles, "staff"]));
  const nextClaims = { ...existing, staff: true, roles };

  await auth.setCustomUserClaims(user.uid, nextClaims);

  console.log("Updated staff user:");
  console.log(JSON.stringify({ uid: user.uid, email: user.email || null, claims: nextClaims }, null, 2));
  if (created) {
    console.log(`Created user: ${user.email || email}`);
  }
  if (passwordUpdated) {
    const shownPassword = generatedPassword || args.password;
    console.log(`Password ${created ? "set" : "updated"}: ${shownPassword}`);
  }
  if (displayNameUpdated) {
    console.log(`Display name set: ${args.displayName || "Studio Brain Staff"}`);
  }

  if (args.password && args.password !== generatedPassword) {
    console.log("Used provided password; ensure it is stored securely.");
  }

  console.log("User should refresh token (sign out/in) to pick up claims.");
}

main().catch((error) => {
  console.error("Failed to set staff claim:", error?.message || error);
  process.exit(1);
});
