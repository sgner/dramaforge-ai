/**
 * Regression: source files must not contain mojibake (double-encoded Chinese).
 *
 * Background:
 *   `use-canvas-store.ts` historically contained 143 lines of garbled text like
 *   "闂傚倸鍊搁崐椋庣矆" — original Chinese comments that were decoded as
 *   Latin-1/GBK and re-encoded as UTF-8 multiple times. These were useless
 *   noise that polluted IDE views, git diffs, and any agent reading the file.
 *
 * Cleanup (scripts/cleanup_mojibake.py):
 *   - 126 pure `// mojibake` lines deleted
 *   - 6 JSDoc `* mojibake` lines replaced with `* (description lost)`
 *   - 10 trailing-comment lines had the `// mojibake` suffix stripped
 *
 * This test scans the source tree for any file containing mojibake characters
 * and fails if any are found, preventing accidental reintroduction.
 *
 * Scope: only the project's own source (excludes node_modules, .next, dist,
 * vendored Python packages under docs/, build artifacts, etc.).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

// Mojibake character set: Chinese CJK chars that result from double-encoding.
// Same set used in scripts/cleanup_mojibake.py.
const MOJIBAKE = '闂濞閻鐎闁婵濡閰琚鐓鐒閸鐜鏇鏁鐚閿鏅鍙鍐鐗鍩鍎妲绶绱绹缂缃缄缈缊缐缞缟缡缢缥缦缧缨缪缫缬缮缯缱缲缳缴缵缣鏌鐟鐔鐧鐜鐞鏉鋂錂鎔鏰鏹';
const MOJIBAKE_RE = new RegExp(`[${MOJIBAKE}]`);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.py']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  // Vendored Python packages (from Infinite-Canvas project) — not our code
  'Lib',
  'site-packages',
]);

interface Hit {
  file: string;
  line: number;
  text: string;
}

// Only scan our own source directories (skip docs/ which contains vendored
// packages and the backend/.venv vendored deps that are too large to scan).
// Also exclude this test file and the cleanup script, which legitimately
// contain the mojibake character set as a constant for matching.
const SCAN_DIRS = ['components', 'agent', 'lib', 'backend/app', 'backend/tests'];

const SELF_SCAN_FILES = new Set([
  // This test file — contains MOJIBAKE constant intentionally
  path.resolve(__dirname, 'source-no-mojibake.test.ts'),
  // Cleanup script — contains mojibake_chars constant intentionally
  path.resolve(ROOT, 'scripts/cleanup_mojibake.py'),
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SOURCE_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function scanForMojibake(file: string): Hit[] {
  const hits: Hit[] = [];
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return hits;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (MOJIBAKE_RE.test(lines[i])) {
      hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 120) });
    }
  }
  return hits;
}

describe('source files should not contain mojibake', () => {
  it('no mojibake characters in any project source file', () => {
    const allHits: Hit[] = [];
    for (const rel of SCAN_DIRS) {
      const dir = path.join(ROOT, rel);
      const files = walk(dir);
      for (const f of files) {
        if (SELF_SCAN_FILES.has(f)) continue;
        allHits.push(...scanForMojibake(f));
      }
    }
    if (allHits.length > 0) {
      // Format a useful error message
      const summary = allHits
        .slice(0, 20)
        .map((h) => `  ${path.relative(ROOT, h.file)}:${h.line}  ${h.text}`)
        .join('\n');
      const more = allHits.length > 20 ? `\n  ... and ${allHits.length - 20} more` : '';
      throw new Error(
        `Found ${allHits.length} mojibake line(s). Run scripts/cleanup_mojibake.py to fix.\n${summary}${more}`,
      );
    }
    expect(allHits).toEqual([]);
  });
});
