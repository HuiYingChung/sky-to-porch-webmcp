#!/usr/bin/env node
/**
 * Mechanical, fail-closed preflight for a proposed public repository commit.
 *
 * This is only one part of the Public Release Gate. It checks the candidate
 * reachable history and local worktree for common privacy, secret,
 * generated-output, and large-file risks. It does not replace specialist
 * secret scanning, license review, claim review, CI, deployment verification,
 * or explicit user approval.
 */
import { execFileSync } from "node:child_process";

const MAX_TRACKED_BYTES = 5 * 1024 * 1024;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: options.encoding === undefined ? "utf8" : options.encoding,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseArgs(argv) {
  let candidate = "HEAD";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--candidate") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--candidate requires a Git revision");
      }
      candidate = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { candidate };
}

const issues = [];

function addIssue(category, path, detail) {
  issues.push({ category, path, detail });
}

function isExampleEnvironmentFile(path) {
  return /(?:^|\/)\.env(?:\.[^/]+)*\.example$/u.test(path) || path === ".env.example";
}

function inspectPath(path, size) {
  const normalized = path.replaceAll("\\", "/");
  if (
    /(?:^|\/)(?:node_modules|\.next|coverage|test-results|playwright-report|blob-report|\.vercel|archive|data\/raw|data\/staging)(?:\/|$)/u.test(
      normalized
    )
  ) {
    addIssue("generated, local, archived, or raw path", path, "must not be in a public candidate");
  }
  if (/(?:^|\/)\.env(?:\.|$)/u.test(normalized) && !isExampleEnvironmentFile(normalized)) {
    addIssue("environment file", path, "only reviewed placeholder examples may be public");
  }
  if (
    /\.(?:pem|key|p12|pfx|jks|keystore|sqlite|sqlite3|db|rdb|zip|7z|tar|gz|tgz|tif|tiff|geotiff|nc|nc4|hdf|hdf5|h5|he5|grib|grib2|gpkg|mbtiles|pmtiles)$/iu.test(
      normalized
    )
  ) {
    addIssue("high-risk tracked file type", path, "requires removal or explicit release review");
  }
  if (size > MAX_TRACKED_BYTES) {
    addIssue("large tracked file", path, `${size} bytes exceeds the ${MAX_TRACKED_BYTES}-byte gate`);
  }
}

const CONTENT_RULES = [
  {
    category: "local Windows user path",
    pattern: /[A-Za-z]:\\Users\\[^\\\r\n]+/u,
  },
  {
    category: "local Unix user path",
    pattern: /\/(?:Users|home)\/[^/\s]+/u,
  },
  {
    category: "email address requiring privacy review",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  },
  {
    category: "private key material",
    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u,
  },
  {
    category: "GitHub token pattern",
    pattern: /\b(?:gh[opisur]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/iu,
  },
  {
    category: "provider token pattern",
    pattern: /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/u,
  },
  {
    category: "long bearer credential",
    pattern: /\bBearer\s+[A-Za-z0-9._~-]{20,}/iu,
  },
];

const REVIEWED_PUBLIC_MATCHES = new Map([
  // npm's own lockfile metadata for a deprecated transitive package.
  ["package-lock.json", new Set(["i@izs.me"])],
  // A deliberately credential-shaped, non-routable test fixture in old commits.
  [
    "src/__tests__/unit/wp10-drought-live-adapter.test.ts",
    new Set(["pass@gitc.earthdata.nasa.gov"]),
  ],
  [
    "src/__tests__/unit/wp06-provider-router.test.ts",
    new Set(["pass@us-south.ml.cloud.ibm.com"]),
  ],
]);

function inspectBlob(path, objectId, size) {
  if (size > MAX_TRACKED_BYTES) return;
  let content;
  try {
    content = git(["cat-file", "blob", objectId], { encoding: null });
  } catch {
    addIssue("unreadable candidate blob", path, "git cat-file failed");
    return;
  }
  if (!Buffer.isBuffer(content) || content.includes(0)) return;
  const text = content.toString("utf8");
  for (const rule of CONTENT_RULES) {
    const matches = text.match(new RegExp(rule.pattern.source, `${rule.pattern.flags}g`)) ?? [];
    const reviewed = REVIEWED_PUBLIC_MATCHES.get(path) ?? new Set();
    if (matches.some((match) => !reviewed.has(match))) {
      addIssue(rule.category, path, "review or visibly redact before public release");
    }
  }
}

function parseTree(treeOutput) {
  const entries = [];
  for (const line of treeOutput.split(/\r?\n/u)) {
    if (!line) continue;
    const match = /^(\d+)\s+blob\s+([0-9a-f]+)\s+(\d+|-)\t(.+)$/u.exec(line);
    if (!match) {
      addIssue("unparsed Git tree entry", "(tree)", line);
      continue;
    }
    entries.push({ objectId: match[2], size: Number(match[3]), path: match[4] });
  }
  return entries;
}

let candidateInput;
try {
  ({ candidate: candidateInput } = parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`Public release preflight configuration error: ${error.message}`);
  process.exit(2);
}

let candidateCommit;
try {
  candidateCommit = git(["rev-parse", "--verify", `${candidateInput}^{commit}`]).trim();
} catch {
  console.error(`Public release preflight configuration error: cannot resolve ${candidateInput}`);
  process.exit(2);
}

const worktreeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]).trim();
if (worktreeStatus) {
  addIssue("dirty worktree", "(worktree)", "commit or remove candidate changes before the gate");
}

const reachableCommits = git(["rev-list", candidateCommit])
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean);
const uniqueEntries = new Map();
for (const commit of reachableCommits) {
  for (const entry of parseTree(git(["ls-tree", "-r", "-l", "--full-tree", commit]))) {
    uniqueEntries.set(`${entry.path}\0${entry.objectId}`, entry);
  }
}
const entries = [...uniqueEntries.values()];
if (entries.length === 0) {
  addIssue("empty candidate history", "(tree)", "a public candidate must contain reviewed files");
}

for (const entry of entries) {
  inspectPath(entry.path, entry.size);
  inspectBlob(entry.path, entry.objectId, entry.size);
}

console.log("Public Release Gate — mechanical preflight");
console.log(`Candidate: ${candidateCommit}`);
console.log(`Reachable commits inspected: ${reachableCommits.length}`);
console.log(`Unique path/blob pairs inspected: ${entries.length}`);
console.log(`Large-file threshold: ${MAX_TRACKED_BYTES} bytes`);

if (issues.length > 0) {
  console.error(`Result: FAIL (${issues.length} issue(s))`);
  for (const issue of issues) {
    console.error(`- [${issue.category}] ${issue.path}: ${issue.detail}`);
  }
  console.error(
    "Boundary: mechanical reachable-history check only. A PASS would still require specialist secret scanning, license, claim, CI, deployment, public-surface, and user-approval evidence."
  );
  process.exit(1);
}

console.log("Result: PASS (mechanical preflight only)");
console.log(
  "Boundary: this does not prove specialist secret-scan coverage, licensing, claim accuracy, deployment health, public visibility, or user approval."
);
