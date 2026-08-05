# Security policy

## Supported versions

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue
for an undisclosed vulnerability and do not include credentials, npm tokens, or private package
contents in a report.

Include the affected version, platform, a minimal reproduction, and the impact. You should receive an
initial acknowledgement within seven days.

## Execution model

`package-consumer-check` is not a sandbox. It imports, requires, and runs CLI code from the package
under test. Lifecycle scripts are suppressed by default where supported by npm, but package code still
executes during consumer checks. Only use the tool with packages you trust.

Executed package code inherits the current process environment. Captured stdout and stderr are
bounded but are not secret-redacted, so do not test untrusted code in an environment containing
credentials it could read or print. Process timeouts terminate the direct child but may not terminate
every descendant process on every operating system.

The project has no telemetry and does not intentionally collect or transmit package contents.
