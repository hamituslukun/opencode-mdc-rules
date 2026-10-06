# Changelog

All notable changes to this project will be documented in this file.

## 1.0.3 - 2026-10-06

- Silently ignore unresolved `@...` references in rule prose, allowing literal agent and skill mentions without rule diagnostics.

## 1.0.2 - 2026-10-06

- Precompile OpenTUI TSX entrypoints so npm-installed plugins retain reactive JSX props.
- Load the generated JavaScript adapters in both OpenCode V1 and V2.

## 1.0.1 - 2026-10-06

- Resolve the V2 sidebar RPC location from synchronized session data instead of falling back to the TUI's default directory.
- Stop displaying an indefinite connecting state when the rules RPC does not respond.
- Cover real-session, location-scoped RPC transport in the V2 smoke test.

## 1.0.0 - 2026-10-06

- Initial public release.
- Support OpenCode V1 and V2.
- Discover and apply Cursor-compatible Markdown and MDC project rules.
- Display live rule activation status in the TUI sidebar.
