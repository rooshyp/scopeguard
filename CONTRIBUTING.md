# Contributing

Thanks for helping make ScopeGuard more dependable.

## Before opening a change

1. Open an issue for substantial behavior or classification-policy changes.
2. Use only synthetic SOWs, messages, names, prices, dates, and client details.
3. Never include a real agreement, API key, model response containing private data, or deployment log.

## Local workflow

```bash
npm install
cp .env.example .env
npm run check
```

An API key is needed to use the live browser analyzer, but not to run the automated test suite.

Keep changes focused and add tests for observable behavior. Prompt-policy changes should include conservative boundary cases—especially unclear revisions, mixed requests, conflicting terms, missing state, and prompt-injection text.

## Pull requests

- Explain what changed and why.
- List the checks you ran.
- Call out prompt, schema, privacy, security, or API-contract changes explicitly.
- Confirm that all fixtures and screenshots are synthetic.

By contributing, you agree that your work is licensed under the repository's MIT License.
