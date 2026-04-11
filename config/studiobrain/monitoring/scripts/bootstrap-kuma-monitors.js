const fs = require('fs');
const crypto = require('crypto');
const { io } = require('socket.io-client');

const CRED_FILE = '/app/data/bootstrap-admin.json';

function randomPassword(length = 28) {
  return crypto.randomBytes(length).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, length);
}

function emitAck(socket, event, ...args) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event} ack`)), 20000);
    socket.emit(event, ...args, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function nextEvent(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function baseMonitor() {
  return {
    type: 'http',
    name: '',
    parent: null,
    url: 'https://',
    method: 'GET',
    interval: 60,
    retryInterval: 120,
    resendInterval: 0,
    maxretries: 3,
    timeout: 30,
    notificationIDList: {},
    ignoreTls: false,
    upsideDown: false,
    packetSize: 56,
    expiryNotification: false,
    maxredirects: 10,
    accepted_statuscodes: ['200-299'],
    dns_resolve_type: 'A',
    dns_resolve_server: '1.1.1.1',
    docker_container: '',
    docker_host: null,
    proxyId: null,
    mqttUsername: '',
    mqttPassword: '',
    mqttTopic: '',
    mqttSuccessMessage: '',
    authMethod: null,
    oauth_auth_method: 'client_secret_basic',
    httpBodyEncoding: 'json',
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: { mechanism: 'None' },
    kafkaProducerSsl: false,
    kafkaProducerAllowAutoTopicCreation: false,
    gamedigGivenPortOnly: true,
    active: true,
  };
}

function httpMonitor(name, url, accepted = ['200-299']) {
  return {
    ...baseMonitor(),
    type: 'http',
    name,
    url,
    accepted_statuscodes: accepted,
  };
}

function portMonitor(name, hostname, port) {
  return {
    ...baseMonitor(),
    type: 'port',
    name,
    hostname,
    port,
    url: '',
  };
}

const monitorsToEnsure = [
  { ...httpMonitor('MinIO Live Health', 'http://studiobrain_minio:9000/minio/health/live'), headers: { Host: 'localhost:9000' } },
  httpMonitor('SearXNG HTTP', 'http://searxng:8080/'),
  portMonitor('Postgres TCP 5432', 'studiobrain_postgres', 5432),
  portMonitor('Redis TCP 6379', 'studiobrain_redis', 6379),
  portMonitor('SSH TCP 22', 'host.docker.internal', 22),
  portMonitor('OTel Collector gRPC 4317', 'studiobrain_otel_collector', 4317),
  portMonitor('OTel Collector gRPC 4318', 'studiobrain_otel_collector', 4318),
];

(async () => {
  const socket = io('http://127.0.0.1:3001', {
    transports: ['websocket'],
    timeout: 20000,
  });

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('Timed out connecting to Uptime Kuma socket')), 20000);
    socket.once('connect', () => {
      clearTimeout(timeoutId);
      resolve();
    });
    socket.once('connect_error', reject);
  });

  let creds = null;
  if (fs.existsSync(CRED_FILE)) {
    creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
  }

  const needsSetup = await emitAck(socket, 'needSetup');

  if (needsSetup) {
    if (!creds) {
      creds = {
        username: 'opsadmin',
        password: randomPassword(24),
        createdAt: new Date().toISOString(),
      };
    }

    const setupResult = await emitAck(socket, 'setup', creds.username, creds.password);
    if (!setupResult || !setupResult.ok) {
      throw new Error(`Setup failed: ${setupResult ? setupResult.msg : 'no response'}`);
    }

    fs.writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  }

  if (!creds) {
    throw new Error('Uptime Kuma already initialized and no bootstrap credentials file exists at /app/data/bootstrap-admin.json');
  }

  const loginResult = await emitAck(socket, 'login', {
    username: creds.username,
    password: creds.password,
  });

  if (!loginResult || !loginResult.ok) {
    throw new Error(`Login failed for ${creds.username}: ${loginResult ? loginResult.msg : 'no response'}`);
  }

  const monitorListPromise = nextEvent(socket, 'monitorList');
  const listAck = await emitAck(socket, 'getMonitorList');
  if (!listAck || !listAck.ok) {
    throw new Error(`getMonitorList failed: ${listAck ? listAck.msg : 'no response'}`);
  }

  const monitorList = await monitorListPromise;
  const existingByName = new Set(Object.values(monitorList).map((m) => m.name));

  const created = [];
  const skipped = [];

  for (const monitor of monitorsToEnsure) {
    if (existingByName.has(monitor.name)) {
      skipped.push(monitor.name);
      continue;
    }

    const result = await emitAck(socket, 'add', monitor);
    if (!result || !result.ok) {
      throw new Error(`Failed adding monitor "${monitor.name}": ${result ? result.msg : 'no response'}`);
    }

    created.push(monitor.name);
    existingByName.add(monitor.name);
  }

  socket.disconnect();

  console.log(JSON.stringify({
    credentialsFile: CRED_FILE,
    username: creds.username,
    password: creds.password,
    created,
    skipped,
    totalConfigured: existingByName.size,
  }, null, 2));

  process.exit(0);
})().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
