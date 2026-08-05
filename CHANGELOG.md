# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Packed-directory and supplied-tarball consumer validation
- Clean ESM, CommonJS, TypeScript NodeNext, and Node.js CLI smoke tests
- Structured library results and text/JSON CLI output
- Bounded subprocess diagnostics, timeouts, and ownership-aware cleanup
- Cross-platform unit and integration coverage
- Conservative root-export capability planning, including subpath-only and blocked roots
- Deterministic Node declaration checks using the runtime `@types/node` baseline
- Guaranteed owned-workspace cleanup after unexpected consumer-check failures
- Hardened CLI target inspection and installed npm-bin self-validation
