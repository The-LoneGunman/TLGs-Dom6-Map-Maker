import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const applicationFiles = [
  "LICENSE",
  "README.md",
  "Start Pantokrator Atlas.cmd",
  "THIRD_PARTY_LICENSES.txt",
  "docs/USER_GUIDE.md",
  "scripts/local-server.mjs",
  "scripts/start-atlas.mjs",
];

async function requirePath(target, description) {
  try {
    await access(target);
  } catch {
    throw new Error(`Missing ${description}: ${target}`);
  }
}

function safeOutputDirectory(outputDirectory, projectRoot) {
  const output = path.resolve(outputDirectory);
  const project = path.resolve(projectRoot);
  const root = path.parse(output).root;
  if (output === root || output === project || project.startsWith(`${output}${path.sep}`)) {
    throw new Error(`Refusing unsafe installer payload output directory: ${output}`);
  }
  return output;
}

export async function stageWindowsInstaller({ projectRoot, nodeRoot, outputDirectory, nodeVersion }) {
  const project = path.resolve(projectRoot);
  const nodeDistribution = path.resolve(nodeRoot);
  const output = safeOutputDirectory(outputDirectory, project);
  const releaseMarker = path.join(project, "dist", ".pantokrator-release-ready");
  const productionEntry = path.join(project, "dist", "server", "index.js");
  const nodeExecutable = path.join(nodeDistribution, "node.exe");
  const nodeLicense = path.join(nodeDistribution, "LICENSE");

  for (const relativePath of applicationFiles) {
    await requirePath(path.join(project, relativePath), relativePath);
  }
  await requirePath(productionEntry, "production server entry");
  await requirePath(releaseMarker, "release-ready build marker");
  await requirePath(nodeExecutable, "bundled Node.js executable");
  await requirePath(nodeLicense, "bundled Node.js license");
  await requirePath(path.join(project, "src", "catalog", "data", "NOTICE.md"), "catalog notice");
  await requirePath(path.join(project, "src", "catalog", "data", "LICENSE.dom6inspector.txt"), "catalog license");
  await requirePath(path.join(project, "installer", "INSTALLER_NOTICES.txt"), "installer notices");
  await requirePath(path.join(project, "package.json"), "package.json");
  const projectVersion = JSON.parse(await readFile(path.join(project, "package.json"), "utf8")).version;
  if (typeof projectVersion !== "string" || !projectVersion) throw new Error("package.json must declare a version.");

  // Never clear an existing directory: a mistyped output must not erase source,
  // a previous build, the Node distribution, or unrelated user files.
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await mkdir(output);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Installer output already exists; choose a new directory: ${output}`);
    throw error;
  }

  for (const relativePath of applicationFiles) {
    const source = path.join(project, relativePath);
    const destination = path.join(output, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }

  await cp(path.join(project, "dist"), path.join(output, "dist"), { recursive: true });
  // The production server and launcher are ESM in .js/.mjs files. Without a
  // payload package.json, Node would inherit the module type from whatever
  // package.json sits above the install folder (for example, a CommonJS one
  // in the user's profile) and refuse to load the server.
  // The version is what the launcher and the local server compare when a
  // second launch finds an Atlas that is already running.
  await writeFile(
    path.join(output, "package.json"),
    `${JSON.stringify({ name: "pantokrator-atlas-runtime", version: projectVersion, private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(path.join(output, "runtime"), { recursive: true });
  await cp(nodeExecutable, path.join(output, "runtime", "node.exe"));
  await cp(nodeLicense, path.join(output, "runtime", "NODE_LICENSE.txt"));
  await writeFile(path.join(output, "runtime", "NODE_VERSION.txt"), `${nodeVersion}\n`, "utf8");

  const licenseDirectory = path.join(output, "licenses", "dom6-catalog");
  await mkdir(licenseDirectory, { recursive: true });
  await cp(path.join(project, "src", "catalog", "data", "NOTICE.md"), path.join(licenseDirectory, "NOTICE.md"));
  await cp(
    path.join(project, "src", "catalog", "data", "LICENSE.dom6inspector.txt"),
    path.join(licenseDirectory, "LICENSE.dom6inspector.txt"),
  );
  await cp(path.join(project, "installer", "INSTALLER_NOTICES.txt"), path.join(output, "licenses", "INSTALLER_NOTICES.txt"));

  const releaseSha = (await readFile(releaseMarker, "utf8")).trim();
  return { outputDirectory: output, nodeVersion, releaseSha };
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "end of command"}.`);
    values.set(key, value);
  }
  for (const required of ["--project-root", "--node-root", "--output", "--node-version"]) {
    if (!values.get(required)) throw new Error(`Missing required argument ${required}.`);
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const result = await stageWindowsInstaller({
    projectRoot: args.get("--project-root"),
    nodeRoot: args.get("--node-root"),
    outputDirectory: args.get("--output"),
    nodeVersion: args.get("--node-version"),
  });
  console.log(`Installer payload ready at ${result.outputDirectory}`);
  console.log(`Bundled Node.js ${result.nodeVersion}; source ${result.releaseSha}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
