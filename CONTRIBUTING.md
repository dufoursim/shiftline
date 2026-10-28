# Contributing

Thanks for helping! Issues and pull requests are welcome, in English or French.

## Before you open a pull request

```bash
npm install
```

```bash
npm test
```

```bash
npm run test:gate
```

Both must pass. Please add a test for any behaviour you change.

## Guidelines

- **Keep the gate small and strict.** `server/ami-gate.py` uses the Python standard library only,
  so it is easy to audit. Any new AMI action needs a clear reason, an explicit parameter list and
  tests for what it refuses.
- **No secrets, real names, hostnames or IDs** in code, tests or docs: use the examples
  (`pbx-api.example.com`, extensions `201`, `202`…).
- **User-facing texts** go in `src/messages.js`, in both English and French.
- Match the existing style: small functions, a comment that says *why* when it is not obvious.

## Reporting a security issue

See [SECURITY.md](SECURITY.md): please do not open a public issue.
