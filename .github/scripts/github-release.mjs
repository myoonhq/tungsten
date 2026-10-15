import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareVersions,
  releaseVersion,
  verifySnapshot,
} from "./npm-release.mjs";

export function githubReleasePlan(version, notes, releases) {
  const prerelease = releaseVersion(version).stage !== null;
  if (!notes.startsWith(`## ${version}\n`))
    throw new Error("Release notes/version mismatch");
  const existing = releases.find((release) => release.tag_name === version);
  if (existing) {
    if (
      existing.draft ||
      existing.prerelease !== prerelease ||
      (existing.body ?? "").trim() !== notes.trim()
    )
      throw new Error(
        "Existing GitHub release differs from the immutable snapshot notes",
      );
    return null;
  }
  const newerStable = releases.some((release) => {
    if (release.draft || release.prerelease) return false;
    try {
      return (
        releaseVersion(release.tag_name).stage === null &&
        compareVersions(release.tag_name, version) > 0
      );
    } catch {
      return false;
    }
  });
  return { prerelease, latest: !prerelease && !newerStable };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const tag = process.env.RELEASE_TAG;
  const manifest = verifySnapshot(process.cwd());
  if (tag !== manifest.version)
    throw new Error("Public tag/snapshot version mismatch");
  const snapshot = JSON.parse(readFileSync(".tungsten-release.json", "utf8"));
  if (!snapshot.files["RELEASE_NOTES.md"])
    throw new Error("Release notes are not covered by snapshot hashes");
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  const releases = JSON.parse(
    gh(
      "api",
      "--paginate",
      "--slurp",
      `repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`,
    ),
  ).flat();
  const plan = githubReleasePlan(
    tag,
    readFileSync("RELEASE_NOTES.md", "utf8"),
    releases,
  );
  if (plan)
    gh(
      "release",
      "create",
      tag,
      "--verify-tag",
      "--title",
      `Tungsten ${tag}`,
      "--notes-file",
      "RELEASE_NOTES.md",
      `--latest=${plan.latest}`,
      ...(plan.prerelease ? ["--prerelease"] : []),
    );
  console.log(
    plan
      ? `Created GitHub release ${tag}.`
      : `GitHub release ${tag} already matches.`,
  );
}
