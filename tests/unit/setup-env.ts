// Load DATABASE_URL (and friends) from .env before any module instantiates the
// Prisma client. Runs as a vitest setupFile, before test modules are imported.
import "dotenv/config";
