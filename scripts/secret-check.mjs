#!/usr/bin/env node
/**
 * secret-check.mjs
 *
 * Scans tracked source and configuration files for patterns that look like
 * real credentials or secrets. Fails with exit code 1 if any match is found.
 *
 * Rules:
 * - Skips node_modules, .next, build outputs, and lockfiles.
 * - Skips .env.example files (intentionally credential-free by policy).
 * - Scans .env files that are NOT .example files.
 * - Prints the file and line number of any match.
 * - Only matches in git-TRACKED files fail the check. A gitignored local
 *   credential file (.env.local) is the documented place for real keys, so
 *   matches there are reported as warnings and never block verification.
 *   If git is unavailable every file is treated as tracked (fail closed).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import { execSync } from "child_process";

let trackedFiles = null;
try {
  trackedFiles = new Set(
    execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
} catch {
  trackedFiles = null;
}

function isTracked(filePath) {
  if (!trackedFiles) return true;
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  return trackedFiles.has(normalized);
}

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build",
  "out", ".turbo", ".cache", "coverage", ".nyc_output",
]);

// Files to skip entirely (lockfiles, example env, etc.)
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
]);

/**
 * Returns true if a file should be skipped from scanning.
 * .env.example files are intentionally credential-free by policy.
 */
function shouldSkipFile(filePath) {
  const name = basename(filePath);
  if (SKIP_FILES.has(name)) return true;
  // Skip .env.example and .env.*.example
  if (name.endsWith(".example")) return true;
  return false;
}

/**
 * Patterns that strongly suggest a real credential value is present.
 * Each rule is [pattern, description].
 * These are specific to known credential formats, not generic long strings.
 */
const SECRET_RULES = [
  // AWS Access Key ID
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  // AWS Secret Access Key in assignment
  [/aws_secret_access_key\s*[:=]\s*[^\s]{20,}/i, "AWS secret key assignment"],
  // GitHub personal access token (classic)
  [/ghp_[A-Za-z0-9]{36}/, "GitHub PAT (classic)"],
  // GitHub fine-grained PAT
  [/github_pat_[A-Za-z0-9_]{82}/, "GitHub fine-grained PAT"],
  // npm auth token in .npmrc
  [/\/\/registry\.npmjs\.org\/:_authToken\s*=\s*[^\s]{10,}/, "npm auth token"],
  // Generic: key/token/secret/password followed by = or : and a long non-placeholder value
  [/(?:api[_-]?key|api[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key|access[_-]?token|password)\s*[:=]\s*["']?(?![<\s{])[A-Za-z0-9+/\-_]{20,}["']?/i, "credential assignment"],
  // Real .env assignment (not a comment, not a placeholder, not empty)
  [/^(?!#)[A-Z][A-Z0-9_]{3,}=(?!<|$|["']?(?:your|replace|example|placeholder|change|todo|not.set|false|true|0|1)["']?$)["']?[A-Za-z0-9+/\-_.@]{20,}["']?/m, ".env real credential"],
];

/**
 * These patterns in a line indicate it is a known-safe false positive.
 */
const ALLOW_PATTERNS = [
  /placeholder/i,
  /your[-_\s]?[a-z]+[-_\s]?here/i,
  /\[REDACTED/i,
  /replace[-_\s]?with/i,
  /change[-_\s]?me/i,
  /not[-_\s]?set/i,
  /todo/i,
  // SHA-256/512 hex hashes stored as documentation (40+ hex chars preceded by backtick or space or colon)
  /[`\s:][0-9a-fA-F]{40,}[`\s,;]/,
  // npm integrity hashes (sha512- prefix)
  /sha512-[A-Za-z0-9+/=]{40,}/,
  // File hash lines in markdown/docs
  /SHA[-_]?256.*[0-9a-fA-F]{40,}/i,
];

function isAllowed(line) {
  return ALLOW_PATTERNS.some((p) => p.test(line));
}

let issues = 0;
let warnings = 0;

function scanFile(filePath) {
  let content;
  try { content = readFileSync(filePath, "utf8"); } catch { return; }
  const tracked = isTracked(filePath);
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.trimStart().startsWith("#")) return; // Skip comment lines
    if (isAllowed(line)) return;
    for (const [pattern, desc] of SECRET_RULES) {
      if (pattern.test(line)) {
        if (tracked) {
          console.error(`POTENTIAL SECRET [${desc}]: ${filePath}:${idx + 1}`);
          issues++;
        } else {
          console.warn(`WARNING untracked-file secret [${desc}]: ${filePath}:${idx + 1}`);
          warnings++;
        }
        break; // One report per line
      }
    }
  });
}

function scanDir(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) scanDir(full);
      continue;
    }
    const name = basename(full);
    const ext = extname(name);
    const isEnv = name.startsWith(".env");
    if (!SCAN_EXTENSIONS.has(ext) && !isEnv) continue;
    if (shouldSkipFile(full)) continue;
    scanFile(full);
  }
}

scanDir(".");

if (issues > 0) {
  console.error(`\nSecret check FAILED: ${issues} potential secret(s) found in tracked files.`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(
    `Secret check passed: ${warnings} match(es) in untracked local files only (expected for .env.local).`
  );
} else {
  console.log("Secret check passed: no potential secrets found.");
}
