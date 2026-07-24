import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guardrail for docs/DATA_SNAPSHOT_POLICY.md: a normal code PR must contain
// only source code/config/docs (and, when a test needs it, a data/test/
// fixture) - never generated data/processed/*.json, data/raw, data/logs,
// dist, build output, archives, or secrets, even accidentally. Checks BOTH
// the working tree (git status --porcelain) and everything already
// committed on this branch beyond origin/main (git diff --name-only
// origin/main..HEAD) - a file can slip in through either path.
//
// --allow-data-snapshot switches to the deliberate "data snapshot PR" mode
// described in the policy doc: data/processed/*.json is allowed, but
// .env/node_modules/dist/build/zip/data/raw/data/logs are still blocked
// even then - those are never appropriate in ANY PR.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const ALWAYS_BLOCKED_PATTERNS = [
  { test: (f) => /^data\/raw\//.test(f), label: "data/raw/**" },
  { test: (f) => /^data\/logs\//.test(f), label: "data/logs/**" },
  { test: (f) => /^dist\//.test(f), label: "dist/**" },
  { test: (f) => /^build\//.test(f), label: "build/**" },
  { test: (f) => /\.zip$/i.test(f), label: "*.zip" },
  { test: (f) => f !== ".env.example" && (f === ".env" || f === ".env.local" || /^\.env\./.test(f)), label: ".env / .env.local" },
  { test: (f) => /^node_modules\//.test(f), label: "node_modules/**" },
];

// Only blocked in normal (code PR) mode - allowed under --allow-data-snapshot.
const DATA_SNAPSHOT_PATTERN = { test: (f) => /^data\/processed\/[^/]+\.json$/.test(f), label: "data/processed/*.json" };

const ALLOWED_PATTERNS = [
  { test: (f) => /^data\/test\//.test(f), label: "data/test/**" },
  { test: (f) => /^docs\//.test(f), label: "docs/**" },
  { test: (f) => /^scripts\//.test(f), label: "scripts/**" },
  { test: (f) => /^src\//.test(f), label: "src/**" },
  { test: (f) => f === "package.json", label: "package.json" },
  { test: (f) => f === "package-lock.json", label: "package-lock.json" },
  { test: (f) => f === ".gitignore", label: ".gitignore" },
  { test: (f) => f === ".env.example", label: ".env.example" },
  { test: (f) => /^\.github\//.test(f), label: ".github/**" },
  { test: (f) => /^deploy\//.test(f), label: "deploy/**" },
];

function run(command) {
  try {
    return execSync(command, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return { error };
  }
}

function parsePorcelainStatus(output) {
  return output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter(Boolean)
    .map((line) => {
      const body = line.slice(3);
      const arrowIndex = body.indexOf(" -> ");
      return arrowIndex === -1 ? body : body.slice(arrowIndex + 4);
    });
}

function parseNameOnly(output) {
  return output
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter(Boolean);
}

function classify(file, allowDataSnapshot) {
  for (const pattern of ALWAYS_BLOCKED_PATTERNS) {
    if (pattern.test(file)) return { status: "blocked", label: pattern.label };
  }
  if (DATA_SNAPSHOT_PATTERN.test(file)) {
    return allowDataSnapshot ? { status: "allowed", label: DATA_SNAPSHOT_PATTERN.label } : { status: "blocked", label: DATA_SNAPSHOT_PATTERN.label };
  }
  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.test(file)) return { status: "allowed", label: pattern.label };
  }
  return { status: "other", label: null };
}

export function verifyGitCleanForPr({ allowDataSnapshot = false } = {}) {
  const failures = [];
  const warnings = [];

  const branchResult = run("git branch --show-current");
  const currentBranch = branchResult.error ? "(unknown)" : branchResult.trim();

  const statusResult = run("git status --porcelain");
  if (statusResult.error) {
    failures.push(`Failed to run "git status --porcelain": ${statusResult.error.message}`);
  }
  const workingTreeFiles = statusResult.error ? [] : parsePorcelainStatus(statusResult);

  const diffResult = run("git --no-pager diff --name-only origin/main..HEAD");
  let branchDiffFiles = [];
  if (diffResult.error) {
    warnings.push(
      `Could not diff against origin/main ("${diffResult.error.message.trim().split("\n")[0]}") - run "git fetch origin main" first for an accurate branch-diff check.`
    );
  } else {
    branchDiffFiles = parseNameOnly(diffResult);
  }

  const allFiles = [...new Set([...workingTreeFiles, ...branchDiffFiles])];

  const blocked = [];
  const allowed = [];
  const other = [];
  allFiles.forEach((file) => {
    const { status, label } = classify(file, allowDataSnapshot);
    if (status === "blocked") blocked.push({ file, label });
    else if (status === "allowed") allowed.push({ file, label });
    else other.push(file);
  });

  blocked.forEach(({ file, label }) => {
    failures.push(`Blocked file present (${label}): ${file}`);
  });

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    mode: allowDataSnapshot ? "data-snapshot" : "code-pr",
    currentBranch,
    workingTreeFiles,
    branchDiffFiles,
    blocked,
    allowed,
    other,
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Git Clean-for-PR Verification");
  console.log("=".repeat(60));
  console.log(`Mode:                         ${result.mode === "data-snapshot" ? "DATA SNAPSHOT PR (--allow-data-snapshot)" : "CODE PR (normal)"}`);
  console.log(`Current branch:               ${result.currentBranch}`);
  console.log(`Working tree changed files:   ${result.workingTreeFiles.length}`);
  result.workingTreeFiles.forEach((f) => console.log(`  - ${f}`));
  console.log(`Changed vs origin/main:       ${result.branchDiffFiles.length}`);
  result.branchDiffFiles.forEach((f) => console.log(`  - ${f}`));

  console.log(`\nBlocked files found:         ${result.blocked.length}`);
  result.blocked.forEach(({ file, label }) => console.log(`  ✗ ${file} (${label})`));

  console.log(`Allowed files found:         ${result.allowed.length}`);
  result.allowed.forEach(({ file, label }) => console.log(`  ✓ ${file} (${label})`));

  if (result.other.length) {
    console.log(`Other tracked files (unclassified, not blocking): ${result.other.length}`);
    result.other.forEach((f) => console.log(`  - ${f}`));
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  if (result.blocked.length) {
    console.log("\nHow to fix:");
    if (result.mode === "code-pr") {
      console.log("  This looks like a code PR - remove the generated/blocked files before committing:");
      console.log("    git restore data/processed");
      console.log("    git clean -f <blocked untracked files listed above>");
      console.log("  Then commit only source code/config/docs.");
      console.log('  If data/processed/*.json is genuinely intended here, this must be a data snapshot PR:');
      console.log("    npm.cmd run verify:git-clean-for-pr -- --allow-data-snapshot");
      console.log("    (include the verification/provenance results in the PR description)");
    } else {
      console.log("  Even in data-snapshot mode, these files are never allowed in any PR:");
      console.log("  .env/.env.local, node_modules/**, dist/**, build/**, *.zip, data/raw/**, data/logs/**.");
      console.log("  Remove/restore them before committing.");
    }
  }

  console.log("=".repeat(60) + "\n");
}

function parseArgs(argv) {
  return { allowDataSnapshot: argv.includes("--allow-data-snapshot") };
}

async function main() {
  const { allowDataSnapshot } = parseArgs(process.argv.slice(2));
  const result = verifyGitCleanForPr({ allowDataSnapshot });
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:git-clean-for-pr:", error);
    process.exitCode = 1;
  });
}
