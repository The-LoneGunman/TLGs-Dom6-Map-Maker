# Local braces security patch

Pantokrator Atlas uses this private fork of **braces 3.0.3** in its build and lint dependencies to address [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). It is not an upstream release or a player runtime dependency. On October 14, 2026, the advisory listed no patched upstream release.

## Source and changes

The original seven JavaScript files and MIT license came from the npm `braces` 3.0.3 package. `package.json` records its registry tarball, integrity and upstream commit. The upstream copyright and license remain in [LICENSE](LICENSE); the project's 0BSD license does not replace them. The local package identifies itself as `@pantokrator-atlas/braces` version `3.0.3-atlas.1` and is not published to npm.

The patch adds a fixed limit of **128 nested brace/parenthesis containers**:

- `lib/parse.js` checks combined container depth before accepting another opening brace or parenthesis, including unbalanced patterns. Escaped, quoted and character-class text retains upstream parsing semantics.
- `lib/compile.js`, `lib/expand.js` and `lib/stringify.js` guard recursive traversal, including callers that supply an AST directly. Expansion also bounds parent-chain traversal.
- `lib/depth.js` throws a controlled `SyntaxError` with code `ERR_BRACES_DEPTH`. Caller options cannot increase or disable this cap. As with upstream's existing length/range errors, callers handling untrusted input must catch the error.

The index, constants and utility implementation are unchanged. The normal 10,000-character limit and range-expansion limit are unchanged. This patch addresses recursive nesting, not every possible excessive expansion or resource-exhaustion pattern.

The root development dependency and `$braces` override route every installed consumer to this directory. There is no postinstall mutation, runtime monkey-patch, audit allowlist or spoofed upstream release number. ESLint allows CommonJS imports only within this upstream CommonJS package; its other checks remain enabled.

## Required checks

Run `npm ci`, then `npm run test:vendor`, `npm audit --audit-level=high`, and the normal full release checks. The security tests also run in the full suite and explicitly in Linux and Windows CI. They verify:

- 328 compatibility cases against a digest captured from unmodified upstream 3.0.3, covering compile, expand, stringify and create behavior.
- Boundary depths, mixed braces/parentheses, unbalanced strings, supplied and cyclic ASTs, and option-bypass attempts.
- Rejection of a 4,000-level pattern in an isolated process with a 256 KiB stack. The unpatched version overflowed on that same diagnostic; the patched version also accepts 128 levels there.
- Every installed consumer resolves this fork, not an overlooked registry copy or broken local link.
- Unchanged upstream files and the MIT license retain their normalized SHA-256 hashes.

`npm audit` checks registry dependencies; it does **not** independently certify this private fork. The explicit security tests are required alongside the unchanged audit gate. Review upstream `braces` advisories whenever changing dependencies; the local package name is not an upstream advisory feed.

## Maintenance and removal

Keep the patch limited to the nesting fix. Record any new changes here and update compatibility evidence only after comparing with the upstream behavior. Preserve the MIT notice and regenerate `THIRD_PARTY_LICENSES.txt` when dependency metadata changes.

When upstream publishes a verified fix, test it against the same regression corpus and the full build/lint/launcher suite. Then remove the local root dependency, override, vendored source and scoped CommonJS lint rule, regenerate the lockfile and notices, and adapt the dependency-resolution assertion to require the fixed upstream version. Retain the malicious-input regression cases. Do not remove this patch solely because an audit returns zero findings.
