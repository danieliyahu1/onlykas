import {
  addressFromScriptPublicKey,
  payToScriptHashScript,
  ScriptBuilder,
} from "@kluster/kaspa-wasm";
import artifact from "./contracts/membership.json" with { type: "json" };

export const MEMBERSHIP_PRICE_SOMPI = 100_000_000n;
export const MEMBERSHIP_DURATION_DAA = 864_000n;
export const MEMBERSHIP_INDEX_VALUE = 50_000_000n;
export const MEMBERSHIP_OUTPUT_VALUE = 50_000_000n;
export const MEMBERSHIP_PROTOCOL = "onlykas-membership-v1";

export interface MembershipState {
  creator: string;
  owner: string;
  expiresAtDaa: bigint;
  isMinter: boolean;
}

const contract = artifact.contracts.Membership;
const bytecode = Uint8Array.from(contract.compiled.bytecode);
const { offset, len } = contract.compiled.state_span;
const prefix = bytecode.slice(0, offset);
const suffix = bytecode.slice(offset + len);

export function addressPublicKey(address: string): string {
  const script = addressScript(address);
  if (!/^000020[0-9a-f]{64}ac$/i.test(script))
    throw new Error("INVALID_MEMBERSHIP_ADDRESS");
  return script.slice(6, -2).toLowerCase();
}

export function addressScript(address: string): string {
  const data = address.slice(address.lastIndexOf(":") + 1, -8);
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const bytes: number[] = [];
  let buffer = 0n;
  let bits = 0;
  for (const char of data) {
    const value = charset.indexOf(char);
    if (value < 0) throw new Error("INVALID_MEMBERSHIP_ADDRESS");
    buffer = (buffer << 5n) | BigInt(value);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push(Number((buffer >> BigInt(bits)) & 255n));
      buffer &= (1n << BigInt(bits)) - 1n;
    }
  }
  if (bytes[0] !== 0 || bytes.length !== 33)
    throw new Error("INVALID_MEMBERSHIP_ADDRESS");
  return `000020${hex(Uint8Array.from(bytes.slice(1)))}ac`;
}

export function membershipRedeemScript(state: MembershipState): string {
  const encoded = encodeState(state);
  return hex(concat(prefix, encoded, suffix));
}

export function membershipScript(state: MembershipState): string {
  const value = payToScriptHashScript(membershipRedeemScript(state)).toJSON() as {
    script: string;
    version: number;
  };
  return `${value.version.toString(16).padStart(4, "0")}${value.script}`;
}

export function membershipAddress(state: MembershipState): string {
  const script = payToScriptHashScript(membershipRedeemScript(state));
  const address = addressFromScriptPublicKey(script, "testnet-10");
  if (!address) throw new Error("MEMBERSHIP_SCRIPT_ADDRESS_FAILED");
  return address.toString();
}

export function decodeMembershipRedeemScript(scriptHex: string): MembershipState | null {
  if (!/^[0-9a-f]+$/i.test(scriptHex) || scriptHex.length % 2 !== 0) return null;
  const script = Uint8Array.from(Buffer.from(scriptHex, "hex"));
  if (script.length !== bytecode.length) return null;
  if (!equal(script.slice(0, offset), prefix) || !equal(script.slice(offset + len), suffix))
    return null;
  const pushes = parsePushes(script.slice(offset, offset + len));
  if (!pushes || pushes.length !== 4) return null;
  const [creator, owner, expiry, minter] = pushes;
  if (creator?.length !== 32 || owner?.length !== 32 || expiry?.length !== 8 || minter?.length !== 1)
    return null;
  if (minter[0] !== 0 && minter[0] !== 1) return null;
  return {
    creator: hex(creator),
    owner: hex(owner),
    expiresAtDaa: decodePositiveI64(expiry),
    isMinter: minter[0] === 1,
  };
}

export function membershipMintSignatureScript(
  currentRedeemScript: string,
  minter: MembershipState,
  member: MembershipState,
  fundingInputIndex: number,
  paymentOutputIndex: number,
  ownerIndexOutputIndex: number,
): string {
  const builder = new ScriptBuilder({ flags: { covenantsEnabled: true } });
  builder.addData(`${minter.creator}${member.creator}`);
  builder.addData(`${minter.owner}${member.owner}`);
  builder.addData(hex(concat(encodePositiveI64(minter.expiresAtDaa), encodePositiveI64(member.expiresAtDaa))));
  builder.addData(minter.isMinter ? "0100" : "0000");
  builder.addData(byteHex(fundingInputIndex));
  builder.addData(byteHex(paymentOutputIndex));
  builder.addData(byteHex(ownerIndexOutputIndex));
  builder.addData(contract.entries.mint.dispatch_tag);
  return ScriptBuilder.fromScript(builder.toString(), { flags: { covenantsEnabled: true } })
    .addData(currentRedeemScript)
    .toString();
}

export function membershipPayload(memberRedeemScript: string): string {
  return Buffer.from(JSON.stringify({ protocol: MEMBERSHIP_PROTOCOL, memberRedeemScript })).toString("hex");
}

export function parseMembershipPayload(payload: string | undefined): string | null {
  if (!payload || !/^[0-9a-f]+$/i.test(payload) || payload.length % 2 !== 0) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "hex").toString("utf8")) as Record<string, unknown>;
    return value.protocol === MEMBERSHIP_PROTOCOL && typeof value.memberRedeemScript === "string"
      ? value.memberRedeemScript
      : null;
  } catch {
    return null;
  }
}

function encodeState(state: MembershipState): Uint8Array {
  return concat(
    fixedPush(Buffer.from(state.creator, "hex")),
    fixedPush(Buffer.from(state.owner, "hex")),
    fixedPush(encodePositiveI64(state.expiresAtDaa)),
    fixedPush(Uint8Array.of(state.isMinter ? 1 : 0)),
  );
}

function fixedPush(value: Uint8Array): Uint8Array {
  if (value.length > 75) throw new Error("MEMBERSHIP_STATE_FIELD_TOO_LARGE");
  return concat(Uint8Array.of(value.length), value);
}

function encodePositiveI64(value: bigint): Uint8Array {
  if (value < 0n || value > 0x7fff_ffff_ffff_ffffn) throw new Error("INVALID_DAA");
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return bytes;
}

function decodePositiveI64(bytes: Uint8Array): bigint {
  if ((bytes[7] ?? 0) & 0x80) return -1n;
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1)
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  return value;
}

function parsePushes(script: Uint8Array): Uint8Array[] | null {
  const values: Uint8Array[] = [];
  for (let offset = 0; offset < script.length;) {
    const opcode = script[offset++];
    if (opcode === undefined) return null;
    let size: number;
    if (opcode <= 75) size = opcode;
    else if (opcode === 76) size = script[offset++] ?? -1;
    else return null;
    if (size < 0 || offset + size > script.length) return null;
    values.push(script.slice(offset, offset + size));
    offset += size;
  }
  return values;
}

function byteHex(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("INVALID_INDEX");
  return value.toString(16).padStart(2, "0");
}

function concat(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
