import {
  hasExecutableIntegrationChange,
  hasExecutableIntegrationDelta,
} from '@lib/programs/honch-integration';

describe('Honch integration source-change guard', () => {
  it('rejects docs-only and skill-only changes', () => {
    expect(
      hasExecutableIntegrationChange([
        'honch-setup-report.md',
        '.claude/skills/esp-idf/SKILL.md',
        'README.md',
      ]),
    ).toBe(false);
  });

  it('accepts executable firmware/app source changes', () => {
    expect(
      hasExecutableIntegrationChange([
        'honch-setup-report.md',
        'main/app_main.c',
      ]),
    ).toBe(true);

    expect(hasExecutableIntegrationChange(['ios/AppDelegate.swift'])).toBe(
      true,
    );
  });

  it('accepts build-system changes that are part of the integration', () => {
    expect(hasExecutableIntegrationChange(['main/CMakeLists.txt'])).toBe(true);
    expect(
      hasExecutableIntegrationChange(['android/app/build.gradle.kts']),
    ).toBe(true);
  });

  it('requires an executable file to change during this installer run', () => {
    const before = new Map([
      ['main/app_main.c', 'same-source'],
      ['honch-setup-report.md', 'old-report'],
    ]);

    expect(
      hasExecutableIntegrationDelta(
        before,
        new Map([
          ['main/app_main.c', 'same-source'],
          ['honch-setup-report.md', 'new-report'],
        ]),
      ),
    ).toBe(false);

    expect(
      hasExecutableIntegrationDelta(
        before,
        new Map([
          ['main/app_main.c', 'new-source'],
          ['honch-setup-report.md', 'new-report'],
        ]),
      ),
    ).toBe(true);
  });
});
