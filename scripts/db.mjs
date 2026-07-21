#!/usr/bin/env node
// Embedded Postgres control script (start | stop | status).
// Runs a real PostgreSQL daemon via pg_ctl using the binaries shipped by the
// `embedded-postgres` npm package, so the server persists across separate
// `npm run` invocations (db:push, dev, tests) instead of dying with the script.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.pgdata');
const PORT = '5433';
const DB_USER = 'postgres';
const DB_PASSWORD = 'postgres';
const DB_NAME = 'appdb';

function resolveBinDir() {
  const base = path.join(ROOT, 'node_modules', '@embedded-postgres');
  const platforms = readdirSync(base);
  if (platforms.length === 0) throw new Error('No @embedded-postgres platform package found. Run npm install.');
  const binDir = path.join(base, platforms[0], 'native', 'bin');
  if (!existsSync(binDir)) throw new Error(`Expected postgres binaries at ${binDir}`);
  return binDir;
}

const BIN = resolveBinDir();
const bin = (name) => path.join(BIN, name);

function run(name, args, opts = {}) {
  return execFileSync(bin(name), args, {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, PGPASSWORD: DB_PASSWORD, ...(opts.env || {}) },
    encoding: 'utf8',
  });
}

function isInitialised() {
  return existsSync(path.join(DATA_DIR, 'PG_VERSION'));
}

function isRunning() {
  try {
    run('pg_ctl', ['-D', DATA_DIR, 'status'], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

function initialise() {
  console.log('Initialising cluster at .pgdata ...');
  const tmp = mkdtempSync(path.join(tmpdir(), 'pgpw-'));
  const pwFile = path.join(tmp, 'pw');
  writeFileSync(pwFile, DB_PASSWORD);
  try {
    run('initdb', [
      '-D', DATA_DIR,
      '-U', DB_USER,
      '--pwfile', pwFile,
      '--auth-local=trust',
      '--auth-host=scram-sha-256',
      '--encoding=UTF8',
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function start() {
  if (!isInitialised()) initialise();
  if (isRunning()) {
    console.log('Postgres already running on port ' + PORT + '.');
  } else {
    console.log('Starting Postgres on port ' + PORT + ' ...');
    run('pg_ctl', [
      '-D', DATA_DIR,
      '-l', path.join(DATA_DIR, 'server.log'),
      '-o', `-p ${PORT}`,
      '-w',
      'start',
    ]);
  }
  await ensureDatabase();
  console.log(`Ready: postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${PORT}/${DB_NAME}`);
}

async function ensureDatabase() {
  // No client binaries ship with embedded-postgres, so use the `pg` client
  // (a dependency of embedded-postgres) to create the app database if absent.
  const client = new pg.Client({
    host: 'localhost', port: Number(PORT), user: DB_USER,
    password: DB_PASSWORD, database: 'postgres',
  });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE ${DB_NAME}`);
      console.log(`Created database "${DB_NAME}".`);
    }
  } finally {
    await client.end();
  }
}

function stop() {
  if (!isInitialised() || !isRunning()) {
    console.log('Postgres is not running.');
    return;
  }
  console.log('Stopping Postgres ...');
  run('pg_ctl', ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop']);
}

function status() {
  if (!isInitialised()) {
    console.log('Cluster not initialised.');
    return;
  }
  console.log(isRunning() ? `Running on port ${PORT}.` : 'Stopped.');
}

const cmd = process.argv[2];
try {
  switch (cmd) {
    case 'start': await start(); break;
    case 'stop': stop(); break;
    case 'status': status(); break;
    default:
      console.error('Usage: node scripts/db.mjs <start|stop|status>');
      process.exit(1);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
