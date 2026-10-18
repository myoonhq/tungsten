import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const registry = "https://registry.npmjs.org";
export const packageName = "@myoon/tungsten";
const legacyPackageName = "@myoonhq/tungsten";

export const publicSource = (content) =>
  content.replaceAll(legacyPackageName, packageName);
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([DQ])\.([1-9]\d*))?$/;

export function releaseVersion(version) {
  const match = versionPattern.exec(version);
  if (!match)
    throw new Error(`Not an intentional D/Q/stable release: ${version}`);
  return {
    parts: match.slice(1, 4).map(BigInt),
    stage: match[4] ?? null,
    revision: BigInt(match[5] ?? 0),
    channel: match[4] === "D" ? "dev" : match[4] === "Q" ? "next" : "latest",
  };
}

export function compareVersions(left, right) {
  const a = releaseVersion(left),
    b = releaseVersion(right);
  const rank = { D: 0, Q: 1, null: 2 };
  const aa = [...a.parts, BigInt(rank[a.stage]), a.revision];
  const bb = [...b.parts, BigInt(rank[b.stage]), b.revision];
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}

export function publicReadme(content, version) {
  if (version) releaseVersion(version);
  return publicSource(content).replace(
    /Invited Q builds[\s\S]*?(?=```tsx)/,
    "Public packages are distributed through npm. Install Tungsten with:\n\n" +
      "```sh\nnpm install @myoon/tungsten\n```\n\n" +
      "The default installation initially provides a qualification release during public testing, then follows stable releases.\n" +
      "To opt into newer testing releases, use `@next`; development releases use `@dev`.\n" +
      "No private registry configuration or access token is needed by consumers.\n\n",
  );
}

export function publicManifest(manifest, repository) {
  releaseVersion(manifest.version);
  if (
    ![packageName, legacyPackageName].includes(manifest.name) ||
    manifest.private
  )
    throw new Error("Unexpected package name or private package");
  if (
    repository !== "myoonhq/tungsten" ||
    manifest.repository?.url !== `git+https://github.com/${repository}.git`
  )
    throw new Error("Package repository must be myoonhq/tungsten");
  const previousRegistry = manifest.publishConfig?.registry;
  if (
    previousRegistry &&
    ![registry, "https://npm.pkg.github.com"].includes(previousRegistry)
  )
    throw new Error("Unexpected publication registry");
  // Older immutable source snapshots still contain the private registry setting.
  // Only distribution metadata is normalized in the disposable build checkout.
  return {
    ...manifest,
    name: packageName,
    publishConfig: { registry, access: "public" },
  };
}

export function verifySnapshot(root) {
  const snapshot = JSON.parse(
    readFileSync(resolve(root, ".tungsten-release.json"), "utf8"),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  releaseVersion(snapshot.version);
  if (
    snapshot.version !== manifest.version ||
    !Object.keys(snapshot.files ?? {}).length
  )
    throw new Error("Snapshot/package version mismatch or empty snapshot");
  for (const [path, expected] of Object.entries(snapshot.files)) {
    if (
      !/^[\w./-]+$/.test(path) ||
      path.startsWith("/") ||
      path.split("/").some((part) => ["", ".", "..", ".git"].includes(part))
    )
      throw new Error(`Unsafe snapshot path: ${path}`);
    let file = root;
    for (const part of path.split("/")) {
      file = resolve(file, part);
      if (lstatSync(file).isSymbolicLink())
        throw new Error(`Snapshot symlink: ${path}`);
    }
    const actual = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    if (actual !== expected) throw new Error(`Snapshot hash mismatch: ${path}`);
  }
  const cargo = readFileSync(resolve(root, "core/Cargo.toml"), "utf8").match(
    /^version = "([^"]+)"/m,
  )?.[1];
  if (cargo !== manifest.version) throw new Error("Rust/npm versions differ");
  return manifest;
}

const run = (command, args, cwd = process.cwd(), env = process.env) =>
  execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
const output = (values) => {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
};

function prepare() {
  const root = process.cwd();
  const manifest = verifySnapshot(root);
  if (
    process.env.GITHUB_REPOSITORY !== "myoonhq/tungsten" ||
    process.env.GITHUB_REF_TYPE !== "tag" ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Select a version tag to publish; branch runs are not supported",
    );
  const tag = process.env.GITHUB_REF_NAME;
  releaseVersion(tag);
  const sourceSha = run("git", ["rev-parse", "HEAD"]).trim();
  if (
    tag !== manifest.version ||
    run("git", ["rev-parse", `refs/tags/${tag}^{commit}`]).trim() !==
      sourceSha ||
    sourceSha !== process.env.GITHUB_SHA
  )
    throw new Error("Release tag, checkout and package version must match");
  run("git", ["merge-base", "--is-ancestor", sourceSha, "origin/main"]);
  // Verify the immutable snapshot first; normalize names only in this disposable checkout.
  const snapshot = JSON.parse(
    readFileSync(resolve(root, ".tungsten-release.json"), "utf8"),
  );
  for (const path of Object.keys(snapshot.files)) {
    const file = resolve(root, path);
    const content = readFileSync(file, "utf8");
    const normalized = publicSource(content);
    if (normalized !== content) writeFileSync(file, normalized);
  }
  writeFileSync(
    "package.json",
    JSON.stringify(
      publicManifest(manifest, process.env.GITHUB_REPOSITORY),
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    "README.md",
    publicReadme(readFileSync("README.md", "utf8"), manifest.version),
  );
  output({
    version: manifest.version,
    channel: releaseVersion(manifest.version).channel,
    source_sha: sourceSha,
  });
}

export function validatePack(pack, manifest) {
  if (
    pack.name !== packageName ||
    pack.version !== manifest.version ||
    !/^myoon-tungsten-[\w.-]+\.tgz$/.test(pack.filename) ||
    !pack.integrity?.startsWith("sha512-")
  )
    throw new Error("Unexpected packed artifact");
  const files = new Set(pack.files.map((file) => file.path));
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
  ]) {
    if (!files.has(required))
      throw new Error(`Missing package file: ${required}`);
  }
  function checkExport(value) {
    if (typeof value === "object")
      return Object.values(value).forEach(checkExport);
    if (
      typeof value !== "string" ||
      !value.startsWith("./") ||
      value.includes("..")
    )
      throw new Error("Invalid package export");
    const pattern = new RegExp(
      "^" +
        value
          .slice(2)
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    );
    if (![...files].some((file) => pattern.test(file)))
      throw new Error(`Missing export: ${value}`);
  }
  Object.values(manifest.exports ?? {}).forEach(checkExport);
  if (![...files].some((file) => /^dist\/.*worker.*\.js$/.test(file)))
    throw new Error("Missing distributed worker asset");
  for (const file of files) {
    if (
      /(^|\/)(node_modules|\.git|\.github|\.env[^/]*|test-results|playwright-report)(\/|$)/.test(
        file,
      ) ||
      /^(core|testing|framework)\//.test(file)
    )
      throw new Error(`Development/private file in package: ${file}`);
  }
}

function pack() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  mkdirSync("npm-release", { recursive: true });
  const packed = JSON.parse(
    run("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      "npm-release",
    ]),
  )[0];
  validatePack(packed, manifest);
  const worker = packed.files.find((file) =>
    /^dist\/.*worker.*\.js$/.test(file.path),
  );
  const embeddedWasm = readFileSync(worker.path, "utf8").includes(
    "data:application/wasm;base64,",
  );
  if (
    !embeddedWasm &&
    !packed.files.some((file) => /^dist\/.*\.wasm$/.test(file.path))
  )
    throw new Error(
      "Worker has neither embedded WASM nor a distributed WASM asset",
    );
  writeFileSync(
    "npm-release/release.json",
    JSON.stringify(
      {
        name: packageName,
        version: manifest.version,
        channel: releaseVersion(manifest.version).channel,
        filename: packed.filename,
        integrity: packed.integrity,
        sourceSha: run("git", ["rev-parse", "HEAD"]).trim(),
      },
      null,
      2,
    ) + "\n",
  );
}

export function anonymousEnvironment(source, directory) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (
      /^(NODE_AUTH_TOKEN|NPM_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/i.test(
        key,
      ) ||
      /^npm_config_(userconfig|globalconfig|.*registry|.*auth.*)$/i.test(key)
    )
      delete env[key];
  }
  env.NPM_CONFIG_USERCONFIG = resolve(directory, "anonymous-npmrc");
  env.NPM_CONFIG_GLOBALCONFIG = resolve(directory, "global-npmrc");
  return env;
}

function consumer(spec) {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const dir = mkdtempSync(resolve(tmpdir(), "tungsten-npm-consumer-"));
  try {
    // Isolate the install from workspace/private registry configuration and tokens.
    writeFileSync(
      resolve(dir, ".npmrc"),
      `registry=${registry}\n@myoon:registry=${registry}\n`,
    );
    writeFileSync(resolve(dir, "anonymous-npmrc"), `registry=${registry}\n`);
    writeFileSync(resolve(dir, "global-npmrc"), "");
    const env = anonymousEnvironment(process.env, dir);
    const execute = (command, args) => run(command, args, dir, env);
    writeFileSync(
      resolve(dir, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          [packageName]: spec,
          react: manifest.devDependencies.react,
          "react-dom": manifest.devDependencies["react-dom"],
        },
        devDependencies: {
          typescript: manifest.devDependencies.typescript,
          vite: manifest.devDependencies.vite,
          "@types/react": manifest.devDependencies["@types/react"],
          "@types/react-dom": manifest.devDependencies["@types/react-dom"],
        },
      }),
    );
    execute("npm", [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ]);
    for (const name of [
      "bootstrap",
      "@mui/material",
      "@emotion/react",
      "@emotion/styled",
    ])
      if (existsSync(resolve(dir, "node_modules", name)))
        throw new Error(`Default consumer unexpectedly installs ${name}`);
    const installed = JSON.parse(
      readFileSync(
        resolve(dir, "node_modules", packageName, "package.json"),
        "utf8",
      ),
    );
    if (installed.version !== manifest.version)
      throw new Error("Installed unexpected version");
    writeFileSync(
      resolve(dir, "index.html"),
      '<div id="root"></div><script type="module" src="/main.tsx"></script>',
    );
    writeFileSync(
      resolve(dir, "main.tsx"),
      `import { createRoot } from 'react-dom/client';
import { Tungsten, TungstenEditor, type TungstenSchema } from '@myoon/tungsten/react';
import '@myoon/tungsten/react/design/tungsten.css';
const schema: TungstenSchema = { schemaVersion: 'sprout', form: [{ type: 'text', key: 'name' }] };
createRoot(document.getElementById('root')!).render(<><Tungsten schema={schema}/><TungstenEditor initialSchema={schema}/></>);`,
    );
    writeFileSync(
      resolve(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023", "DOM"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          types: ["vite/client"],
        },
        include: ["main.tsx"],
      }),
    );
    writeFileSync(
      resolve(dir, "vite.config.mjs"),
      String.raw`
import { createLogger } from 'vite';
const logger = createLogger();
logger.warn = logger.warnOnce = message => { throw new Error(message); };
export default {
  customLogger: logger,
  plugins: [{ name: 'consumer-size-budget', generateBundle(_options, bundle) {
    for (const file of Object.values(bundle))
      if (file.type === 'chunk' && Buffer.byteLength(file.code) > 500_000)
        this.error(file.fileName + ' exceeds the 500 kB JavaScript budget');
  } }],
  build: { rolldownOptions: { output: { codeSplitting: { groups: [
    { name: 'vendor-react', test: /node_modules\/(?:react|react-dom|scheduler)\// },
  ] } } } },
};
`,
    );
    execute("npm", ["exec", "--", "tsc", "-p", "tsconfig.json"]);
    execute("npm", ["exec", "--", "vite", "build"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function publicationAction(record, metadata) {
  const channel = releaseVersion(record.version).channel;
  if (record.name !== packageName || record.channel !== channel)
    throw new Error("Artifact/channel mismatch");
  const existing = metadata.versions?.[record.version];
  if (existing && existing.dist?.integrity !== record.integrity)
    throw new Error(
      "Immutable npm version already exists with a different artifact",
    );
  const newer = Object.keys(metadata.versions ?? {}).some((version) => {
    try {
      return (
        releaseVersion(version).channel === channel &&
        compareVersions(version, record.version) > 0
      );
    } catch {
      return false;
    }
  });
  const tagged = metadata["dist-tags"]?.[channel];
  if (newer || (tagged && compareVersions(tagged, record.version) > 0)) {
    if (existing) return "skip";
    throw new Error(`Refusing to move ${channel} backwards`);
  }
  return existing
    ? tagged === record.version
      ? "skip"
      : "promote"
    : "publish";
}

export function firstPublicationPolicy(
  version,
  packageExists,
  allowInitialLatest,
) {
  if (!packageExists && releaseVersion(version).stage && !allowInitialLatest)
    throw new Error(
      "First prerelease publication is blocked: npm may also assign latest. Discuss and approve that bootstrap exception before publishing; do not create a placeholder stable release.",
    );
}

export function publicationEvent(record, env) {
  if (
    env.GITHUB_REPOSITORY !== "myoonhq/tungsten" ||
    env.GITHUB_REF_TYPE !== "tag" ||
    !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Publication requires a version tag; branch runs are not supported",
    );
  releaseVersion(env.GITHUB_REF_NAME);
  if (
    record.name !== packageName ||
    record.sourceSha !== env.GITHUB_SHA ||
    (env.EXPECTED_SOURCE_SHA && record.sourceSha !== env.EXPECTED_SOURCE_SHA) ||
    record.version !== env.GITHUB_REF_NAME ||
    record.filename !== `myoon-tungsten-${record.version}.tgz`
  )
    throw new Error(
      "Release artifact does not match the triggering tag/commit",
    );
  return { tag: record.version };
}

async function publish() {
  const record = JSON.parse(readFileSync("npm-release/release.json", "utf8"));
  publicationEvent(record, process.env);
  const archive = resolve("npm-release", record.filename);
  const integrity =
    "sha512-" +
    createHash("sha512").update(readFileSync(archive)).digest("base64");
  if (integrity !== record.integrity)
    throw new Error("Artifact integrity mismatch");
  const manifest = JSON.parse(
    run("tar", ["-xOf", archive, "package/package.json"]),
  );
  publicManifest(manifest, process.env.GITHUB_REPOSITORY);
  if (
    manifest.version !== record.version ||
    manifest.publishConfig?.registry !== registry ||
    manifest.publishConfig?.access !== "public"
  )
    throw new Error("Packed publication metadata differs");
  writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
  const url = `${registry}/${encodeURIComponent(packageName)}`;
  const response = await fetch(url);
  if (!response.ok && response.status !== 404)
    throw new Error(`npm lookup failed: ${response.status}`);
  const metadata = response.status === 404 ? {} : await response.json();
  firstPublicationPolicy(
    record.version,
    response.status !== 404,
    process.env.ALLOW_FIRST_PRERELEASE_LATEST === "true",
  );
  const action = publicationAction(record, metadata);
  if (action === "publish") {
    run("npm", [
      "publish",
      archive,
      "--ignore-scripts",
      "--provenance",
      "--access",
      "public",
      "--tag",
      record.channel,
      "--registry",
      registry,
    ]);
  } else if (action === "promote") {
    run("npm", [
      "dist-tag",
      "add",
      `${packageName}@${record.version}`,
      record.channel,
      "--registry",
      registry,
    ]);
  }
  // Allow npm's metadata cache a bounded propagation interval after publication.
  let confirmed;
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await fetch(`${url}/${record.version}`);
    if (result.ok) {
      confirmed = await result.json();
      if (confirmed.dist?.integrity === record.integrity) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (confirmed?.dist?.integrity !== record.integrity)
    throw new Error("Published registry integrity not confirmed");
  console.log(
    `${action}: ${packageName}@${record.version} (${record.channel})`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const command = process.argv[2];
  if (command === "prepare") prepare();
  else if (command === "pack") pack();
  else if (command === "consumer") {
    const record = JSON.parse(readFileSync("npm-release/release.json", "utf8"));
    consumer(
      process.argv[3] === "registry"
        ? `${packageName}@${record.version}`
        : resolve("npm-release", record.filename),
    );
  } else if (command === "publish") await publish();
  else throw new Error("Expected prepare, pack, consumer or publish");
}
