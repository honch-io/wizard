import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude the Honch SDK submodule that the wizard checks out under
    // components/ when it is run against this repo during local testing.
    exclude: [...configDefaults.exclude, "**/components/**"],
    setupFiles: ["./test/vitest.setup.ts"],
  },
});
