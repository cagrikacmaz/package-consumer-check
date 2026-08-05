#!/usr/bin/env node
if (process.argv.includes("--help")) console.log("fixture-dual help");
else if (process.argv.includes("--version")) console.log("1.2.3");
else process.exitCode = 3;
