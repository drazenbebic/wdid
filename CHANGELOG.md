# Changelog

## [0.4.0](https://github.com/drazenbebic/wdid/compare/v0.3.0...v0.4.0) (2026-05-30)


### ⚠ BREAKING CHANGES

* rework help UX and add date shortcuts

### Features

* add `wdid yesterday` command ([9eaf15a](https://github.com/drazenbebic/wdid/commit/9eaf15a301bad2c8403fb64cd84d0ba8d2a57a66))
* add `wdid YYYY-MM` command ([d371933](https://github.com/drazenbebic/wdid/commit/d371933f69e86d3cc01dd84cec5422b115a66d76))
* add isometric gradient banner to --help ([a387ebe](https://github.com/drazenbebic/wdid/commit/a387ebe785629ab693a74efe6e386a00ba63b38b))
* rework help UX and add date shortcuts ([e2a120d](https://github.com/drazenbebic/wdid/commit/e2a120d4ca1def16c179bb41fe34821d44ea3a51))

## [0.3.0](https://github.com/drazenbebic/wdid/compare/v0.2.0...v0.3.0) (2026-05-27)


### Features

* add config commands ([#7](https://github.com/drazenbebic/wdid/issues/7)) ([7d4b5bb](https://github.com/drazenbebic/wdid/commit/7d4b5bb9f309421cbaa833fd70a8803a962fc0dc))
* integrate with Toggl (one entry per ticket, idempotent) ([#5](https://github.com/drazenbebic/wdid/issues/5)) ([1a03e03](https://github.com/drazenbebic/wdid/commit/1a03e03d3f322ed7b0f2c91bd2640c0fc7e3250e))

## [0.2.0](https://github.com/drazenbebic/wdid/compare/v0.1.3...v0.2.0) (2026-05-27)


### Features

* add --group-by-day to render the table as a per-day journal ([b2cea40](https://github.com/drazenbebic/wdid/commit/b2cea406f30c0fe444a87b9bdc44defa890faa59))
* add --json to emit commit entries as a JSON array ([8958d29](https://github.com/drazenbebic/wdid/commit/8958d29b82e48405814fc218e7cff4542e4014c2))
* add --limit to cap the table to N most recent rows ([69ccc4a](https://github.com/drazenbebic/wdid/commit/69ccc4a9de2e0568dc1b6947620a0f38965800fd))
* add --no-color flag and honor NO_COLOR env var ([64bf708](https://github.com/drazenbebic/wdid/commit/64bf7081c250ab01bc35488317925c3dfe8996b4))
* append feature branch name to the description column ([23be96d](https://github.com/drazenbebic/wdid/commit/23be96d38f8e3c4eea05b91f16770662be90d7c5))
* auto-pick ticket column label based on format ([d332bac](https://github.com/drazenbebic/wdid/commit/d332bac97bf3e6cc0f3afd9483d5ff4eb516bf54))
* show commit time in local timezone next to the date ([3639407](https://github.com/drazenbebic/wdid/commit/3639407ef5bb6b192e930e1900215aaf8ad4e9c6))


### Bug Fixes

* emit clean errors when not inside a git repository ([fd3e38f](https://github.com/drazenbebic/wdid/commit/fd3e38ff5840dc70087f424fd5f69410e9d2d23e))
* **security:** cap and validate user-supplied ticket regex ([00d5d04](https://github.com/drazenbebic/wdid/commit/00d5d04426cf5e122b25bafdde0b3f43e1274bdf))


### Continuous Integration

* enforce Conventional Commits on PR titles ([d0d488a](https://github.com/drazenbebic/wdid/commit/d0d488a49d57d6d6fb9ddae1aee7576a6cc17749))
* enforce Conventional Commits on PR titles ([3ff2af8](https://github.com/drazenbebic/wdid/commit/3ff2af88034a25bc615434faaf33f162d7d16734))

## [0.1.3](https://github.com/drazenbebic/wdid/compare/v0.1.2...v0.1.3) (2026-05-27)


### Continuous Integration

* fix package publishing ([90f86c1](https://github.com/drazenbebic/wdid/commit/90f86c133626a9fe8d5a5fab99437d05acbaa364))

## [0.1.2](https://github.com/drazenbebic/wdid/compare/v0.1.1...v0.1.2) (2026-05-27)


### Features

* add configurable ticket extraction and config file support ([90a917e](https://github.com/drazenbebic/wdid/commit/90a917e55759e85fa5e63f52eba225cf7932ff83))


### Continuous Integration

* fix publishing ([cf301ef](https://github.com/drazenbebic/wdid/commit/cf301ef74b252d3df9365d14a661f6ca3f31c4d2))

## [0.1.1](https://github.com/drazenbebic/wdid/compare/v0.1.0...v0.1.1) (2026-05-27)


### Features

* initial commit ([f371395](https://github.com/drazenbebic/wdid/commit/f371395c4a4f457a41dcf4f4308314d74a2cfc81))


### Bug Fixes

* add changelog-sections to release please config ([ea096ac](https://github.com/drazenbebic/wdid/commit/ea096ac42ced137efd75d671e4964ae0cd4cff00))
* add renderTable test ([2d9665e](https://github.com/drazenbebic/wdid/commit/2d9665ec2ad1def950ea204d6f56ae62318ded47))
* fix ci workflow ([6f6372a](https://github.com/drazenbebic/wdid/commit/6f6372a1764f7c7a0f06172e57fb487654d3cc8a))
* update eslint rules and add lint-staged pre-commit hook ([30e3734](https://github.com/drazenbebic/wdid/commit/30e3734faa6ba48bbc6f2eb20462d22707787fd8))


### Continuous Integration

* update github action versions ([2893dd3](https://github.com/drazenbebic/wdid/commit/2893dd315cd9d13061bcaeccd374fa76a24c888b))
