# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use [GitHub private vulnerability reporting](https://github.com/Kucuks/vite-kit/security/advisories/new) and include:

- the affected version or commit;
- a minimal reproduction;
- the expected and observed impact;
- any known workaround.

You should receive an acknowledgement within seven days. A fix, advisory, and release timeline will be shared after the report is reproduced and assessed.

## Supported versions

Until the first stable release, security fixes target the latest published `0.x` version and the `main` branch. Older prerelease versions may require upgrading to receive a fix.

Security-sensitive areas include asset path boundaries and symlinks, environment-variable inlining, dependency externalization, generated output, child-process signaling, and package publication.
