# Contributing

Thanks for helping improve `dsh-mermaid`. This is a community-maintained DSH
plugin and follows the host project's security posture for untrusted assistant
output.

## Development setup

Use Node.js `22.19` or `24+`:

```sh
npm ci
npm run check
npm test
npm run build
```

The generated `lib/` directory is committed because DSH can install the plugin
directly from GitHub without running dependency lifecycle scripts. After source
changes, rebuild and verify that only expected generated files changed:

```sh
npm run build
git diff --check
git diff -- lib
```

## Compatibility changes

Mermaid is intentionally pinned to the version in `package.json`. When changing
it, update the catalog in `tests/fixtures/mermaid-cases.ts`, run both suites,
and update the recorded baseline in the READMEs and compatibility docs:

```sh
npm run test:compat
npx playwright install chromium # once per machine
npm run test:compat:browser
```

DSH is in developer preview. Any change to a selector, host DOM assumption, or
composer submission path must update `docs/dsh-compatibility.md` and include a
focused regression test. Prefer a public DSH service or Slot as soon as one is
available; do not add another private DOM dependency without documenting why.

## Pull requests

- Keep security level fixed at `strict`.
- Preserve the plain source block on every render failure.
- Keep Chinese and English README behavior descriptions aligned.
- Include the command output for type checks, unit tests, production build,
  npm package dry-run, and the browser compatibility matrix.
- Do not commit credentials, npm tokens, local profiles, browser caches, or
  generated tarballs.
