#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Usage:
 *   node functions/scripts/setStaffClaim.js --uid <firebaseUid>
 *   node functions/scripts/setStaffClaim.js --email <user@example.com>
 *
 * Requires Firebase Admin credentials (ADC or service account).
 */

const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = { uid: "", email: "" };
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
    }
  }
  return out;
}

async function main() {
  const { uid, email } = parseArgs(process.argv);
  if (!uid && !email) {
    console.error("Provide --uid <uid> or --email <email>.");
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const auth = admin.auth();
  const user = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email);
  const existing = user.customClaims || {};
  const existingRoles = Array.isArray(existing.roles) ? existing.roles.filter((v) => typeof v === "string") : [];
  const roles = Array.from(new Set([...existingRoles, "staff"]));
  const nextClaims = { ...existing, staff: true, roles };

  await auth.setCustomUserClaims(user.uid, nextClaims);

  console.log("Updated claims:");
  console.log(JSON.stringify({ uid: user.uid, email: user.email || null, claims: nextClaims }, null, 2));
  console.log("Done. User should refresh token (sign out/in) to pick up new claims.");
}

main().catch((error) => {
  console.error("Failed to set staff claim:", error?.message || error);
  process.exit(1);
});

