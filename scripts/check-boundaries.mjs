import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const sourceExtensions = new Set([".ts", ".tsx"]);
const forbidden = new Map([
  [
    "frontend",
    ["@libsql/client", "@aws-sdk", "../backend", "@onlykas/backend"],
  ],
  [
    "shared",
    ["express", "@libsql/client", "@aws-sdk", "../backend", "../frontend"],
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
for (const [workspace, imports] of forbidden) {
  for (const file of await sourceFiles(join(workspace, "src"))) {
    const source = await readFile(file, "utf8");
    for (const imported of imports) {
      if (
        source.includes(`from "${imported}`) ||
        source.includes(`from '${imported}`)
      ) {
        violations.push(
          `${relative(".", file)} imports forbidden dependency ${imported}`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
}
