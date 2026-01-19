# BTW - Bring The Workers

**Work in Progress**

This project is currently under active development.

## Purpose

BTW is a local MCP (Model Context Protocol) server and CLI tool that manages and serves skills, agents, and templates for AI coding assistants like Claude and Codex. It enables developers to:

- **Organize AI workflows**: Create and manage reusable templates that bundle agents and skills for specific tasks
- **Share knowledge**: Register GitHub repositories containing skills, agents, and templates with your team
- **Enhance AI assistants**: Inject custom skills and configurations into Claude, Codex, and other MCP-compatible tools
- **Work offline**: All data is stored locally with periodic sync from configured repos

## Key Features

- **Repository Management**: Add, sync, and validate GitHub repos containing skills and templates
- **Template System**: Compose complex AI workflows from reusable components
- **Interactive TUI**: Modern terminal UI for browsing and managing resources
- **CLI for Automation**: All features available via command-line for scripting and CI/CD
- **MCP Server**: Expose skills and templates as MCP resources for AI clients
- **Offline-first**: Local indexing and caching for fast lookups

## Technology

- Node.js + TypeScript
- MCP SDK for AI integration
- SQLite for local indexing
- blessed for terminal UI
- Fastify for MCP server
