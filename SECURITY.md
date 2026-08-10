# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the repository owner privately before public disclosure. Do not open a public issue containing exploit details, credentials, private contracts, client messages, or provider payloads.

Include a concise description, affected version or commit, reproduction using synthetic data, and the likely impact. Maintainers should acknowledge a complete report within five business days.

## Supported versions

Security fixes are applied to the latest version on the default branch.

## Security boundaries

ScopeGuard is designed to keep API credentials server-side, avoid request-body persistence and logging, treat document content as untrusted prompt data, constrain model output, and verify source quotations. It does not authenticate users or provide shared/distributed rate limiting by itself.

Deployers are responsible for HTTPS, access control, provider/data-retention configuration, secret management, edge rate limiting, infrastructure logs, dependency updates, and incident response. Model output is untrusted drafting assistance and is not a legal conclusion.
