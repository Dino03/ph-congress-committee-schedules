import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'out');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DATA_DIR = path.join(DOCS_DIR, 'data');

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDocsDir() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  if (!(await pathExists(DATA_DIR))) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

async function cleanDocsDir() {
  const entries = await fs.readdir(DOCS_DIR, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'data') return;
      await fs.rm(path.join(DOCS_DIR, entry.name), { recursive: true, force: true });
    })
  );
}

async function copyDirectory(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.readlink(srcPath);
      await fs.symlink(link, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const outExists = await pathExists(OUT_DIR);
  if (!outExists) {
    console.warn('[sync-docs] "out" directory not found. Skipping docs sync.');
    return;
  }

  await ensureDocsDir();
  await cleanDocsDir();
  await copyDirectory(OUT_DIR, DOCS_DIR);
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  console.log('[sync-docs] Exported site copied to docs/.');
}

main().catch((error) => {
  console.error('[sync-docs] Failed to sync docs directory', error);
  process.exitCode = 1;
});
