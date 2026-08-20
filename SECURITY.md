# Security policy

`dsh-mermaid` renders assistant-authored text and therefore treats every
diagram as untrusted input.

## Security invariants

- Mermaid runs with `securityLevel: strict`.
- Mermaid click callbacks are never bound.
- The plugin serves only its pinned Mermaid bundle and source map from its own
  dependency tree; the route rejects every other path.
- Render failures retain the original plain-text fence and never insert
  Mermaid's error HTML into the conversation.
- Text and edge limits plus a render timeout bound hostile or pathological
  diagrams.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability. Use the
repository's **Security → Report a vulnerability** flow:

https://github.com/AKS1st/dsh-mermaid/security/advisories/new

Include the affected plugin and DSH versions, a minimal Mermaid source sample,
the observed impact, and reproduction steps. Reports about DeepSeek Harness
itself should follow the security policy of the official
`deepseek-ai/deepseek-harness` repository.
