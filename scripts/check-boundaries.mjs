import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const sourceExtensions = new Set([".ts", ".tsx"]);
const workspaceForbidden = new Map([
  ["frontend", ["@libsql/client", "@aws-sdk", "../backend", "@onlykas/backend"]],
  ["shared", ["express", "@libsql/client", "@aws-sdk", "../backend", "../frontend"]],
]);

const backendLayerForbidden = new Map([
  [
    "backend/src/domain",
    ["node:", "express", "@libsql/client", "@aws-sdk", "@onlykas/backend", "zod"],
  ],
  [
    "backend/src/application",
    [
      "node:fs",
      "node:os",
      "node:path",
      "express",
      "@libsql/client",
      "@aws-sdk",
      "@onlykas/backend",
    ],
  ],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(path)
        : sourceExtensions.has(extname(path))
          ? [path]
          : [];
    }),
  );
  return files.flat();
}

const violations = [];
for (const [workspace, imports] of workspaceForbidden) {
  for (const file of await sourceFiles(join(workspace, "src"))) {
    const source = await readFile(file, "utf8");
    violations.push(...findViolations(file, source, imports));
  }
}

for (const [directory, imports] of backendLayerForbidden) {
  if (!(await directoryExists(directory))) continue;
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    violations.push(...findViolations(file, source, imports));
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}

function findViolations(file, source, imports) {
  return imports
    .filter((imported) => importPattern(imported).test(source))
    .map(
      (imported) => `${relative(".", file)} imports forbidden dependency ${imported}`,
    );
}

function importPattern(imported) {
  return new RegExp(
    `(?:from\\s*["']${escapeRegExp(imported)}|import\\s*\\(\\s*["']${escapeRegExp(imported)})`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function directoryExists(directory) {
  try {
    await readdir(directory);
    return true;
  } catch {
    return false;
  }
}
