# Changelog

All notable changes to BTW will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2025

### Added
- Global workflows support
- File references in btw.yaml agents (use `file:` instead of inline `system_prompt`)

### Fixed
- Re-inject workflow after update if currently injected

## [0.5.1] - 2025

### Added
- Uninstall command (`btw uninstall`)

### Fixed
- Use FileInfo.path instead of object in interactive mode

## [0.5.0] - 2025

### Added
- Interactive mode for inject command (`btw inject -i` or `--interactive`)
- New Claude injection using `.claude/agents/` folder structure
- Auto re-inject workflows after update
- Update command for workflows (`btw update`)
- Automatic update checker

### Fixed
- Read VERSION from package.json dynamically
- Update checker hanging issues

### Documentation
- Added example btw.yaml manifest

## [0.1.0] - 2024

### Added
- Initial release
- Core workflow management (add, list, remove)
- Inject command for Claude target
- Support for GitHub and local workflow sources
- YAML manifest parsing
- State management for installed workflows

[0.6.0]: https://github.com/sanarberkebayram/btw/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/sanarberkebayram/btw/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/sanarberkebayram/btw/compare/v0.1.0...v0.5.0
[0.1.0]: https://github.com/sanarberkebayram/btw/releases/tag/v0.1.0
