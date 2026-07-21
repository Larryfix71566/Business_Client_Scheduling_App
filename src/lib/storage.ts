import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * storage.ts — minimal local-disk image store (Phase 5).
 *
 * A deliberately small interface (`saveImage` / `getImageUrl`) so the disk
 * backend can be swapped for S3 later without touching callers. Files live under
 * `./uploads` (gitignored), which is OUTSIDE `public/`, so images are served by
 * the `GET /api/uploads/[...path]` route handler — never statically.
 *
 * This module does raw disk I/O only; it never touches tenant DB models, so it
 * sits outside the tenant guardrail (the `photoPath` it returns is persisted on
 * `InventoryItem` through `inventory.ts` / `tenantDb`).
 */

/** Absolute path to the on-disk upload root. */
export const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

/** Max accepted upload size. Keep in sync with the client hint. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Allowed content types → file extension. Anything else is rejected. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export type SaveImageInput = {
  data: Uint8Array;
  contentType: string;
};

export type SaveImageOptions = {
  /** Logical folder under the upload root, e.g. "inventory". Sanitized. */
  subdir?: string;
};

/**
 * Validate and persist an image, returning its storage-relative `photoPath`
 * (e.g. "inventory/6f9c...c2.png"). The path is opaque to callers and is what
 * gets stored in the DB and later resolved by `getImageUrl`.
 */
export async function saveImage(
  input: SaveImageInput,
  opts: SaveImageOptions = {},
): Promise<string> {
  const ext = ALLOWED_IMAGE_TYPES[input.contentType];
  if (!ext) {
    throw new Error(`Unsupported image type: ${input.contentType}`);
  }
  if (input.data.byteLength === 0) {
    throw new Error("Empty file");
  }
  if (input.data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB limit`);
  }

  // Only allow a simple single-segment subdir (letters/digits/-/_).
  const subdir = /^[a-z0-9_-]+$/i.test(opts.subdir ?? "") ? opts.subdir! : "inventory";
  const filename = `${randomUUID()}.${ext}`;
  const relPath = `${subdir}/${filename}`;

  const dir = path.join(UPLOAD_ROOT, subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), input.data);

  return relPath;
}

/** Public URL for a stored image. Served by the uploads route handler. */
export function getImageUrl(photoPath: string): string {
  return `/api/uploads/${photoPath.replace(/^\/+/, "")}`;
}

/**
 * Resolve a storage-relative path to an absolute on-disk path, refusing any
 * traversal outside the upload root. Used by the image-serving route handler.
 * Returns null if the path escapes the root.
 */
export function resolveUploadPath(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(UPLOAD_ROOT, normalized);
  if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
    return null;
  }
  return abs;
}

/** Read a stored image's bytes + content type, or null if unreadable. */
export async function readStoredImage(
  relPath: string,
): Promise<{ data: Uint8Array; contentType: string } | null> {
  const abs = resolveUploadPath(relPath);
  if (!abs) return null;
  try {
    const data = await readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = EXT_TO_CONTENT_TYPE[ext] ?? "application/octet-stream";
    return { data, contentType };
  } catch {
    return null;
  }
}
