# Decisions

## D-001: Fail-fast config validation

Context: a missing or malformed env var otherwise fails mysteriously on first use.
Options considered: read process.env directly; validate everything at boot.
Decision: zod schema in config.js; the process exits at boot naming the variable and the reason, never its value.
Why: a crash at boot is obvious; a failure on the first login is not.
What would change this: many optional features that need lazy config.

## D-002: Atlas network access open to 0.0.0.0/0

Context: Render free has no fixed outbound IP, so an IP allowlist is impossible.
Options considered: IP allowlist; allow all IPs; a plan with fixed outbound IPs or private networking.
Decision: allow all IPs.
Why: the only zero-cost option that works. Mitigations: long generated password, DB user limited to readWrite on the askarepo database only, TLS enforced by Atlas.
What would change this: a hosting plan with fixed outbound IPs or private networking.
