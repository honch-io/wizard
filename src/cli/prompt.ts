import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export type Prompter = {
  question(prompt: string, options?: { sensitive?: boolean }): Promise<string>;
  confirm(prompt: string): Promise<boolean>;
  close(): void;
};

export function createPrompter(): Prompter {
  const rl = createInterface({ input, output });

  return {
    async question(prompt) {
      return rl.question(`${prompt} `);
    },
    async confirm(prompt) {
      const answer = await rl.question(`${prompt} [y/N] `);
      return answer.trim().toLowerCase() === "y";
    },
    close() {
      rl.close();
    },
  };
}
