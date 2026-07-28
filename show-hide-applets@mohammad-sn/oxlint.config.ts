import sharedConfig from "@s-h-a-d-o-w/oxlint-config/lint.js";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [sharedConfig],
  globals: {
    global: "readonly",
    imports: "readonly",
  },
  rules: {
    "unicorn/no-null": "off",
    "typescript/no-explicit-any": "off",

    // JS engine in Cinnamon is too old for these:
    "unicorn/no-array-reverse": "off",
    "unicorn/prefer-structured-clone": "off",
  },
});
