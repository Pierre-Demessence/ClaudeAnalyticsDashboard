/**
 * Run by the release workflow with the pushed tag (`vX.Y.Z`): fails unless `package.json`
 * and `widget/Cargo.toml` carry that version and CHANGELOG.md has a section for it, then
 * prints that section and the version's Docker image, which become the GitHub Release's notes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const repo = join(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(join(repo, path), 'utf8').replaceAll('\r\n', '\n');
}

export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
  if (start === -1)
    throw new Error(`CHANGELOG.md has no "## [${version}]" section.`);
  const length = lines.slice(start + 1).findIndex(line => line.startsWith('## ['));
  const body = lines.slice(start + 1, length === -1 ? undefined : start + 1 + length);
  // The link references at the file's end belong to no version.
  const text = body.filter(line => !/^\[[^\]]+\]: /.test(line)).join('\n').trim();
  if (!text)
    throw new Error(`The "## [${version}]" section of CHANGELOG.md is empty.`);
  return text;
}

// The image the workflow's `image` job pushes; the registry lowercases the owner.
const IMAGE = 'ghcr.io/pierre-demessence/claude-analytics-dashboard';
const IMAGE_PAGE = 'https://github.com/users/Pierre-Demessence/packages/container/package/claude-analytics-dashboard';

/** The GitHub Release's notes: the version's CHANGELOG section, then its Docker image. */
export function releaseNotes(changelog: string, version: string): string {
  return `${changelogSection(changelog, version)}\n\n**Docker image:** [\`${IMAGE}:${version}\`](${IMAGE_PAGE})`;
}

function main(): void {
  const tag = process.argv[2] ?? '';
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match)
    throw new Error(`Expected a tag like v1.2.3, got "${tag}".`);
  const version = match[1];

  const npmVersion = (JSON.parse(read('package.json')) as { version: string }).version;
  const lockVersion = (JSON.parse(read('package-lock.json')) as { version: string }).version;
  const cargoVersion = /^version = "([^"]+)"/m.exec(read('widget/Cargo.toml'))?.[1];
  if (npmVersion !== version)
    throw new Error(`Tag ${tag} but package.json says ${npmVersion}.`);
  if (lockVersion !== version)
    throw new Error(`Tag ${tag} but package-lock.json says ${lockVersion}.`);
  if (cargoVersion !== version)
    throw new Error(`Tag ${tag} but widget/Cargo.toml says ${cargoVersion}.`);

  console.log(releaseNotes(read('CHANGELOG.md'), version));
}

if (import.meta.main) {
  try {
    main();
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
