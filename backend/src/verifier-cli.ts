import process from "node:process";
import { pathToFileURL } from "node:url";
import { KASPA_TESTNET_ADDRESS_PATTERN } from "@onlykas/shared";
import { KaspaMembershipVerifier } from "./verifier.js";

const DEFAULT_NODE = "https://api-tn10.kaspa.org";

function usage(): string {
  return [
    "Usage:",
    "  verify-membership address <kaspatest:address> [--owner <address>] [--node <url>]",
    "  verify-membership utxo <transactionId> <outputIndex> [--owner <address>] [--node <url>]",
    "",
    "Verifies membership status directly from the Kaspa chain by reading covenant",
    "UTXOs. The source of truth is on-chain data, not OnlyKas records.",
  ].join("\n");
}

export async function runVerifierCli(
  argv: string[],
  stdout: { write(text: string): void },
  stderr: { write(text: string): void },
): Promise<number> {
  const options: { node: string; owner: string | undefined } = {
    node: DEFAULT_NODE,
    owner: undefined,
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) break;
    if (arg === "--node") options.node = argv[++index] ?? DEFAULT_NODE;
    else if (arg === "--owner") options.owner = argv[++index];
    else if (arg === "--help" || arg === "-h") {
      stdout.write(`${usage()}\n`);
      return 0;
    } else positional.push(arg);
  }
  const [command, ...rest] = positional;
  const verifier = new KaspaMembershipVerifier(options.node);
  try {
    if (command === "address") {
      const address = rest[0];
      if (
        !address ||
        rest.length > 1 ||
        !KASPA_TESTNET_ADDRESS_PATTERN.test(address)
      )
        throw new Error(usage());
      if (
        options.owner !== undefined &&
        !KASPA_TESTNET_ADDRESS_PATTERN.test(options.owner)
      )
        throw new Error("--owner must be a valid kaspatest: address.");
      const memberships = await verifier.verifyAddress(address, options.owner);
      stdout.write(
        `${JSON.stringify(
          {
            address,
            verifiedAt: new Date().toISOString(),
            valid: memberships.some(
              (membership) => membership.status === "VALID",
            ),
            memberships,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }
    if (command === "utxo") {
      const transactionId = rest[0];
      const outputIndex = Number(rest[1]);
      if (
        !transactionId ||
        !/^[0-9a-f]{64}$/i.test(transactionId) ||
        !Number.isInteger(outputIndex) ||
        outputIndex < 0
      )
        throw new Error(usage());
      if (rest.length > 2) throw new Error(usage());
      if (
        options.owner !== undefined &&
        !KASPA_TESTNET_ADDRESS_PATTERN.test(options.owner)
      )
        throw new Error("--owner must be a valid kaspatest: address.");
      const membership = await verifier.verifyUtxo(
        transactionId,
        outputIndex,
        options.owner,
      );
      stdout.write(`${JSON.stringify(membership, null, 2)}\n`);
      return 0;
    }
    throw new Error(usage());
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = await runVerifierCli(
    process.argv.slice(2),
    process.stdout,
    process.stderr,
  );
}