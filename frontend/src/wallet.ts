export type WalletProps = {
  address: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
};
