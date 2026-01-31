# DB-Git: Database Version Control System (Backend & CLI)

This project implements a Git-like CLI for database schema versioning.

---

## Prerequisites

* Node.js (v18+)
* PostgreSQL (Target Database & Metadata Database)

---

## Setup

1. **Install Dependencies**:
    ```bash
    cd server && npm install
    cd ../cli && npm install
    ```

2. **Configure Environment**:
    * Edit `server/.env` and set `DATABASE_URL` for the Metadata Database.
    * (Optional) Ensure you have a Target Database running (e.g., `my_app_db`).

3. **Start Backend Server**:
    ```bash
    cd server
    # Run migrations first
    npx prisma migrate dev --name init
    # Start server
    node index.js
    ```
    The server runs on `http://localhost:3000`.

4. **Install CLI Globally (Link)**:
    ```bash
    cd cli
    npm link
    ```
    Now you can run `dbv` from anywhere.

---

## Usage

1. **Initialize a Repository**:
    ```bash
    mkdir my-project
    cd my-project
    dbv init
    ```
    Follow the prompts to connect to your Target DB.

2. **Make Changes to DB**:
    * Go to your SQL client (pgAdmin, psql).  
    * Example:
      ```sql
      CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);
      ```

3. **Commit Changes**:
    ```bash
    dbv commit -m "Added users table"
    ```

4. **View History**:
    ```bash
    dbv log
    ```

5. **View Diff**:
    ```bash
    dbv diff
    ```

---

## Architecture

* **CLI**: Node.js + Commander
* **Backend**: Node.js + Express + Prisma
* **Database**: PostgreSQL
* **Core Logic**:
    * `cli/core/introspection`: Reads `information_schema`
    * `cli/core/diff`: Compares schema snapshots

---

## Member 4 — Rollback & Schema Reconstruction Engine

**Responsibilities**:

* Reconstruct database schema from:
  * Snapshots OR
  * Migration replay
* Implement rollback and `checkout <version>` commands
* Ensure transactional safety and schema consistency

**Deliverables**:

* Rollback algorithms
* Restore APIs
* Consistency verification logic

**Usage Example for Rollback**:

```bash
# Rollback to a specific commit
dbv rollback <commit-id>