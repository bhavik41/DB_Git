# System Flow: DB-Git (CLI + Backend)

This document outlines the data flow and execution path for the DB-Git system, focusing on the interactions between the CLI, the Backend API, and the Databases (Metadata & Target).

## 1. High-Level Flow

```mermaid
graph TD
    User[User Terminal] -->|Run dbv command| CLI[CLI Tool (Node.js)]
    CLI -->|1. Authenticate / Fetch Metadata| API[Express Backend API]
    CLI -->|2. Introspect Schema| TargetDB[Target Database (PostgreSQL)]
    CLI -->|3. Calculate Diff| Engine[Diff Engine (Local/Shared)]
    CLI -->|4. Push Commit/Metadata| API
    API -->|Store Metadata| MetaDB[Metadata Database (PostgreSQL)]
```

## 2. Detailed Command Flows

### 2.1 Initialization (`dbv init`)
1.  **User** runs `dbv init`.
2.  **CLI** prompts for Target DB credentials (host, port, user, pass, dbname).
3.  **CLI** validates connection to **Target DB**.
4.  **CLI** sends initialization request to **Backend API** to create a new Project/Repo.
5.  **Backend API** creates project entry in **Metadata DB**.
6.  **Backend API** returns Project ID/Token.
7.  **CLI** saves configuration locally (e.g., `.dbv/config.json`).

### 2.2 Commit (`dbv commit -m "message"`)
1.  **User** runs `dbv commit -m "Added users table"`.
2.  **CLI** (Member 2) connects to **Target DB** and runs **Schema Introspection**.
    *   Queries `information_schema` to build a JSON representation of the *current* state.
3.  **CLI** requests the *latest version's* schema snapshot from **Backend API**.
4.  **CLI** (Member 3) uses **Diff Engine** to compare:
    *   `Previous Snapshot` vs `Current Snapshot`.
5.  **CLI** generates a `Diff` payload (SQL changes + Metadata).
6.  **CLI** sends `Commit` payload (Diff, Message, Author, New Snapshot) to **Backend API**.
7.  **Backend API** saves the commit and the new snapshot in **Metadata DB**.
8.  **Backend API** confirms success to CLI.

### 2.3 Log (`dbv log`)
1.  **User** runs `dbv log`.
2.  **CLI** requests commit history from **Backend API**.
3.  **Backend API** fetches history from **Metadata DB**.
4.  **CLI** formats and displays the history (Commit ID, Author, Date, Message).

### 2.4 Diff (`dbv diff v1 v2`)
1.  **User** runs `dbv diff v1 v2`.
2.  **CLI** requests snapshots for `v1` and `v2` from **Backend API**.
3.  **CLI** (Member 3) runs **Diff Engine** on the two snapshots.
4.  **CLI** displays the differences (Added tables, Modified columns, etc.).

### 2.5 Rollback (`dbv rollback vX`)
1.  **User** runs `dbv rollback vX`.
2.  **CLI** requests the *target* snapshot for `vX` and the *current* snapshot from **Backend API**.
3.  **CLI** calculates the `Reverse Diff` (Inverse operations to go from Current -> Target).
4.  **CLI** warns user about data loss risks.
5.  **CLI** (Member 5) applies the `Reverse Diff` SQL to **Target DB**.
6.  **CLI** notifies **Backend API** that a rollback occurred (creating a new "Rollback Commit" to maintain history forward).

## 3. Interaction Diagram (Member Responsibilities)

*   **Member 1 (CLI Parser)**: The entry point. Parses `argv`, handles flags, calls the appropriate controller.
*   **Member 2 (Introspection)**: Module `introspection.js`. connect() -> extract() -> return JSON.
*   **Member 3 (Diff Engine)**: Module `diff.js`. compare(jsonA, jsonB) -> return ChangeSet.
*   **Backend (Express)**: Routes `/api/projects`, `/api/commits`.
