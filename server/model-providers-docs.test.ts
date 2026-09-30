// The "Other model providers" docs page tells people how to use OpenRouter,
// Fireworks AI, DeepSeek and Cline before OpenMausBot has a screen for them.
// Each workaround it gives depends on a detail of today's code, so each one
// is pinned here to that code. When one of these fails, the behaviour moved:
// update apps/docs/content/docs/providers/model-providers.mdx with it.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV, stripWorkspaceCredentialEnv } from "./config.ts";
import { discoverOpenCodeModels, ensureOpenCodeInjectModel, resetOpenCodeModelCache } from "./drivers/acp/opencode-go.ts";
import { readClaudeAuthSettings, readClaudeModelCatalog } from "./drivers/claude.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = readFileSync(join(ROOT, "apps", "docs", "content", "docs", "providers", "model-providers.mdx"), "utf8");
const EN = JSON.parse(readFileSync(join(ROOT, "src", "locales", "en.json"), "utf8")) as Record<string, string>;

/** One section of the page, from its heading to the next heading of the same
 * or a higher level, with line wrapping collapsed so a sentence can be
 * matched whatever its line breaks. */
function section(heading: string): string {
  const lines = PAGE.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === heading);
  expect(start, `the page has no "${heading}" heading`).toBeGreaterThanOrEqual(0);
  const level = heading.indexOf(" ");
  const end = lines.findIndex((line, index) => index > start && /^#+ /u.test(line) && line.indexOf(" ") <= level);
  return flat(lines.slice(start + 1, end < 0 ? undefined : end).join("\n"));
}

const flat = (text: string) => text.replace(/\s+/gu, " ");

const scratchDirs: string[] = [];
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
};

afterEach(async () => {
  resetOpenCodeModelCache();
  for (const dir of scratchDirs.splice(0)) await removeTempDir(dir);
});

describe("Claude Code section", () => {
  // What OpenRouter's or DeepSeek's shell exports look like once copied into
  // the env block, plus FireConnect's header and the model settings the page
  // says are and aren't carried over. Every value is fake.
  const settingsHome = (env: Record<string, string>, extra: Record<string, unknown> = {}) => {
    const home = scratch("omb-docs-claude-");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ ...extra, env }));
    return home;
  };
  const providerEnv = {
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: "sk-or-fake",
    ANTHROPIC_CUSTOM_HEADERS: "X-Fireworks-Api-Key: fw_fake",
    ANTHROPIC_MODEL: "deepseek/deepseek-chat",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek/deepseek-reasoner",
    CLAUDE_CODE_SUBAGENT_MODEL: "deepseek/deepseek-subagent",
  };

  it("sends people to the settings.json env block, which Claude bots carry over", () => {
    const home = settingsHome(providerEnv);

    // The address, the key and FireConnect's key header reach the bot's CLI.
    expect(readClaudeAuthSettings({ HOME: home }).env).toEqual({
      ANTHROPIC_BASE_URL: providerEnv.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: providerEnv.ANTHROPIC_AUTH_TOKEN,
      ANTHROPIC_CUSTOM_HEADERS: providerEnv.ANTHROPIC_CUSTOM_HEADERS,
    });

    const text = section("### Claude Code");
    expect(text).toContain("Put `ANTHROPIC_BASE_URL` and your key in the `env` block of `~/.claude/settings.json`.");
    // OpenRouter's and DeepSeek's guides export in the shell, which the
    // desktop app never sees: the page must not say their guides already
    // wrote the env block.
    expect(text).toContain("OpenRouter's and DeepSeek's guides use shell exports, which the desktop app doesn't see, so copy those lines into the `env` block.");
    expect(text).not.toMatch(/Those guides put/u);
    // Terminal exports on a server are not the advice for Claude.
    expect(text).toContain("On a server, use the `env` block too, not exports in the terminal that starts the server.");
  });

  it("lists ANTHROPIC_MODEL under the picker entry the page names, and nothing else from the file", () => {
    const home = settingsHome(providerEnv, {
      // FireConnect's own picker list, which the page says doesn't show up.
      modelPicker: { options: [{ model: "glm-latest[1m]", label: "GLM" }] },
    });
    const catalog = readClaudeModelCatalog({ HOME: home });
    const custom = catalog.options.filter((option) => option.custom).map((option) => option.id);

    // Custom rows are what the picker shows behind its local-model entry.
    expect(custom).toEqual([providerEnv.ANTHROPIC_MODEL]);
    // The per-tier and subagent model settings never reach a bot, neither in
    // the picker nor in the CLI's settings.
    expect(JSON.stringify(catalog)).not.toContain(providerEnv.ANTHROPIC_DEFAULT_SONNET_MODEL);
    expect(JSON.stringify(catalog)).not.toContain(providerEnv.CLAUDE_CODE_SUBAGENT_MODEL);
    expect(JSON.stringify(catalog)).not.toContain("glm-latest");
    const carried = Object.keys(readClaudeAuthSettings({ HOME: home }).env ?? {});
    expect(carried.filter((key) => /MODEL/u.test(key))).toEqual([]);

    const label = EN["model.useLocal"];
    expect(label).toBe("Use a local model");
    const text = section("### Claude Code");
    expect(text).toContain(`If you also set \`ANTHROPIC_MODEL\` there, that model appears under **${label}** in the Claude model picker; pick it.`);
    expect(text).toContain("FireConnect's model list doesn't show up in OpenMausBot, so add `ANTHROPIC_MODEL` yourself.");
    expect(text).toContain("`ANTHROPIC_DEFAULT_*_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` aren't carried over.");
    // The old, wrong advice: ANTHROPIC_MODEL is carried over as a pick.
    expect(text).not.toMatch(/such as `ANTHROPIC_MODEL`, aren't carried/u);
  });

  it("drops that setup while an Anthropic key is saved in Connections, as the page says", () => {
    const home = settingsHome(providerEnv);
    expect(readClaudeAuthSettings({ HOME: home }, { ANTHROPIC_API_KEY: "connections-fake-key" })).toEqual({});
    expect(section("### Claude Code")).toContain("It applies only while no Anthropic API key is saved in Connections.");
  });
});

describe("OpenCode 2.x section", () => {
  it("says the picker shows only the free models, because today's discovery cannot read 2.x", async () => {
    // Behaves like @opencode/cli 2.0.20: `models --verbose` is an unknown
    // flag, while plain `models` would list the provider the person signed
    // in to.
    const dir = scratch("omb-docs-opencode2-");
    const cli = join(dir, "opencode2.mjs");
    writeFileSync(cli, [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'models' && args.includes('--verbose')) {",
      "  process.stderr.write('ERROR Unrecognized flag: --verbose in command opencode models\\n');",
      "  process.exit(1);",
      "}",
      "if (args[0] === 'models') { process.stdout.write('openrouter/deepseek/deepseek-chat\\n'); process.exit(0); }",
      "process.exit(2);",
      "",
    ].join("\n"));
    chmodSync(cli, 0o755);
    resetOpenCodeModelCache();

    const catalog = await discoverOpenCodeModels({ ...process.env, HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: join(dir, "config"), XDG_DATA_HOME: join(dir, "data") }, cli);
    const ids = catalog.options.map((option) => option.id);
    // Once discovery reads 2.x (batch-1 moves it to an ACP session), this
    // fails: drop the first "Known problems" bullet and the note after step 3
    // of the OpenCode section, then this test.
    const changed = "OpenCode 2.x discovery changed: update the OpenCode 2.x known problems in model-providers.mdx";
    expect(ids, changed).not.toContain("openrouter/deepseek/deepseek-chat");
    expect(ids.length, changed).toBeGreaterThan(0);
    expect(ids.every((id) => id.startsWith("opencode/") && id.endsWith("-free")), changed).toBe(true);

    const text = section("## OpenCode 2.x");
    const problems = text.slice(text.indexOf("Known problems:"));
    expect(problems.indexOf("Until the next update, OpenMausBot can't read 2.x's model list, so the picker shows only OpenCode's free models.")).toBe(
      "Known problems: - ".length,
    );
    expect(problems).toContain("install OpenCode from **Settings → Engines**, which installs 1.x and takes priority.");
    expect(section("### OpenCode")).toContain("On OpenCode 2.x they don't appear yet; see [OpenCode 2.x](#opencode-2x).");
  });
});

describe("OpenCode config file", () => {
  // The provider example on the page, exactly as a reader would paste it.
  const example = () => {
    const block = /```json\n([\s\S]*?)```/u.exec(PAGE.slice(PAGE.indexOf("### OpenCode")));
    expect(block, "the OpenCode section has no json example").not.toBeNull();
    return block![1]!.replace(/^ {3}/gmu, "");
  };
  const configHome = (content: string) => {
    const home = scratch("omb-docs-opencode-json-");
    const dir = join(home, ".config", "opencode");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "opencode.json"), content);
    return { home, path: join(dir, "opencode.json") };
  };
  const addLocalModel = (home: string) => ensureOpenCodeInjectModel("omlx::GLM-5.2-fp8", { HOME: home });

  it("keeps the page's plain-JSON provider when OpenMausBot adds a local model", () => {
    const source = example();
    const pasted = JSON.parse(source) as { provider: Record<string, unknown> };
    const { home, path } = configHome(source);

    expect(addLocalModel(home)).toBe("omlx/GLM-5.2-fp8");
    const after = JSON.parse(readFileSync(path, "utf8")) as { provider: Record<string, unknown> };
    expect(after.provider.myrouter).toEqual(pasted.provider.myrouter);
    expect(after.provider.omlx).toBeTruthy();
  });

  it("loses a provider written with a comment, which is why the page asks for plain JSON", () => {
    const commented = example().replace("\"myrouter\": {", "// my router\n    \"myrouter\": {");
    const { home, path } = configHome(commented);

    addLocalModel(home);
    const after = JSON.parse(readFileSync(path, "utf8")) as { provider: Record<string, unknown> };
    expect(after.provider.myrouter).toBeUndefined();

    expect(section("### OpenCode")).toContain(
      "Keep this file plain JSON, with no comments or trailing commas. OpenMausBot edits it when an OpenCode bot uses a model running on this computer.",
    );
  });
});

describe("Keys exported on a server", () => {
  const exported = ["OPENROUTER_API_KEY", "FIREWORKS_API_KEY", "DEEPSEEK_API_KEY", "CLINE_API_KEY"];

  it("reach every engine, as the page warns", () => {
    // Every engine filters its inherited environment through these two lists
    // (or stripWorkspaceCredentialEnv). None of them names these keys.
    const filtered = new Set<string>([...PROVIDER_CREDENTIAL_ENV, ...WORKSPACE_CREDENTIAL_ENV]);
    expect(exported.filter((name) => filtered.has(name))).toEqual([]);
    const env: Record<string, string | undefined> = Object.fromEntries(exported.map((name) => [name, "fake"]));
    stripWorkspaceCredentialEnv(env);
    expect(Object.keys(env).sort()).toEqual([...exported].sort());

    const text = section("### OpenCode");
    for (const name of exported) expect(text).toContain(`\`${name}\``);
    expect(text).toContain("Keys exported this way reach every engine on that server, and any bot that can run commands can read them.");
  });

  it("promises only what OpenMausBot itself sends", () => {
    const coming = section("## What's coming");
    expect(coming).toContain("OpenMausBot will only send a key to the address it was checked against.");
    expect(coming).not.toContain("A key will only be sent to the address");
  });
});
