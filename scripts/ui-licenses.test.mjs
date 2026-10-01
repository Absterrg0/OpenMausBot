import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

it("ships unchanged noVNC notices and a source pointer with the built UI", () => {
  const fixture = mkdtempSync(join(tmpdir(), "omb-ui-licenses-"));
  try {
    mkdirSync(join(fixture, "scripts"));
    cpSync(join(root, "scripts/copy-ui-licenses.mjs"), join(fixture, "scripts/copy-ui-licenses.mjs"));
    cpSync(join(root, "third_party/novnc"), join(fixture, "third_party/novnc"), { recursive: true });
    execFileSync(process.execPath, [join(fixture, "scripts/copy-ui-licenses.mjs")]);
    const notices = readdirSync(join(root, "third_party/novnc"));
    expect(notices).toContain("LICENSE.MPL-2.0");
    for (const name of notices) {
      expect(readFileSync(join(fixture, "dist/licenses/novnc", name)))
        .toEqual(readFileSync(join(root, "third_party/novnc", name)));
    }
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies["@novnc/novnc"];
    expect(readFileSync(join(fixture, "dist/licenses/novnc/NOTICE.txt"), "utf8"))
      .toContain(`https://github.com/novnc/noVNC/tree/v${version}`);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
