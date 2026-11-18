# FAQ

## Why is X only "potentially breaking"?

Because whether it breaks depends on what consumers do, and the specification cannot tell. Lowering `maximum` from
100 to 50 only breaks consumers that send 51–100; a new response enum value only breaks consumers that switch over
the values exhaustively. These findings are shown but do not fail the build by default. If your consumers are strict,
make them fail: `policy.failOn: [breaking, potentially-breaking]`, or set the specific behaviour in `analysis`
(e.g. `constraintTightening: breaking`).

## Why is a renamed path parameter not breaking?

`/books/{id}` → `/books/{bookId}` matches exactly the same URLs. Consumers send `/books/42` either way, so the change
is _informational_.

## The finding is wrong. What now?

Accept it with an ignore entry and a reason (it stays visible as _suppressed_), and please open a
[false positive issue](https://github.com/zainkhan-bit/ContractGuard/issues/new/choose) with the two snippets. False
positives are the most important bugs to fix.

## Does "non-breaking" mean my deployment is safe?

No. It means non-breaking _according to the two specifications_, for consumers that follow the base version. If the
implementation does not match the spec, or a change is not expressed in the spec (units, behaviour), ContractGuard
cannot see it. See [What cannot be decided](/concepts/uncertainty).

## How is this different from oasdiff?

oasdiff is the most complete open-source tool and has many more checks. ContractGuard focuses on a smaller set of
rules with a formal model: changes are classified per direction (requests vs responses), uncertainty is reported as
_undetermined_ instead of a guess, every finding has a basis and a fix, and shared-schema changes are grouped by
cause. The repository publishes a differential comparison of both tools on real API histories.

## Can it check a spec that does not exist yet on main?

In the GitHub Action, a new specification passes with a notice ("new specification, nothing to compare yet"). On the
command line, a missing base file is an input error (exit code 2), so a typo in a path cannot pass silently.

## Does it send my API to a server?

No. Everything runs locally. Remote `$ref`s are only fetched when you allow specific hosts, and in CI only with an
extra opt-in flag. Telemetry does not exist.

## Which versions are supported?

OpenAPI 3.0.x and 3.1.x on Node.js 24 or later. OpenAPI 3.2 and Swagger 2.0 are not supported in 1.0.
