# SN Practice CRM — clean-slate application

This directory contains the new production application. The repository-root Lovable application remains intact as a behavioural reference while workflows are rebuilt and verified here.

## Boundaries

- `apps/web`: compact Horizon-inspired desktop application
- `apps/api`: separate backend process and application services
- `packages/domain`: business rules and authorization decisions
- `packages/contracts`: request and response contracts shared by web and API
- `database`: schema, migrations, triggers, and row-level access rules

The first vertical slice covers the role-specific home screen, Assignments, Recurring Schedules, Delegated Tasks, Internal Tasks, and Personal Tasks. See [`../docs/AUTHORITY_MODEL.md`](../docs/AUTHORITY_MODEL.md) for the governing rules.

## Local commands

Run commands from the repository root:

```powershell
npm run new:test
npm run new:typecheck
npm run new:dev
```
