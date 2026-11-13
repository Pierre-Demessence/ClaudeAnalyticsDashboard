// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { changelogSection, releaseNotes } from './release-check.ts';

const changelog = [
  '# Changelog',
  '## [Unreleased]',
  '',
  '### Added',
  '- next',
  '',
  '## [1.2.0]',
  '',
  '### Fixed',
  '- a fix',
  '',
  '## [1.1.0]',
  '',
  '- older',
  '',
  '[Unreleased]: https://example.com/compare/v1.2.0...HEAD',
  '[1.1.0]: https://example.com/releases/tag/v1.1.0',
].join('\n');

describe('changelogSection', () => {
  it('returns the section between its heading and the next one', () => {
    expect(changelogSection(changelog, '1.2.0')).toBe('### Fixed\n- a fix');
  });

  it('drops the link references after the last section', () => {
    expect(changelogSection(changelog, '1.1.0')).toBe('- older');
  });

  it('fails for a missing or empty section', () => {
    expect(() => changelogSection(changelog, '9.9.9')).toThrow('no "## [9.9.9]"');
    expect(() => changelogSection('## [1.0.0]\n\n## [0.9.0]\n- x', '1.0.0')).toThrow('empty');
  });
});

describe('releaseNotes', () => {
  it('ends the version\'s section with its Docker image', () => {
    expect(releaseNotes(changelog, '1.2.0')).toBe([
      '### Fixed',
      '- a fix',
      '',
      '**Docker image:** [`ghcr.io/pierre-demessence/claude-analytics-dashboard:1.2.0`](https://github.com/users/Pierre-Demessence/packages/container/package/claude-analytics-dashboard)',
    ].join('\n'));
  });
});
