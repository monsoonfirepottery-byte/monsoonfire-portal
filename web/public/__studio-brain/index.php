<?php
declare(strict_types=1);

const STUDIO_BRAIN_BRIDGE_PREFIX = '/__studio-brain';
const STUDIO_BRAIN_UPSTREAM_BASE = 'http://127.0.0.1:18787';
const STUDIO_BRAIN_UPSTREAM_TIMEOUT_SECONDS = 25;

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

if ($method === 'OPTIONS') {
    emitNoStoreHeaders();
    header('Allow: GET,POST,OPTIONS,HEAD');
    http_response_code(204);
    exit;
}

if (!function_exists('curl_init')) {
    emitJson(500, [
        'ok' => false,
        'message' => 'studio brain bridge missing curl support',
    ]);
}

[$upstreamPath, $upstreamQuery] = resolveUpstreamTarget((string) ($_SERVER['REQUEST_URI'] ?? '/'));
if (!isAllowedBridgePath($upstreamPath)) {
    emitJson(404, [
        'ok' => false,
        'message' => 'path not allowed',
    ]);
}

$upstreamUrl = STUDIO_BRAIN_UPSTREAM_BASE . $upstreamPath;
if ($upstreamQuery !== '') {
    $upstreamUrl .= '?' . $upstreamQuery;
}

$acceptHeader = (string) ($_SERVER['HTTP_ACCEPT'] ?? '');
$isEventStream = stripos($acceptHeader, 'text/event-stream') !== false || $upstreamPath === '/api/control-tower/events';
$requestHeaders = buildForwardHeaders();
$requestBody = readRequestBody($method);
$responseState = [
    'status' => 200,
    'headers' => [],
    'headersEmitted' => false,
];

if ($isEventStream) {
    @ini_set('output_buffering', 'off');
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    ob_implicit_flush(true);
}

$curlHandle = curl_init($upstreamUrl);
curl_setopt_array($curlHandle, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HEADER => false,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => $isEventStream ? 0 : STUDIO_BRAIN_UPSTREAM_TIMEOUT_SECONDS,
    CURLOPT_HTTPHEADER => $requestHeaders,
    CURLOPT_HEADERFUNCTION => static function ($handle, string $headerLine) use (&$responseState): int {
        $trimmed = trim($headerLine);
        if ($trimmed === '') {
            return strlen($headerLine);
        }

        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/i', $trimmed, $matches)) {
            $responseState['status'] = (int) $matches[1];
            return strlen($headerLine);
        }

        $separator = strpos($trimmed, ':');
        if ($separator === false) {
            return strlen($headerLine);
        }

        $name = strtolower(trim(substr($trimmed, 0, $separator)));
        $value = trim(substr($trimmed, $separator + 1));
        if ($value === '') {
            return strlen($headerLine);
        }

        if (in_array($name, ['content-type', 'x-request-id'], true)) {
            $responseState['headers'][$name] = $value;
        }

        return strlen($headerLine);
    },
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$responseState, $isEventStream): int {
        emitForwardResponseHeaders($responseState, $isEventStream);
        echo $chunk;
        if ($isEventStream) {
            flush();
        }
        return strlen($chunk);
    },
]);

if ($method === 'HEAD') {
    curl_setopt($curlHandle, CURLOPT_NOBODY, true);
} elseif ($requestBody !== null) {
    curl_setopt($curlHandle, CURLOPT_POSTFIELDS, $requestBody);
}

$ok = curl_exec($curlHandle);
if ($ok === false) {
    $errorMessage = curl_error($curlHandle);
    $errorCode = curl_errno($curlHandle);
    curl_close($curlHandle);

    if (connection_aborted()) {
        exit;
    }

    emitJson(502, [
        'ok' => false,
        'message' => 'studio brain bridge unavailable',
        'detail' => $errorMessage !== '' ? $errorMessage : sprintf('curl error %d', $errorCode),
    ]);
}

curl_close($curlHandle);
emitForwardResponseHeaders($responseState, $isEventStream);

function resolveUpstreamTarget(string $requestUri): array
{
    $path = (string) parse_url($requestUri, PHP_URL_PATH);
    $query = (string) parse_url($requestUri, PHP_URL_QUERY);

    if (!str_starts_with($path, STUDIO_BRAIN_BRIDGE_PREFIX)) {
        return [$path !== '' ? $path : '/', $query];
    }

    $suffix = substr($path, strlen(STUDIO_BRAIN_BRIDGE_PREFIX));
    if ($suffix === false || $suffix === '') {
        return ['/', $query];
    }

    return [$suffix, $query];
}

function isAllowedBridgePath(string $path): bool
{
    if ($path === '/' || $path === '/healthz') {
        return true;
    }

    return (bool) preg_match('#^/(?:ops(?:/.*)?|api/ops(?:/.*)?|api/control-tower(?:/.*)?)$#i', $path);
}

function buildForwardHeaders(): array
{
    $allowedNames = [
        'authorization',
        'content-type',
        'accept',
        'x-request-id',
        'x-trace-id',
        'traceparent',
    ];
    $allowedLookup = array_fill_keys($allowedNames, true);

    $headers = [];
    foreach (readIncomingHeaders() as $name => $value) {
        $normalizedName = strtolower($name);
        $normalizedValue = trim((string) $value);
        if ($normalizedValue === '' || !isset($allowedLookup[$normalizedName])) {
            continue;
        }
        $headers[] = sprintf('%s: %s', $name, $normalizedValue);
    }

    return $headers;
}

function readIncomingHeaders(): array
{
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            return $headers;
        }
    }

    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (!str_starts_with((string) $key, 'HTTP_')) {
            continue;
        }

        $normalized = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr((string) $key, 5)))));
        $headers[$normalized] = (string) $value;
    }

    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers['Content-Type'] = (string) $_SERVER['CONTENT_TYPE'];
    }

    return $headers;
}

function readRequestBody(string $method): ?string
{
    if (in_array($method, ['GET', 'HEAD'], true)) {
        return null;
    }

    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        return null;
    }

    return $body;
}

function emitForwardResponseHeaders(array &$responseState, bool $isEventStream): void
{
    if ($responseState['headersEmitted']) {
        return;
    }

    http_response_code((int) $responseState['status']);
    emitNoStoreHeaders();
    if ($isEventStream) {
        header('X-Accel-Buffering: no');
    }

    foreach ($responseState['headers'] as $name => $value) {
        if ($value === '') {
            continue;
        }
        header($name . ': ' . $value);
    }

    $responseState['headersEmitted'] = true;
}

function emitNoStoreHeaders(): void
{
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

function emitJson(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    emitNoStoreHeaders();
    header('Content-Type: application/json');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}
