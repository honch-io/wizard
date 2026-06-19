import crypto from "node:crypto";

export type SecretMetadata = {
  ref: string;
  label: string;
  createdAt: string;
};

export type SecretVault = {
  put(label: string, value: string): string;
  resolve(ref: string): string;
  list(): SecretMetadata[];
};

export function createSecretVault(): SecretVault {
  const values = new Map<
    string,
    { label: string; value: string; createdAt: string }
  >();

  return {
    put(label, value) {
      const ref = `secret:${crypto.randomUUID()}`;
      values.set(ref, {
        label,
        value,
        createdAt: new Date().toISOString(),
      });
      return ref;
    },
    resolve(ref) {
      const entry = values.get(ref);
      if (!entry) {
        throw new Error(`Unknown secret ref: ${ref}`);
      }
      return entry.value;
    },
    list() {
      return Array.from(values.entries()).map(([ref, entry]) => ({
        ref,
        label: entry.label,
        createdAt: entry.createdAt,
      }));
    },
  };
}
