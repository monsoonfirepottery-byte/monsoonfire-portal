export type ProfileAvatarOption = {
  id: string;
  label: string;
  description: string;
  photoURL: string;
};

export const PROFILE_AVATAR_MAX_BYTES = 3 * 1024 * 1024;
export const PROFILE_AVATAR_MAX_DIMENSION = 2048;
export const PROFILE_AVATAR_MIN_DIMENSION = 64;
export const PROFILE_AVATAR_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type ProfileAvatarMime = (typeof PROFILE_AVATAR_ALLOWED_MIME)[number];

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function buildAvatarGlyph(glyph: string, bg: string, accent: string, glow: string, title: string) {
  const fill = encodeURIComponent(title);
  return toDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg}" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <circle cx="64" cy="64" r="62" fill="url(#bg)" />
      <circle cx="64" cy="64" r="56" fill="${glow}" opacity="0.22" />
      <text
        x="64"
        y="84"
        text-anchor="middle"
        font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
        font-size="52"
        aria-label="${fill}"
      >
        ${glyph}
      </text>
    </svg>
  `);
}

export const PROFILE_AVATAR_OPTIONS: ProfileAvatarOption[] = [
  {
    id: "default",
    label: "Monsoon Default",
    description: "Warm clay + ember",
    photoURL: buildAvatarGlyph("MF", "#8c4228", "#e07a4f", "#f8c07a", "Monsoon Default"),
  },
  {
    id: "kiln",
    label: "Kiln",
    description: "Kiln red",
    photoURL: buildAvatarGlyph("🔥", "#5b2f2a", "#f48b6a", "#ffd4b6", "Kiln"),
  },
  {
    id: "clay",
    label: "Clay",
    description: "Soft matte",
    photoURL: buildAvatarGlyph("🏺", "#9a6a3e", "#d8a46a", "#f8dcc8", "Clay"),
  },
  {
    id: "studio",
    label: "Studio",
    description: "Slate brush",
    photoURL: buildAvatarGlyph("🎨", "#3e4656", "#8a93a4", "#d7deeb", "Studio"),
  },
];

export const PROFILE_DEFAULT_AVATAR_URL = PROFILE_AVATAR_OPTIONS[0].photoURL;

export function sanitizeAvatarUid(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function resolveAvatarFileExtension(file: Pick<File, "type" | "name">): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  const nameParts = String(file.name || "").split(".");
  const ext = nameParts[nameParts.length - 1]?.toLowerCase();
  if (ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  return "png";
}

export function parseProfileAvatarStoragePath(url: string, uid: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = "/o/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
    if (!encodedPath) return null;
    const storagePath = decodeURIComponent(encodedPath);
    const safeUid = sanitizeAvatarUid(uid);
    if (!storagePath.startsWith(`profileAvatars/${safeUid}/`)) return null;
    return storagePath;
  } catch {
    return null;
  }
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function bytesToAscii(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => String.fromCharCode(value))
    .join("");
}

export function hasValidAvatarSignature(bytes: Uint8Array, mime: string): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false;
  if (mime === "image/png") {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mime === "image/jpeg") {
    return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mime === "image/gif") {
    const header = bytesToAscii(bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mime === "image/webp") {
    if (bytes.length < 12) return false;
    const riff = bytesToAscii(bytes.slice(0, 4));
    const webp = bytesToAscii(bytes.slice(8, 12));
    return riff === "RIFF" && webp === "WEBP";
  }
  return false;
}

export async function validateAvatarSignature(
  file: Pick<File, "arrayBuffer">,
  mime: string
): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return hasValidAvatarSignature(bytes, mime);
}
