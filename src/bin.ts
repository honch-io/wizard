#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { parseOptions } from "./cli/options.js";
import { App } from "./ui/App.js";

const options = parseOptions(process.argv.slice(2), process.env);

if (options.help) {
  process.stdout.write(`honcho

Agent-powered Honch SDK setup.

Options:
  --install-dir <path>    Client project directory
  --target <target>       esp-idf, c-posix, or micropython
  --api-base-url <url>    Honch platform API base URL
  --yes, -y               Skip confirmation prompts when inputs are complete
  --help, -h              Show this help
`);
  process.exit(0);
}

render(React.createElement(App, { options }));
