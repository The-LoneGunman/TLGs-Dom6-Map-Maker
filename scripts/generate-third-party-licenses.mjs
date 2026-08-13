import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(projectRoot, "package-lock.json");
const outputPath = path.join(projectRoot, "THIRD_PARTY_LICENSES.txt");
const noticePattern = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageName(packagePath) {
  const parts = packagePath.replaceAll("\\", "/").split("node_modules/").at(-1)?.split("/") ?? [];
  return parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

async function packageNotices(packagePath) {
  const absoluteDirectory = path.join(projectRoot, packagePath);
  if (!(await exists(absoluteDirectory))) return [];
  const files = (await readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && noticePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareText);
  const notices = [];
  for (const file of files) {
    const text = normalizeText(await readFile(path.join(absoluteDirectory, file), "utf8"));
    if (text) notices.push({ file, text });
  }
  return notices;
}

async function render() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const packages = Object.entries(lock.packages)
    .filter(([packagePath]) => packagePath)
    .map(([packagePath, metadata]) => ({
      id: `${packageName(packagePath)}@${metadata.version}`,
      license: metadata.license,
      metadata,
      packagePath,
    }))
    .sort((left, right) => compareText(left.id, right.id) || compareText(left.packagePath, right.packagePath));

  const groupedNotices = new Map();
  for (const entry of packages) {
    const portable = !entry.metadata.optional && !entry.metadata.os && !entry.metadata.cpu;
    if (!portable) continue;
    if (!(await exists(path.join(projectRoot, entry.packagePath)))) {
      throw new Error(`Required locked package is not installed: ${entry.packagePath}`);
    }
    for (const notice of await packageNotices(entry.packagePath)) {
      const key = createHash("sha256").update(notice.text).digest("hex");
      const group = groupedNotices.get(key) ?? { packages: [], text: notice.text };
      group.packages.push(`${entry.id} (${notice.file})`);
      groupedNotices.set(key, group);
    }
  }

  const lines = [
    "PANTOKRATOR ATLAS THIRD-PARTY SOFTWARE NOTICES",
    "================================================",
    "",
    "Generated deterministically from package-lock.json by:",
    "  node scripts/generate-third-party-licenses.mjs",
    "",
    "This file covers third-party JavaScript packages used to build or bundled into",
    "the Pantokrator Atlas production distribution. Package versions and declared",
    "licenses below are pinned by package-lock.json. Repeated license texts are",
    "deduplicated, with every covered package named above its text.",
    "",
    "Pantokrator Atlas original code is licensed separately under the root 0BSD",
    "LICENSE. The generated Dom6 Inspector catalog has separate GPL-3.0 terms in",
    "src/catalog/data/NOTICE.md and src/catalog/data/LICENSE.dom6inspector.txt.",
    "Neither the root license nor this inventory relicenses third-party components.",
    "",
    `LOCKED PACKAGE INVENTORY (${packages.length} package instances)`,
    "------------------------------------------------------------",
    ...packages.map((entry) => `${entry.id} | ${entry.license} | ${entry.packagePath}`),
    "",
    `DEDUPLICATED LICENSE AND NOTICE TEXTS (${groupedNotices.size})`,
    "------------------------------------------------------------",
  ];

  const groups = [...groupedNotices.entries()].sort(([left], [right]) => compareText(left, right));
  for (const [hash, group] of groups) {
    lines.push("", `--- SHA-256 ${hash} ---`, "Packages:");
    lines.push(...group.packages.sort(compareText).map((value) => `  ${value}`));
    lines.push("", group.text, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const expected = await render();
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    // The error below explains how to generate the missing file.
  }
  if (normalizeText(current) !== normalizeText(expected)) {
    console.error("THIRD_PARTY_LICENSES.txt is stale. Run: node scripts/generate-third-party-licenses.mjs");
    process.exitCode = 1;
  } else {
    console.log("THIRD_PARTY_LICENSES.txt is current.");
  }
} else {
  await writeFile(outputPath, expected, "utf8");
  console.log(`Wrote ${path.relative(projectRoot, outputPath)}.`);
}
