import net from "node:net";

const host = process.env.PGHOST ?? "127.0.0.1";
const port = Number(process.env.PGPORT ?? "5433");
const timeoutMs = Number(process.env.PREFLIGHT_TIMEOUT_MS ?? "2000");

function checkTcp({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (ok, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, `Connected to ${host}:${port}`));
    socket.once("timeout", () => done(false, `Timed out connecting to ${host}:${port}`));
    socket.once("error", (err) => done(false, `Connection failed: ${err.message}`));
    socket.connect(port, host);
  });
}

async function main() {
  process.stdout.write("studio-brain preflight\n");
  process.stdout.write(`Checking Postgres TCP at ${host}:${port}...\n`);

  const postgres = await checkTcp({ host, port, timeoutMs });
  if (postgres.ok) {
    process.stdout.write(`PASS: ${postgres.message}\n`);
    process.exit(0);
  }

  process.stderr.write(`FAIL: ${postgres.message}\n`);
  process.stderr.write("Start Postgres and retry, then run:\n");
  process.stderr.write("1) npm --prefix studio-brain run preflight\n");
  process.stderr.write("2) npm --prefix studio-brain start\n");
  process.stderr.write("3) npm --prefix studio-brain run soak\n");
  process.exit(1);
}

void main().catch((error) => {
  process.stderr.write(`preflight crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
