# @hmtuslkn/opencode-mdc-rules

Cursor-compatible project rules for OpenCode, with live rule status in the TUI sidebar.

- OpenCode V1 `>=1.18.29` and OpenCode V2
- Recursively discovers `.opencode/rules/**/*.{md,mdc}`
- Supports Cursor's `alwaysApply`, `globs`, and `description` frontmatter
- Supports manual `@rule` activation and rule/file references
- Watches rules for additions, edits, and removals
- Shows rules applied to the current session in green and inactive rules in red

## Install

### OpenCode V2

After this package is published, install it with OpenCode's plugin manager:

```sh
opencode plugin add @hmtuslkn/opencode-mdc-rules
```

The plugin manager adds the server package to the global OpenCode configuration. V2 discovers and loads the package's `./tui` export automatically, so normal local use does not require a separate `cli.json` entry.

If you configure plugins manually, add the server package to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@hmtuslkn/opencode-mdc-rules"]
}
```

Add the TUI package to the global `cli.json` when it is not installed automatically, or when the CLI connects to an explicitly managed server:

```json
{
  "plugins": ["@hmtuslkn/opencode-mdc-rules"]
}
```

The V2 CLI configuration is global. Its default location is `~/.config/opencode/cli.json`.

For local development, use the repository directory instead of the npm name:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-mdc-rules"]
}
```

### OpenCode V1

V1 object entrypoints require OpenCode `1.18.29` or newer. Install the package from the project directory with:

```sh
opencode plugin @hmtuslkn/opencode-mdc-rules
```

The V1 plugin manager detects both `./server` and `./tui` in the package manifest and automatically updates the project server and TUI configuration files. Use `--global` to install it in the global configuration instead.

For manual configuration, add the server plugin to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@hmtuslkn/opencode-mdc-rules"]
}
```

Add the TUI entrypoint separately in `tui.jsonc` only when configuring manually:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@hmtuslkn/opencode-mdc-rules"]
}
```

V1 server and TUI communication uses a process-owned local status cache. It is intended for a server and TUI running as the same user on the same computer.

## Rules

Create rules below the project root:

```text
.opencode/
└── rules/
    ├── general.md
    ├── backend.mdc
    └── frontend/
        └── react.mdc
```

### Always applied

```md
---
alwaysApply: true
---

- Read relevant files before editing them.
- Never modify generated files.
```

A plain `.md` file without frontmatter is also always applied. This is an intentional extension to Cursor's format.

### File-scoped

```md
---
globs: "src/**/*.{ts,tsx}, !src/generated/**"
alwaysApply: false
---

- Prefer named exports.
- Keep components focused.
```

A glob rule becomes active when a matching file is explicitly attached or is present in successful structured file-tool context. Shell command text is not treated as reliable file context.

### Agent-selected

```md
---
description: Backend service conventions and validation patterns
alwaysApply: false
---

- Validate input at the service boundary.
- Return structured errors.
```

Descriptions are shown to the agent as a catalog. The agent selects a relevant rule through the plugin tool, and the rule body is injected on the next model step. A description alone does not inject the rule.

### Manual

```md
---
alwaysApply: false
---

- Every migration must have `up` and `down` functions.
```

Mention it in the user prompt:

```text
Use @migrations for this change.
```

For duplicate basenames, use the relative rule ID, for example `@database/migrations.mdc`.

### References

An active rule can reference another rule or a project file:

```md
Follow the component structure in @templates/component.tsx.
Also apply @frontend/accessibility.mdc.
```

References are restricted to the project root. Cycles are deduplicated and bounded.

## Sidebar status

The sidebar reflects each rule's current activation state. Valid `alwaysApply: true` rules are active immediately, including before the first model request. Other modes reflect the context assembled for the current session:

```text
Rules · 2/4 active

● general.md
● frontend/react.mdc
● backend.mdc
● review.mdc
```

- Green: the rule is currently active. Always rules are green immediately; other modes become green when selected by the session context.
- Red: the rule was discovered but not included.
- `*`: the active rule changed on disk; the next model request uses the new content.
- `!`: invalid frontmatter or an unreadable rule.

The list shows only each filename. Click a rule to see its complete relative path, mode, activation reason, description, and diagnostic details.
Active rules are listed first. Active and inactive groups are each sorted alphabetically by filename, with the complete relative path used as a stable tie-breaker.

## Options

V2 options use the object plugin form:

```jsonc
{
  "plugins": [
    {
      "package": "@hmtuslkn/opencode-mdc-rules",
      "options": {
        "root": ".",
        "debounceMs": 100,
        "maxFileBytes": 262144,
        "maxReferenceDepth": 8
      }
    }
  ]
}
```

V1 uses its package/options tuple:

```jsonc
{
  "plugin": [
    ["@hmtuslkn/opencode-mdc-rules", { "debounceMs": 100 }]
  ]
}
```

| Option | Default | Purpose |
| --- | ---: | --- |
| `root` | detected project/worktree root | Override the rule root; relative paths resolve from the active OpenCode directory. |
| `debounceMs` | `100` | Delay before reloading filesystem changes. |
| `maxFileBytes` | `262144` | Maximum size of one rule or referenced file. |
| `maxReferenceDepth` | `8` | Maximum recursive rule-reference depth. |

## Development

Requires Bun and Node/npm:

```sh
npm install
npm run check
npm pack --dry-run
```

The test suite covers parsing, glob semantics, activation modes, references, live reloads, session isolation, V1 local status transfer, V1/V2 adapters, and sidebar rendering. The smoke harness in `scripts/smoke.ts` can run an installed package against V1 or V2 with a local deterministic model endpoint; it does not use external credentials.

```sh
bun scripts/smoke.ts v2 /path/to/opencode [/path/to/installed/opencode-mdc-rules]
bun scripts/smoke.ts v1 /path/to/opencode-1.18.29 [/path/to/installed/opencode-mdc-rules]
bun scripts/rpc-smoke.ts /path/to/opencode-v2 [/path/to/installed/opencode-mdc-rules]
bun scripts/install-smoke.ts v2 /path/to/opencode-v2 [/path/to/installed/opencode-mdc-rules]
bun scripts/install-smoke.ts v1 /path/to/opencode-1.18.29 [/path/to/installed/opencode-mdc-rules]
```

The install smoke test serves the package from an isolated temporary npm registry, runs the real version-specific OpenCode plugin install command, and verifies the generated configuration. It does not modify the user's OpenCode configuration.

## Limitations

- V1 TUI status requires the server and TUI to run locally as the same OS user.
- OpenCode V1 versions older than `1.18.29` do not support the package's dual V1/V2 object entrypoint.
- Smart description matching is agent-driven. A model can decide that no described rule is relevant.

## License

MIT
