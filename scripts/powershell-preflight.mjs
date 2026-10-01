import { preflightPowerShellRuntime } from './lib/powershell-runtime.mjs';

// Shared JSON contract for non-JavaScript fixture runners. No file execution.
console.log(JSON.stringify(preflightPowerShellRuntime()));
