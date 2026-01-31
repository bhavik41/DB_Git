# System Architecture: DB-Git

This document describes the modules and improved structure based on the CLI + Backend architecture.

## 1. Directory Structure

```
db-git/
├── README.md               # User Documentation
├── FLOW.md                 # System Flow
├── ARCHITECTURE.md         # Architecture Document
├── cli/                    # The Client-Side Application (Member 1)
│   ├── package.json        # Dependencies
│   ├── bin/                # Entry point (dbv)
│   │   └── dbv.js
│   ├── commands/           # Command implementation (init, commit, log, diff)
│   ├── services/           # Backend API interaction
│   ├── core/               # Shared logic
│   │   ├── introspection/  # Member 2: Schema Extraction Logic
│   │   └── diff/           # Member 3: Schema Comparison Logic
│   └── utils/              # Helper functions (color, logging)
├── server/                 # The Backend API (Express.js) - Metadata Manager
│   ├── package.json
│   ├── prisma/             # Database Schema (Metadata DB)
│   │   └── schema.prisma
│   ├── src/
│   │   ├── app.js          # API Server
│   │   ├── routes/         # API Routes
│   │   ├── controllers/    # Request Handlers
│   │   └── services/       # Business Logic
│   └── .env                # Environment Variables (for Metadata DB)
└── .gitignore
```

## 2. Component Diagram

```mermaid
graph LR
    User --> CLI
    CLI --> TargetDB[Target Database (PostgreSQL)]
    CLI -->|HTTP Requests| API[Backend API (Express)]
    API -->|Prisma| MetaDB[Metadata Database (PostgreSQL)]
```

## 3. Technology Choices (Backend Only Stack)

*   **Language**: JavaScript / TypeScript (Node.js) (Unified for CLI & Server).
*   **Web Framework**: Express.js (v4.x).
*   **ORM**: Prisma (v5.x).
*   **Database**: PostgreSQL (v14+).
*   **CLI Framework**: Commander.js (v11+).
*   **Authentication**: JWT (JSON Web Tokens).

## 4. Member Implementations

### Member 1: CLI Interface (Parser)
*   Uses `commander` to define commands (`program.command('init')...`).
*   Example: `dbv commit -m "added users"` maps to `commands/commit.js`.
*   Connects to Backend via `axios` or similar HTTP client.

### Member 2: Introspection (Schema Reader)
*   File: `cli/core/introspection/index.js`
*   Functions: `captureSnapshot(connectionString)`
*   Uses `pg` (node-postgres) to query `information_schema`.
*   Specific queries for: `tables`, `columns`, `constraints`, `indexes`.

### Member 3: Diff Engine (Schema Logic)
*   File: `cli/core/diff/index.js`
*   Functions: `compareSnapshots(oldSchema, newSchema)`
*   Returns an array of operations: `ADD_TABLE`, `DROP_COLUMN`, `ALTER_TYPE`.
*   Format: JSON-based `ChangeSet` used both for storage and display.

## 5. Security & Multi-Tenancy (Member 7) (Future)
*   The Backend API handles user authentication.
*   The CLI sends User Token in headers.
*   Projects are scoped to Users/Organizations.
*   Permissions: `READ`, `WRITE`, `ADMIN`.
