import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TENANT_MODELS } from "@/lib/tenant";

// Guardrail #1: route handlers/pages under src/app must never touch tenant data
// through the raw Prisma client — only via tenant.ts helpers. src/lib is the
// whitelisted home for direct prisma access.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.join(ROOT, "src", "app");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no direct prisma.<tenantModel> usage in src/app", () => {
  const files = walk(APP_DIR);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("does not reference tenant models on the raw prisma client", () => {
    const violations: string[] = [];
    // e.g. prisma.customer, prisma . service, prisma?.appointment
    const modelAlt = TENANT_MODELS.join("|");
    const pattern = new RegExp(`prisma\\s*[?!]?\\.\\s*(${modelAlt})\\b`);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split(/\r?\n/).forEach((line, i) => {
        if (pattern.test(line)) {
          violations.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, `Direct prisma tenant-model access found:\n${violations.join("\n")}`).toEqual([]);
  });
});
