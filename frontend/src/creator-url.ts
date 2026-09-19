const TESTNET_PREFIX = "kaspatest:";

export function creatorPath(address: string): string {
  return `/creator/${encodeURIComponent(stripTestnetPrefix(address))}`;
}

export function creatorAddressFromRoute(value: string): string {
  return value.startsWith(TESTNET_PREFIX) ? value : `${TESTNET_PREFIX}${value}`;
}

export function hasTestnetPrefix(value: string): boolean {
  return value.startsWith(TESTNET_PREFIX);
}

function stripTestnetPrefix(address: string): string {
  return address.startsWith(TESTNET_PREFIX)
    ? address.slice(TESTNET_PREFIX.length)
    : address;
}
