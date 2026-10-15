import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { githubReleasePlan } from "./github-release.mjs";

test("D and Q GitHub releases never become latest; stable advances monotonically", () => {
  const plan = (version, releases = []) =>
    githubReleasePlan(version, `## ${version}\n\nNotes\n`, releases);
  assert.deepEqual(plan("1.1.0-D.1"), { prerelease: true, latest: false });
  assert.deepEqual(plan("1.1.0-Q.1"), { prerelease: true, latest: false });
  assert.deepEqual(
    plan("1.1.0", [{ tag_name: "2.0.0-Q.1", prerelease: true }]),
    { prerelease: false, latest: true },
  );
  assert.equal(plan("1.1.0", [{ tag_name: "1.2.0" }]).latest, false);
  assert.equal(
    plan("1.1.0", [{ tag_name: "1.2.0", draft: true }, { tag_name: "other" }])
      .latest,
    true,
  );
  assert.throws(() => plan("1.1.0-dev.gabc"), /Not an intentional/);
});

test("public CLI verifies snapshot notes and creates the exact tag without npm access", () => {
  const root = mkdtempSync(resolve(tmpdir(), "tungsten-github-release-"));
  try {
    const version = "1.1.0-Q.2";
    const notes = `## ${version}\n\n### Fixes\n\n- Labels\n`;
    const files = {
      "package.json": JSON.stringify({ version }),
      "core/Cargo.toml": `[package]\nversion = "${version}"\n`,
      "RELEASE_NOTES.md": notes,
    };
    const hashes = {};
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(resolve(root, path, ".."), { recursive: true });
      writeFileSync(resolve(root, path), content);
      hashes[path] = createHash("sha256").update(content).digest("hex");
    }
    writeFileSync(
      resolve(root, ".tungsten-release.json"),
      JSON.stringify({ version, files: hashes }),
    );
    const bin = resolve(root, "bin");
    mkdirSync(bin);
    // Fake the external API boundary; no token, network request or real release.
    writeFileSync(
      resolve(bin, "gh"),
      `#!/bin/sh\nif [ "$1" = api ]; then\n  printf '[[]]'\nelse\n  printf '%s\\n' "$@" > "$GH_TEST_ARGUMENTS"\nfi\n`,
      { mode: 0o755 },
    );
    const argsPath = resolve(root, "arguments");
    const invoke = () =>
      spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, "github-release.mjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_TAG: version,
            GITHUB_REPOSITORY: "owner/public",
            GH_TEST_ARGUMENTS: argsPath,
          },
        },
      );
    const result = invoke();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(argsPath, "utf8").trim().split("\n"), [
      "release",
      "create",
      version,
      "--verify-tag",
      "--title",
      `Tungsten ${version}`,
      "--notes-file",
      "RELEASE_NOTES.md",
      "--latest=false",
      "--prerelease",
    ]);
    writeFileSync(resolve(root, "RELEASE_NOTES.md"), "Altered");
    const altered = invoke();
    assert.notEqual(altered.status, 0);
    assert.match(altered.stderr, /Snapshot hash mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retries preserve existing release notes and reject conflicting publication", () => {
  const version = "1.1.0-Q.1",
    notes = `## ${version}\n\nReviewed notes\n`;
  const existing = {
    tag_name: version,
    body: notes,
    prerelease: true,
    draft: false,
  };
  assert.equal(githubReleasePlan(version, notes, [existing]), null);
  for (const change of [
    { body: "Other" },
    { prerelease: false },
    { draft: true },
  ])
    assert.throws(
      () => githubReleasePlan(version, notes, [{ ...existing, ...change }]),
      /differs/,
    );
  assert.throws(() => githubReleasePlan(version, "## 1.0.0\n", []), /mismatch/);
});
