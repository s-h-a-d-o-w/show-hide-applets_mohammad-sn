import type { Configuration } from "lint-staged";

export default {
  "**/*.ts": ["pnpm lint", () => "pnpm typecheck"],
  "**/*": "oxfmt --no-error-on-unmatched-pattern",
} satisfies Configuration;
