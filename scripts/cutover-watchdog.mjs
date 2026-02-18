#!/usr/bin/env node

import { runReliabilityHub } from "./reliability-hub.mjs";

runReliabilityHub(process.argv.slice(2), { commandName: "cutover-watchdog" }).catch((error) => {
  process.stderr.write(`cutover-watchdog failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
