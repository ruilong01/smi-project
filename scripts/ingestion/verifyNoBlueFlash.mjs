import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Static-check gate for the "no full-screen blue flash during load/
// navigation" fix. background is not an inherited CSS property - html,
// body and #root each need their OWN background, and without a
// color-scheme declaration the browser can apply its own forced-dark
// heuristic to any moment those elements are briefly unstyled (initial
// paint before index.css applies, a lazy-route chunk swap) and paint a
// blue-grey tone instead of plain white. Checks:
//  1. index.html declares <meta name="color-scheme" content="dark"> and
//     sets an inline background on body/#root (the first line of defense,
//     applied before any stylesheet loads).
//  2. src/index.css sets color-scheme: dark and an explicit background on
//     html, body, #root (not just :root, which only ever paints <html>).
//  3. The Suspense/route-loading fallback in App.jsx uses an app-shell
//     class with a real background, never an unstyled/bare div.
//  4. No literal blue color (hex/rgb) appears anywhere in the CSS as a
//     background for a full-screen/loading/fallback class.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const BLUE_LITERAL_PATTERN = /#[0-9a-fA-F]*[Bb][Ll][Uu][Ee]|dodgerblue|royalblue|cornflowerblue|\bblue\b/;

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function verifyNoBlueFlash() {
  const failures = [];
  const warnings = [];

  const indexHtml = await readIfExists(path.join(rootDir, "index.html"));
  const indexCss = await readIfExists(path.join(rootDir, "src/index.css"));
  const appJsx = await readIfExists(path.join(rootDir, "src/App.jsx"));

  if (!indexHtml) failures.push("index.html not found.");
  if (!indexCss) failures.push("src/index.css not found.");
  if (!appJsx) failures.push("src/App.jsx not found.");
  if (failures.length) return { ok: false, failures, warnings };

  // 1. index.html hardening.
  const colorSchemeMetaMatch = indexHtml.match(/<meta\s+[^>]*>/gi)?.find(
    (tag) => /name="color-scheme"/.test(tag) && /content="[^"]*dark/.test(tag)
  );
  if (!colorSchemeMetaMatch) {
    failures.push('index.html: missing <meta name="color-scheme" content="dark"> - without it, the browser can force its own dark heuristic on unstyled content.');
  }
  if (!/<body[^>]*style="[^"]*background/.test(indexHtml)) {
    failures.push("index.html: <body> must set an inline background - the only defense that applies before index.css loads.");
  }
  if (!/id="root"[^>]*style="[^"]*background/.test(indexHtml)) {
    failures.push("index.html: #root must set an inline background - the only defense that applies before index.css loads.");
  }

  // 2. index.css hardening.
  if (!/color-scheme:\s*dark/.test(indexCss)) {
    failures.push("src/index.css: :root must declare color-scheme: dark.");
  }
  const htmlBodyRootRuleMatch = indexCss.match(/html,\s*\n?body,\s*\n?#root\s*\{([^}]*)\}/);
  if (!htmlBodyRootRuleMatch || !/background:/.test(htmlBodyRootRuleMatch[1])) {
    failures.push("src/index.css: the html, body, #root rule must set its own background explicitly (background is not inherited - :root's background only ever paints <html>).");
  }

  // 3. Suspense/route fallback must use a real app background class, not a bare div.
  const suspenseFallbackMatch = appJsx.match(/fallback=\{([\s\S]*?)\}\s*>/);
  if (!suspenseFallbackMatch) {
    failures.push("src/App.jsx: no Suspense fallback found.");
  } else if (!/className="[^"]*(detail-shell|app-shell)/.test(suspenseFallbackMatch[1])) {
    failures.push('src/App.jsx: Suspense fallback must use the "detail-shell"/"app-shell" background class, not an unstyled container.');
  }

  // 4. No literal blue used as an actual background/fill VALUE anywhere in
  // the stylesheet. Comments are stripped first (so this doesn't flag
  // prose like this file's own "blue flash" explanatory comments), and
  // only the value side of background/background-color/fill declarations
  // is checked (so a custom-property NAME like --smi-deep-blue, or any
  // other identifier that merely contains the substring "blue", is never a
  // false positive).
  const cssWithoutComments = indexCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarationPattern = /\b(background(?:-color)?|fill)\s*:\s*([^;]+);/gi;
  const blueDeclarations = [];
  let match;
  while ((match = declarationPattern.exec(cssWithoutComments))) {
    if (BLUE_LITERAL_PATTERN.test(match[2])) {
      blueDeclarations.push(`${match[1]}: ${match[2].trim()}`);
    }
  }
  if (blueDeclarations.length) {
    failures.push(`src/index.css: found a literal blue value in a background/fill declaration: ${blueDeclarations.join(", ")}.`);
  }

  return { ok: failures.length === 0, failures, warnings };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("No-Blue-Flash Verification");
  console.log("=".repeat(60));
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("All checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyNoBlueFlash();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:no-blue-flash:", error);
    process.exitCode = 1;
  });
}
