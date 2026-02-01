# Contributing to BTW

Thank you for your interest in contributing to BTW! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- Git
- npm or yarn

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/btw.git
   cd btw
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Link for local development**
   ```bash
   npm link
   ```

Now you can use `btw` command globally with your local changes.

## Development Workflow

### Code Style

This project uses:
- **TypeScript** for type safety
- **ESLint** for linting
- **Prettier** for code formatting

Run these before committing:
```bash
npm run lint        # Check for linting errors
npm run lint:fix    # Auto-fix linting errors
npm run format      # Format code with Prettier
npm run typecheck   # Run TypeScript type checking
```

### Testing

Write tests for new features and bug fixes:
```bash
npm test           # Run tests in watch mode
npm run test:run   # Run tests once
```

### Building

```bash
npm run build      # Build the project
npm run dev        # Build in watch mode
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-target` - New features
- `fix/injection-bug` - Bug fixes
- `docs/update-readme` - Documentation changes
- `refactor/cleanup-core` - Code refactoring

### Commit Messages

Write clear, concise commit messages:
- `feat: add windsurf target support`
- `fix: resolve path resolution on Windows`
- `docs: update installation instructions`
- `refactor: simplify injection logic`

### Pull Request Process

1. Create a new branch from `main`
2. Make your changes
3. Ensure all tests pass
4. Update documentation if needed
5. Submit a pull request

## Project Structure

```
btw/
├── src/
│   ├── cli/           # CLI commands and interface
│   ├── core/          # Core functionality
│   │   ├── injection/ # Injection strategies for AI tools
│   │   ├── manifest/  # btw.yaml parsing
│   │   ├── state/     # State management
│   │   └── workflow/  # Workflow operations
│   └── types/         # TypeScript type definitions
├── docs/              # Documentation
└── tests/             # Test files
```

## Adding a New AI Tool Target

To add support for a new AI tool:

1. Create a new injection strategy in `src/core/injection/strategies/`
2. Register the strategy in the injection engine
3. Add the target to the `SupportedTarget` type
4. Update documentation
5. Add tests

## Reporting Bugs

When reporting bugs, please include:
- BTW version (`btw --version`)
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## Feature Requests

We welcome feature requests! Please:
- Check if the feature has already been requested
- Provide a clear use case
- Explain how it fits with BTW's goals

## Questions?

Feel free to open an issue for questions or join discussions on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
