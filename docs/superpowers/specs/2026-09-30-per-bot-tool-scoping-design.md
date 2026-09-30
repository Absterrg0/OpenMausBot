# Per-bot tool selection for local models

Design for [#2047](https://github.com/milind-soni/OpenMausBot/issues/2047).

## Purpose and acceptance

A Pi or Grok CLI bot using a local model should receive only the tools its
owner selected. A drafting bot can use its engine's read, edit, and write
tools without the computer or teammate catalogs. A mail bot can use a
selected custom MCP server without either built-in catalog. Individual
computer and teammate tools can also be selected.

The contribution must preserve existing bots, enforce selection before
schemas reach the model, and reject excluded calls even when the model
remembers a tool from an earlier turn. Selecting a tool does not approve
its execution or override existing computer, connector, managed-workspace,
guest, or human-approval restrictions.

This design targets complete native-tool and MCP behavior on Pi and Grok
CLI, the two engines in the issue's title and reproductions. The shared
model can support other engines, but their native controls need explicit
adapter support. An unsupported adapter must reject a restricted turn;
it must never silently ignore the selection. The broader proposal to
support every other engine remains separate unless upstream requests it.
The PR must describe that boundary and use `Refs #2047` if the maintainer
considers wider engine support part of closing the issue.

## Current evidence

- Upstream base: `90ffde779f787617d5d7b571e8c06646d09d7eb2`.
- Issue #2047 is open. No active overlapping implementation was found in
  the open-PR search on 2026-09-30. Recheck before publishing.
- Pi's adapter assembles the built-in MCP descriptors but omits
  `integrations.custom`; its extension registers every listed tool.
- Grok CLI mounts custom servers through ACP. Its native selection must
  use a verified ACP-compatible contract, not assumed headless flags.
- The existing result-budget gate is stdio-only and does not filter
  `tools/list` or `tools/call`. Its budget-zero escape hatch cannot become
  a way around tool selection.
- Existing connected-app grants and custom-server selection already have
  their own authority boundaries. They remain authoritative.

These observations establish the integration defects, not successful
execution of a fix. No new behavior has been implemented or validated yet.

## Alternatives and choice

1. **Shared selection with engine adapters and an MCP gate (chosen).** One
   persisted bot field expresses the owner's selection. Pi and Grok apply
   their own native contracts; the MCP boundary filters lists and calls.
   This avoids trusting prompts and keeps permission systems separate.
2. **Engine flags only.** Smaller initially, but cannot consistently scope
   MCP tools and risks Grok accepting flags that ACP does not apply.
3. **Tool search or lazy schemas only.** Reduces some prompt cost but does
   not express which tools a bot may use. It would change more provider
   behavior than this issue requires.

## Data contract

Add optional `toolScope` to the shared bot wire shape and turn input:

```ts
interface ToolScope {
  allow?: string[];
  deny?: string[];
}
```

Selectors name the original tool, before an engine rewrites its name:

- `native:read` for a Pi native or extension tool named `read`.
- `native:read_file` for the corresponding Grok tool.
- `native:*` for the engine's native and extension tools.
- `mcp:computer:<tool-name>` for one computer tool.
- `mcp:agents:<tool-name>` for one teammate tool.
- `mcp:fastmail:*` for the tools from the custom server named `fastmail`.

Only `native:*` and the final MCP tool wildcard have wildcard meaning.
There are no regular expressions or fuzzy, case-insensitive matches.
Server names use the existing validated MCP names. The original tool name
is the remainder after the namespace and server separator, preserving
literal punctuation. Engine aliases are never permission identities.

Semantics:

- Absent scope preserves current behavior.
- Absent `allow` permits existing tools except those matched by `deny`.
- Present `allow`, including an empty list, permits only its matches.
- A matching deny always wins.
- An empty `allow` means no tools; it must not mean inherit everything.
- Clearing the setting is an explicit authenticated owner action.
- Unknown selections never expand to all tools.
- Lists are bounded, deduplicated, and strictly validated. Reject unknown
  object fields, non-string entries, control characters, empty identities,
  and invalid wildcard placement.
- Corrupt persisted scope is retained as a deny-all state with a visible
  recovery error; it must not be discarded into the legacy all-tools default.

The pure parser and matcher live in a dependency-free shared module so the
standalone Pi helper and bundled server use the same semantics.

## Persistence and owner authority

Carry the field through bot loading, wire projection, PATCH, duplication,
and owner-created defaults. Export/import must preserve a restriction or
land disabled, following existing portability rules; an import must never
turn a restricted bot into unrestricted authority. Do not export credentials
or connected-app grants.

Bot-driven profile proposals cannot change tool scope. Existing authenticated
settings routes own this mutation. Reject changes while a bot has an active
turn, and recheck current bot/owner authority immediately before committing.
Resetting or widening a selection uses the existing trusted-setting boundary.

Snapshot the validated scope into every dispatch path, including room and
teammate turns. No direct, queued, resumed, or group path can omit it.

## Turn assembly and MCP enforcement

1. Apply current integration availability, computer-off, managed policy,
   server selection, and connected-app grants as today.
2. Remove a server when the scope cannot allow any of its tools. Use the
   available built-in teammate catalog to avoid mounting a denied agents
   server. A filtered discovery must not advertise an empty server catalog
   as useful tooling.
3. Give every remaining MCP server a scope-enforcing boundary. Filter all
   `tools/list` pages before schemas are handed to the engine. Preserve
   pagination and protocol errors without exposing withheld definitions.
4. Reject an excluded `tools/call` locally before the upstream sees it.
   Check raw server/tool identity, not a sanitized provider function name.
5. Apply the same rule to stdio, Streamable HTTP, and legacy SSE servers.
   Reuse the existing remote MCP client for a stdio facade; do not add a
   runtime dependency. Preserve authentication headers and cancellation.
6. An explicit scope requires the gate even with result budget zero.
   Malformed gate configuration terminates the restricted connection.
7. Credential-bearing configuration stays in the existing private config
   file or process environment. Never place it on argv or in diagnostics.

Catalog changes, malformed frames, unsupported transports, connection
failure, and alias collisions must not reopen access. Helpers dispose only
their own upstream processes and sessions.

## Pi integration

- Mount selected custom servers, including URL-backed servers through the
  shared facade. Declare custom-MCP capability only after this path works.
- Filter MCP tools before schema conversion and `registerTool`.
- Load the scope extension even when no MCP servers remain, because native
  tools still need filtering.
- Intersect the scope with Pi's active tools through the verified extension
  API before the first request and after session/model restoration. Never
  reactivate a tool another extension or Pi configuration disabled.
- Check the scope in the native `tool_call` hook and again in registered MCP
  execution. Tool aliases and package tools keep their original identities.
- Preserve the existing host-control confirmation. Custom MCP calls use the
  normal human approval path and do not become pre-approved.
- Missing extension enforcement API or malformed scope stops the restricted
  turn with a setup error before a provider request.

The exact supported Pi versions are determined by real CLI verification.
Current primary documentation describes active-tool and call hooks:
[Pi extension API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
Do not infer support in an older installed runtime from those current docs.

## Grok CLI integration

Use a session-scoped, ACP-compatible native filter whose behavior is proven
with the installed official CLI. Grok profiles alone are insufficient if
an empty list means inherit-all or an unknown tool falls back to the full
catalog. The implementation must preserve an existing engine profile's
restrictions and intersect them with the bot's scope.

Verification must cover empty allowlists, unknown names, native execution
denial, MCP-only bots, and restored sessions. If a runtime cannot represent
the scope safely, reject the restricted turn before contacting the model
and explain the required runtime support. Do not silently approximate it.

Include scope in the ACP session fingerprint and apply it on both new and
resumed sessions. A changed scope must retire stale pooled tool state.
The shared MCP gate remains the authority for individual MCP calls.

Primary contracts to verify, with source revision recorded in test evidence:
[Grok agent profiles](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-agent/src/config.rs),
[Grok assembly filters](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-agent/src/builder.rs),
[Grok ACP guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md).

## Settings surface

Add a small Tool selection section to the existing bot Access settings.
Offer all current tools or a custom selection, with Allow and Exclude lists,
one identity per line. Show examples appropriate to the selected engine and
links to concise project documentation. Reuse the existing custom-server
selection card and existing save/error/busy behavior.

The UI must say that selection narrows available tools and that existing
approvals still apply. Preserve an explicit empty allowlist and clearly show
the no-tools state. Never label an unsupported engine as protected. Keep
technical selectors confined to this advanced setting; do not add onboarding,
new account flows, or automatic model downloads.

Capture before and after screenshots of the real isolated settings fixture.
Do not use live bot data, private accounts, or mock HTML as execution proof.

## Validation and release gates

Write behavioral regression tests before implementation:

- Legacy bots retain their previous catalog; an empty scope permits no tools.
- Deny precedence, raw-name collisions, unknown/malformed selections, and
  corrupt persisted configuration fail closed.
- Scope persists after restart and reaches direct and group turns.
- A mail-only Pi bot receives its custom MCP tools and no computer/agents
  schemas; a drafter receives only selected native tools.
- Real MCP fixtures paginate lists and record calls. A withheld call creates
  no upstream execution marker, for stdio and remote transports.
- Pi/Grok native enforcement is tested at the provider boundary and execution
  boundary, including resumed sessions and cancellation.
- Restricted catalog byte counts and tool counts are measured before/after
  with the same fixture. Estimates are not reported as measured tokens.
- Settings interaction saves the intended policy and handles errors, busy
  bots, and switching between bots without applying another bot's scope.

Run targeted tests first, then the required typecheck, lint, full tests,
Electron checks, locale checks for new strings, and fork CI. Reconcile any
baseline failure on unchanged main and document the exact evidence.

Live validation uses isolated HOME/data directories, disposable MCP tools,
and a small real local model. Complete actual Pi and Grok turns for a native
drafting task and a custom-MCP task. Record model/runtime versions, context
limit, exact schemas sent, results, and observed RAM usage. No user data or
cloud credentials are needed. Fake-engine proof is reported separately.

Before publishing, review the full diff for unrelated changes, generated
output, secrets, machine paths, dependencies, and release configuration.
Open a draft PR only when the supported behavior and evidence are reviewable;
attach it to the Codex task. Never merge it.

## Deliberately excluded

- A new onboarding flow, task-specific automatic tool discovery, or model
  routing and downloading UI.
- A shell/filesystem sandbox. Removing a tool is not a general OS sandbox.
- Redesign of connected-app grants, branding, or unrelated provider behavior.
- Unsupported native-provider guarantees or untested physical-device claims.
- Other projects' code, data, device shutdowns, or configuration without
  the owner's explicit authorization.
