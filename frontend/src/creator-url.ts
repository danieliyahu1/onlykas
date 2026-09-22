import { addressPrefix } from "./app-config.js";

export function creatorPath(address: string): string {
  return `/creator/${encodeURIComponent(stripAddressPrefix(address))}`;
}

export function creatorAddressFromRoute(value: string): string {
  const prefix = `${addressPrefix()}:`;
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

export function hasAddressPrefix(value: string): boolean {
  return value.startsWith(`${addressPrefix()}:`);
}

function stripAddressPrefix(address: string): string {
  const prefix = `${addressPrefix()}:`;
  return address.startsWith(prefix) ? address.slice(prefix.length) : address;
}
