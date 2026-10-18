import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  compareVersions,
  anonymousEnvironment,
  packageName,
  publicationAction,
  publicationEvent,
  firstPublicationPolicy,
  shouldPromoteDefault,
  publicManifest,
  publicReadme,
  publicSource,
  registry,
  releaseVersion,
  validatePack,
  verifySnapshot,
} from "./npm-release.mjs";

const manifest = {
  name: packageName,
  version: "1.0.0-Q.1",
  repository: {
    type: "git",
    url: "git+https://github.com/myoonhq/tungsten.git",
  },
  publishConfig: { registry: "https://npm.pkg.github.com" },
};
const record = (version = manifest.version) => ({
  name: packageName,
  version,
  channel: releaseVersion(version).channel,
  integrity: "sha512-same",
});
const metadata = (versions, tags = {}) => ({
  versions: Object.fromEntries(
    versions.map((version) => [
      version,
      { dist: { integrity: "sha512-same" } },
    ]),
  ),
  "dist-tags": tags,
});

test("public consumer installs cannot inherit publisher credentials or private registry config", () => {
  const env = anonymousEnvironment(
    {
      PATH: "/bin",
      NODE_AUTH_TOKEN: "test-only",
      NPM_TOKEN: "test-only",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-only",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid",
      npm_config_userconfig: "/private/npmrc",
      NPM_CONFIG_GLOBALCONFIG: "/private/global",
      npm_config_registry: "https://private.invalid",
      npm_config_cache: "/tmp/cache",
    },
    "/tmp/consumer",
  );
  assert.equal(env.NODE_AUTH_TOKEN, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(env.npm_config_registry, undefined);
  assert.equal(env.npm_config_userconfig, undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG, "/tmp/consumer/anonymous-npmrc");
  assert.equal(env.NPM_CONFIG_GLOBALCONFIG, "/tmp/consumer/global-npmrc");
  assert.equal(env.npm_config_cache, "/tmp/cache");
});

test("first prereleases are blocked unless the npm initial-latest exception was explicitly approved", () => {
  for (const version of ["1.0.0-Q.1", "1.0.0-D.1"]) {
    assert.throws(
      () => firstPublicationPolicy(version, false, false),
      /First prerelease publication is blocked/,
    );
    assert.doesNotThrow(() => firstPublicationPolicy(version, false, true));
    assert.doesNotThrow(() => firstPublicationPolicy(version, true, false));
  }
  assert.doesNotThrow(() => firstPublicationPolicy("1.0.0", false, false));
});

test("manual and automatic publications use the selected tag and reject branches or mismatched artifacts", () => {
  const artifact = {
    ...record(),
    filename: "myoon-tungsten-1.0.0-Q.1.tgz",
    sourceSha: "a".repeat(40),
  };
  for (const event of ["push", "workflow_dispatch"]) {
    const env = {
      GITHUB_REPOSITORY: "myoonhq/tungsten",
      GITHUB_EVENT_NAME: event,
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: artifact.version,
      GITHUB_SHA: artifact.sourceSha,
      EXPECTED_SOURCE_SHA: artifact.sourceSha,
    };
    assert.deepEqual(publicationEvent(artifact, env), {
      tag: artifact.version,
    });
    for (const mutation of [
      { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_REPOSITORY: "other/fork" },
      { EXPECTED_SOURCE_SHA: "b".repeat(40) },
      { GITHUB_SHA: "b".repeat(40) },
      { GITHUB_REF_NAME: "1.0.0" },
    ])
      assert.throws(() => publicationEvent(artifact, { ...env, ...mutation }));
    assert.throws(() =>
      publicationEvent({ ...artifact, name: "@myoonhq/tungsten" }, env),
    );
    assert.throws(() =>
      publicationEvent(
        { ...artifact, filename: "myoon-tungsten-1.0.0.tgz" },
        env,
      ),
    );
  }
});

test("D and Q are installable public channels, and only stable targets latest", () => {
  for (const [version, channel] of [
    ["1.1.0-D.2", "dev"],
    ["1.0.0-Q.1", "next"],
    ["1.0.0", "latest"],
  ]) {
    assert.equal(releaseVersion(version).channel, channel);
    assert.equal(publicationAction(record(version), {}), "publish");
  }
  for (const invalid of [
    "1.0.0-dev.gabc",
    "1.0.0-Q.0",
    "1.0.0-D.01",
    "1.0.0-q.1",
    "v1.0.0",
    "01.0.0",
  ])
    assert.throws(() => releaseVersion(invalid));
  for (const [older, newer] of [
    ["1.0.0-D.99", "1.0.0-Q.1"],
    ["1.0.0-Q.2", "1.0.0-Q.10"],
    ["1.0.0-Q.99", "1.0.0"],
    ["1.0.0", "1.1.0-D.1"],
  ]) {
    assert.equal(compareVersions(older, newer), -1);
    assert.equal(compareVersions(newer, older), 1);
  }
});

test("out-of-order releases and retries cannot move any public channel backwards", () => {
  for (const [older, newer, channel] of [
    ["1.0.0", "1.0.1", "latest"],
    ["1.0.0-Q.1", "1.0.0-Q.2", "next"],
    ["1.1.0-D.1", "1.1.0-D.2", "dev"],
  ]) {
    assert.throws(
      () =>
        publicationAction(
          record(older),
          metadata([newer], { [channel]: newer }),
        ),
      /backwards/,
    );
    assert.equal(
      publicationAction(
        record(older),
        metadata([older, newer], { [channel]: newer }),
      ),
      "skip",
    );
  }
  // Even an accidentally stale latest tag cannot allow an older stable publish.
  assert.throws(
    () =>
      publicationAction(
        record("1.0.1"),
        metadata(["1.0.0", "1.0.2"], { latest: "1.0.0" }),
      ),
    /backwards/,
  );
});

test("existing immutable artifacts are reused only with matching bytes; interrupted tag promotion can recover", () => {
  assert.equal(
    publicationAction(
      record(),
      metadata([manifest.version], { next: manifest.version }),
    ),
    "skip",
  );
  assert.equal(
    publicationAction(record(), metadata([manifest.version])),
    "promote",
  );
  assert.throws(
    () =>
      publicationAction(
        { ...record(), integrity: "sha512-different" },
        metadata([manifest.version]),
      ),
    /different artifact/,
  );
  assert.throws(
    () => publicationAction({ ...record(), channel: "latest" }, {}),
    /channel mismatch/,
  );
  // New prereleases leave an existing stable latest entirely outside their channel.
  assert.equal(
    publicationAction(
      record("2.0.0-Q.1"),
      metadata(["1.0.0"], { latest: "1.0.0" }),
    ),
    "publish",
  );
});

test("only public distribution metadata is normalized, without mutating the private manifest", () => {
  const publicPackage = publicManifest(manifest, "myoonhq/tungsten");
  assert.deepEqual(publicPackage.publishConfig, { registry, access: "public" });
  assert.equal(manifest.publishConfig.registry, "https://npm.pkg.github.com");
  assert.equal(publicPackage.version, manifest.version);
  assert.equal(publicPackage.name, "@myoon/tungsten");
  const legacy = { ...manifest, name: "@myoonhq/tungsten" };
  assert.equal(
    publicManifest(legacy, "myoonhq/tungsten").name,
    "@myoon/tungsten",
  );
  assert.equal(legacy.name, "@myoonhq/tungsten");
  assert.throws(
    () =>
      publicManifest(
        { ...manifest, name: "@other/tungsten" },
        "myoonhq/tungsten",
      ),
    /package name/,
  );
  assert.equal(
    publicSource(
      "import '@myoonhq/tungsten/react'; // github.com/myoonhq/tungsten",
    ),
    "import '@myoon/tungsten/react'; // github.com/myoonhq/tungsten",
  );
  assert.throws(() => publicManifest(manifest, "other/fork"), /repository/);
  assert.throws(
    () => publicManifest({ ...manifest, private: true }, "myoonhq/tungsten"),
    /private/,
  );
  assert.throws(
    () =>
      publicManifest(
        { ...manifest, publishConfig: { registry: "https://unexpected.test" } },
        "myoonhq/tungsten",
      ),
    /registry/,
  );
  const readme = publicReadme(
    "# Tungsten\nInvited Q builds require private auth.\n```tsx\nexample\n```",
  );
  assert.match(readme, /npm install @myoon\/tungsten\n/);
  assert.doesNotMatch(readme, /require private auth/);
  assert.match(readme, /```tsx\nexample/);
  assert.equal(
    publicReadme("npm install @myoonhq/tungsten\n", "1.0.0-Q.1"),
    "npm install @myoon/tungsten\n",
  );
  assert.equal(
    publicReadme("npm install @myoonhq/tungsten bootstrap\n", "1.1.0-D.1"),
    "npm install @myoon/tungsten bootstrap\n",
  );
  assert.equal(
    publicReadme("npm install @myoonhq/tungsten\n", "1.0.0"),
    "npm install @myoon/tungsten\n",
  );
});

test("snapshot tampering, path traversal and symlinks are rejected before metadata changes", () => {
  const root = mkdtempSync(resolve(tmpdir(), "tungsten-npm-snapshot-"));
  try {
    mkdirSync(resolve(root, "core"));
    const content = JSON.stringify(manifest);
    writeFileSync(resolve(root, "package.json"), content);
    writeFileSync(
      resolve(root, "core/Cargo.toml"),
      `[package]\nversion = "${manifest.version}"\n`,
    );
    const snapshot = {
      version: manifest.version,
      files: {
        "package.json": createHash("sha256").update(content).digest("hex"),
      },
    };
    const save = (value) =>
      writeFileSync(
        resolve(root, ".tungsten-release.json"),
        JSON.stringify(value),
      );
    save(snapshot);
    assert.equal(verifySnapshot(root).version, manifest.version);
    writeFileSync(resolve(root, "package.json"), content + "\n");
    assert.throws(() => verifySnapshot(root), /hash mismatch/);
    writeFileSync(resolve(root, "package.json"), content);
    save({ ...snapshot, files: { "../package.json": "bad" } });
    assert.throws(() => verifySnapshot(root), /Unsafe/);
    symlinkSync(resolve(root, "package.json"), resolve(root, "alias.json"));
    save({ ...snapshot, files: { "alias.json": "bad" } });
    assert.throws(() => verifySnapshot(root), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packed publication must contain public exports and runtime assets, without development files", () => {
  const paths = [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/assets/engine.worker-123.js",
    "dist/assets/core.wasm",
    "dist/types/index.d.ts",
    "api/src/locales/en.json",
  ];
  const packed = {
    ...record(),
    filename: "myoon-tungsten-1.0.0-Q.1.tgz",
    files: paths.map((path) => ({ path })),
  };
  const pkg = {
    ...manifest,
    exports: {
      "./react": {
        import: "./dist/index.js",
        types: "./dist/types/index.d.ts",
      },
      "./locales/*.json": "./api/src/locales/*.json",
    },
  };
  validatePack(packed, pkg);
  assert.throws(
    () =>
      validatePack(
        {
          ...packed,
          files: packed.files.filter((f) => !f.path.includes("worker")),
        },
        pkg,
      ),
    /worker/,
  );
  assert.throws(
    () =>
      validatePack(
        { ...packed, files: [...packed.files, { path: ".env.production" }] },
        pkg,
      ),
    /private/,
  );
  assert.throws(
    () =>
      validatePack(packed, {
        ...pkg,
        exports: { "./missing": "./missing.js" },
      }),
    /Missing export/,
  );
});

test("versionless installation follows the newest Q until a stable version exists", () => {
  assert.equal(
    shouldPromoteDefault(
      "1.0.0-Q.2",
      metadata(["0.0.0-stage", "1.0.0-Q.1", "1.0.0-Q.2"]),
    ),
    true,
  );
  assert.equal(
    shouldPromoteDefault(
      "1.0.0-Q.2",
      metadata(["1.0.0-Q.1", "1.0.0-Q.2"], { latest: "1.0.0-Q.1" }),
    ),
    true,
  );
  assert.equal(
    shouldPromoteDefault("1.0.0-Q.1", metadata(["1.0.0-Q.1", "1.0.0-Q.2"])),
    false,
  );
  assert.equal(shouldPromoteDefault("1.0.0-Q.3", metadata(["1.0.0"])), false);
  assert.equal(shouldPromoteDefault("1.1.0-Q.1", metadata(["1.0.0"])), false);
  assert.equal(shouldPromoteDefault("1.1.0-D.1", metadata([])), false);
  const files = ["dist", "README.md"];
  assert.equal(
    publicManifest(
      { ...manifest, version: "1.0.0-Q.2", files },
      "myoonhq/tungsten",
    ).files.includes("CHANGELOG.md"),
    true,
  );
  assert.equal(
    publicManifest(
      { ...manifest, version: "1.0.0-Q.1", files },
      "myoonhq/tungsten",
    ).files.includes("CHANGELOG.md"),
    false,
  );
});

test("public README conversion keeps one standard installation command", () => {
  const input =
    "# Tungsten\n\n```sh\nnpm install @myoonhq/tungsten\n```\n\nInvited Q builds require private authentication.\n```tsx\nimport { Tungsten } from '@myoonhq/tungsten/react';\n```";
  const readme = publicReadme(input, "1.0.0-Q.3");
  assert.equal((readme.match(/npm install @myoon\/tungsten/g) ?? []).length, 1);
  assert.match(readme, /from '@myoon\/tungsten\/react'/);
  assert.equal(publicReadme(readme, "1.0.0-Q.3"), readme);
  const duplicated =
    "```sh\nnpm install @myoon/tungsten\n```\n\nPublic packages are distributed through npm. Install Tungsten with:\n\n```sh\nnpm install @myoon/tungsten\n```\n\n";
  assert.equal(
    (publicReadme(duplicated).match(/npm install @myoon\/tungsten/g) ?? [])
      .length,
    1,
  );
});
