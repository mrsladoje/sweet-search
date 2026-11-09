import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot() {
  const fromEnv = process.env.SWEET_SEARCH_PROJECT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const cwd = process.cwd();

  // Prefer an existing sweet-search state dir so indexed corpus subdirectories
  // do not get pulled back to an outer package root.
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.sweet-search'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }

  // Fallback to the historical project markers for cold-start/init flows before
  // .sweet-search/ exists.
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }

  return cwd;
}

// Resolved before the .env file is read, so a SWEET_SEARCH_PROJECT_ROOT line in
// the file cannot move the project root.
export const PROJECT_ROOT = resolveProjectRoot();

try {
  // __dirname is core/infrastructure/config/, so go up 3 levels
  const localEnvPath = path.join(__dirname, '..', '..', '..', '.env');
  const projectEnvPath = path.join(PROJECT_ROOT, '.env');

  const dotenvPath = existsSync(localEnvPath) ? localEnvPath : projectEnvPath;

  if (existsSync(dotenvPath)) {
    const envContent = readFileSync(dotenvPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=["']?([^"'\n]+)["']?$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (e) { /* .env loading is optional */ }
