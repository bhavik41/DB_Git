The Security, Permissions & Audit Logging module ensures that all schema evolution operations within DB-Git are:

Authenticated

Authorized

Auditable

Traceable

Role-Based Access Control (RBAC)

This module enforces controlled access to critical operations such as commit creation, rollback execution, and branch management. It also maintains a structured audit trail for all security-sensitive actions performed in the system
RBAC Model Design

The system implements a Role-Based Access Control (RBAC) model to manage permissions. Each user is assigned a predefined role, and each role is mapped to a set of allowed actions.

Defined Roles

ADMIN

Create/Delete projects

Create/Delete branches

Execute rollback

View audit logs

Manage users

DEVELOPER

Create commits

Create branches

Switch branches

View version history

VIEWER

View project metadata

View version history

No modification permissions
