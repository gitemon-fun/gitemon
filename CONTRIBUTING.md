# Contributing

- Run `pnpm check` before you open a PR. It must be green.
- Scorer changes need tests. Any change must keep the rule that raw volume cannot raise a level
  (see `packages/scorer/test`).
- Never add code that requests the `repo` OAuth scope, reads private repositories, or sends any
  message to a developer. Those PRs will be closed.
- Be kind in issues and reviews.
