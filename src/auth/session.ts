import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const sessionSchema = z.object({
  apiBaseUrl: z.string(),
  accessToken: z.string().min(1),
  email: z.string().optional(),
  savedAt: z.string(),
});

export type AuthSession = z.infer<typeof sessionSchema>;

export function loadAuthSession(apiBaseUrl: string): AuthSession | undefined {
  const file = sessionFile();
  if (!existsSync(file)) return undefined;

  try {
    const session = sessionSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    return normalizeUrl(session.apiBaseUrl) === normalizeUrl(apiBaseUrl)
      ? session
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveAuthSession(input: {
  apiBaseUrl: string;
  accessToken: string;
  email?: string;
}) {
  const file = sessionFile();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const session: AuthSession = {
    apiBaseUrl: normalizeUrl(input.apiBaseUrl),
    accessToken: input.accessToken,
    email: input.email,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function sessionFile() {
  return (
    process.env.HONCH_WIZARD_SESSION_FILE ??
    path.join(homedir(), ".config", "honcho-wizard", "session.json")
  );
}

function normalizeUrl(value: string) {
  return value.replace(/\/+$/, "");
}
