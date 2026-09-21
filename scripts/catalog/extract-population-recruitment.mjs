import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { extractPopulationRecruitment, POPULATION_RECRUITMENT_SOURCE } from "./population-recruitment-decoder.mjs";

export const USAGE = "Usage: node scripts/catalog/extract-population-recruitment.mjs --game-version 6.37 --exe <Dominions6.exe path> --catalog <pinned BaseU.csv path>\nReads only the explicitly supplied files. Writes catalogue JSON to stdout only. No game is launched or modified.\n";

/** No automatic installation discovery, default paths, implicit writes or downloads. */
export function parseExtractionArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index], value = argv[index + 1];
    if (!["--game-version", "--exe", "--catalog"].includes(flag) || result.has(flag)
      || typeof value !== "string" || !value.trim() || value.startsWith("--")) throw new Error("Invalid, duplicate or incomplete extraction arguments.");
    result.set(flag, value);
  }
  if (result.size !== 3) throw new Error("Explicit --game-version, --exe and --catalog arguments are required.");
  if (result.get("--game-version") !== POPULATION_RECRUITMENT_SOURCE.gameVersion) throw new Error("Unsupported game version; only the pinned 6.37 Windows x64 build is supported.");
  return { help: false, gameVersion: result.get("--game-version"), executablePath: result.get("--exe"), catalogPath: result.get("--catalog") };
}

function readExactFile(path, expectedBytes) {
  const handle = openSync(path, "r");
  try {
    const stat = fstatSync(handle);
    if (!stat.isFile() || stat.size !== expectedBytes) throw new Error("An input is not a regular file of the exact reviewed length.");
    const bytes = Buffer.alloc(expectedBytes);
    let filled = 0;
    while (filled < bytes.length) {
      const count = readSync(handle, bytes, filled, bytes.length - filled, filled);
      if (!count) throw new Error("Input changed or ended during the bounded read.");
      filled += count;
    }
    if (readSync(handle, Buffer.alloc(1), 0, 1, expectedBytes)) throw new Error("Input grew during the bounded read.");
    return bytes;
  } finally {
    closeSync(handle);
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseExtractionArguments(argv);
  if (args.help) { process.stdout.write(USAGE); return; }
  const executable = readExactFile(args.executablePath, POPULATION_RECRUITMENT_SOURCE.executableBytes);
  const catalog = readExactFile(args.catalogPath, POPULATION_RECRUITMENT_SOURCE.catalogBytes);
  const result = extractPopulationRecruitment(executable, catalog, args.gameVersion);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// Importing argument parsing in tests must not inspect files or run a CLI job.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    process.stderr.write(`Population recruitment extraction failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
