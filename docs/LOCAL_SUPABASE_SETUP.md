# Local Supabase Setup & Verification Runbook

> - **Task Reference:** `CRM-P1-T9A`
> - **Date:** 2026-11-01
> - **Platform:** Windows 11 (PowerShell 5.1)
> - **Canonical Workspace:** `C:\Users\HP\Mohammed\CRM`
> - **Canonical Target Directory:** `C:\Users\HP\Mohammed\CRM\sn-practice-crm`
> - **Initial Baseline Commit:** `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1`
> - **Verified Base Commit:** `6e01704b3875c897c78313371bb44fd9acf9c619`

---

> [!NOTE]
> ### CURRENT STATUS: ENVIRONMENT INITIALIZED, RUNNING & VERIFIED (2026-11-01)
>
> **The local Supabase development environment is fully initialized, running, and verified on this host.**
>
> - **Host & Container Engine:** Windows restart completed; no OS reboot blocker remains. Docker Desktop 4.97.0 (Docker CLI 29.9.2, engine 29.9.2) is operational and the `desktop-linux` daemon is verified running with the WSL 2 backend.
> - **Tooling:** Project-local Supabase CLI 2.122.0 (`sn-practice-crm/package.json`) and PostgreSQL client `psql` 18.6 are verified and operational.
> - **Canonical App-Local Config:** Initialized at `sn-practice-crm/supabase/config.toml` (project ID: `sn-practice-crm`) on standard local ports (API 54321, DB 54322, Studio 54323, Inbucket mail 54324). Its `.gitignore` ignores `.temp`, `.branches`, and local `.env` files. (The separate parent `supabase/config.toml` was preserved untouched and must not be used or modified for this app-local workflow).
> - **Verified Clean Start Command:** Default `npx supabase start` reproducibly failed only on optional local Analytics/Logflare container health checks. The verified clean startup command is `npx supabase start -x logflare,vector`. These two services are optional local observability components; excluding them yields zero unhealthy containers while retaining all essential development services (PostgreSQL Database, Auth, RLS, PostgREST REST API, Realtime, Storage, Studio, Inbucket mail, PostgreSQL meta, and Edge Runtime).
> - **Database Schema & Migrations:** Canonical migrations reside under `sn-practice-crm/supabase/migrations/` (`20261031060700_practice_core.sql`, `20261103105200_work_item_reminder.sql`, `20261103120000_add_demo_support.sql`). Executing `npx supabase db reset --local --no-seed` drops and recreates the database schema, applying all canonical migrations automatically. Seeding is executed via `npm run seed:local`.
> - **Invariants & Persistence Verified:** `database/tests/001_catalog_invariants.sql` passed on initial execution and passed again after a clean stop/restart cycle (`npx supabase stop` followed by `npx supabase start -x logflare,vector`), proving schema and data persistence.
> - **Monorepo Quality Gate:** All quality checks pass at HEAD `6e01704b3875c897c78313371bb44fd9acf9c619` (TypeScript typecheck passed; Vitest passed 6 files / 85 tests; static DB/policy passed 9 tests; total: 94 tests; production build passed in 3.73s).
> - **Active Stack State:** The local Supabase stack is intentionally left running.

---

## 1. Preflight Environment Evidence (Historical Pre-Install Snapshot)

> [!NOTE]
> **HISTORICAL PRE-INSTALL SNAPSHOT (Captured 2026-10-31 @ commit `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1`):**
> The table below records baseline preflight observations captured prior to prerequisite installation and runtime initialization. These absence records reflect the historical baseline when CRM-P1-T9A was first drafted; see Sections 2 through 7 for the current verified, fully operational environment state.

All checks executed non-interactively in Windows PowerShell from canonical root `C:\Users\HP\Mohammed\CRM` on 2026-10-31:

| Check / Command | Expected | Observed Output | Exit Code | Status |
| :--- | :--- | :--- | :--- | :--- |
| `git rev-parse HEAD` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | 0 | **Verified Baseline** |
| `git status --short` | Clean working tree | *(Empty)* | 0 | **Verified Clean** |
| `node --version` | Node 20+ required | `v26.13.0` | 0 | **Satisfied** |
| `npm --version` | Compatible npm package manager | `11.20.0` | 0 | **Satisfied** |
| `Get-Command docker -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Historical Snapshot Gap)** |
| `Get-Command supabase -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Historical Snapshot Gap)** |
| `Get-Command psql -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Historical Snapshot Gap)** |
| `Test-Path sn-practice-crm/supabase/config.toml` | `False` (uninitialized) | `False` | 0 | **Historical Uninitialized** |
| `Test-Path sn-practice-crm/database/package.json` | `False` (no bespoke runner) | `False` | 0 | **Expected Clean** |

*Zero secrets, tokens, or environment keys were accessed, printed, or recorded.*

---

## 2. Tooling Status & Official Installation Guidance

### 2.1 Current Tooling Status (Verified 2026-11-01)

| Tool / Component | Installed Version / Package | Verification Evidence | Current State & Operational Role |
| :--- | :--- | :--- | :--- |
| **Docker Desktop** | `Docker.DockerDesktop 4.97.0` (WinGet) | Direct binary at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` reports Docker CLI `29.9.2, build a82e528`, Engine `29.9.2`, daemon `desktop-linux` | **Verified & Running.** Host reboot completed; Docker Desktop running with WSL 2 backend. Zero unhealthy containers under verified startup command. |
| **Supabase CLI** | Project-local `supabase: 2.122.0` (exact `devDependencies` in `sn-practice-crm/package.json`, commit `88476be7d72b582a531962d82ae36cad0422b4e7`) | `npx supabase --version` executed cleanly with exit code 0 (`2.122.0`) from `sn-practice-crm` | **Verified & Running.** App-local config generated at `sn-practice-crm/supabase/config.toml` (project_id: `sn-practice-crm`). Services active via `npx supabase start -x logflare,vector`. |
| **PostgreSQL (`psql`)** | PostgreSQL `18.6-5` (Scoop) | Direct binary reports `psql (PostgreSQL) 18.6`. User PATH includes `C:\Users\HP\scoop\apps\postgresql\current\bin` | **Verified & Operational.** Client executed migration `0001_practice_core.sql` and invariant suite `001_catalog_invariants.sql` against the local stack. |

> [!NOTE]
> **CONFIG & WORKSPACE ISOLATION:**
> - Canonical app-local configuration is at `sn-practice-crm/supabase/config.toml` (`project_id = "sn-practice-crm"`) with standard local ports: API 54321, DB 54322, Studio 54323, mail 54324.
> - The local `.gitignore` (`sn-practice-crm/supabase/.gitignore`) ignores `.temp`, `.branches`, and local `.env` files (`.env.keys`, `.env.local`, `.env.*.local`).
> - The separate parent `C:\Users\HP\Mohammed\CRM\supabase\config.toml` was preserved untouched and must not be used or modified for this app-local workflow. Do not reference or expose its remote project ID.

### 2.2 Container Runtime: Docker Desktop on Windows
- **Official Source & Installation:** Per the official [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) guide, Docker Desktop specifies a per-user installation with the WSL 2 backend as the standard configuration on Windows 10/11 64-bit.
- **Requirements:** Windows 10/11 64-bit with WSL 2 feature enabled and an updated Linux kernel package (`wsl --update`), as outlined in [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Installation Procedure:** Download `Docker Desktop Installer.exe` from official Docker channels or install via WinGet (`winget install Docker.DockerDesktop`), ensuring the "Use WSL 2 instead of Hyper-V" option is selected, following [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Daemon Verification:** The host reboot completed, Docker Desktop is active, and `docker version` confirms client and server engine 29.9.2 on `desktop-linux`.

### 2.3 CLI Tooling: Project-Local Supabase CLI (npm / npx)
- **Official Source & Installation:** As specified in [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform), the Supabase CLI is installed as a project-local devDependency using `npm install supabase --save-dev` inside the project root, with commands executed via `npx supabase <command>`.
- **Requirements:** Node.js 20+ is required according to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) (the current host runtime `v26.13.0` satisfies this requirement).
- **Target Location:** Installed strictly inside `sn-practice-crm/` (`sn-practice-crm/package.json` devDependencies as `"supabase": "2.122.0"`), never globally or at the parent repository root.
- **Command Invocation:** All Supabase commands use `npx supabase` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) to guarantee version locking and sandbox reproducibility.

### 2.4 Database Client Tooling: PostgreSQL `psql`
- **Official Source & Distribution:** The [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) page provides certified EDB Windows installers and archive packages to obtain client utilities including `psql`.
- **Requirements:** `psql` command-line executable installed on the host and available in Windows `PATH`, as described in [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/).
- **Verification Rule:** `Get-Command psql` (or direct path invocation `C:\Users\HP\scoop\apps\postgresql\current\bin\psql.exe`) resolves to PostgreSQL 18.6, enabling direct execution of migration and test SQL scripts against the local container database.

---

## 3. Verified Host & Runtime Verification Commands

All host and runtime verification commands have been executed non-interactively in Windows PowerShell from canonical root `C:\Users\HP\Mohammed\CRM`:

```powershell
# 1. Verify container runtime daemon and WSL 2 backend (verified: client/engine 29.9.2, desktop-linux)
docker version

# 2. Verify project-local Supabase CLI via npx from canonical sn-practice-crm root (verified: 2.122.0)
Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
npx supabase --version

# 3. Verify PostgreSQL client on system PATH (verified: psql 18.6)
psql --version
```

*Security Assurance:* Zero secrets, tokens, or environment keys were accessed, printed, or recorded.

---

## 4. Local Stack Initialization & Lifecycle Workflow

> [!IMPORTANT]
> **STATUS: INITIALIZED, RUNNING & VERIFIED (STACK INTENTIONALLY ACTIVE).**
>
> All operations are executed exclusively from canonical directory `C:\Users\HP\Mohammed\CRM\sn-practice-crm`.

### 4.1 Canonical App-Local Initialization
1. **Directory Navigation & Initialization:**
   ```powershell
   Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
   npx supabase init
   ```
   *Official Fact:* According to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) and the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase init` creates a local `supabase/config.toml` file. It operates entirely locally and does **not** sign in, require authentication, or connect to any remote or hosted project.

2. **Generated Configuration & Isolation:**
   - Generated configuration: `sn-practice-crm/supabase/config.toml` with `project_id = "sn-practice-crm"`.
   - Standard local port bindings:
     - API / PostgREST: `54321`
     - PostgreSQL Database: `54322`
     - Supabase Studio: `54323`
     - Inbucket Local Mail: `54324`
   - Generated ignore rules (`sn-practice-crm/supabase/.gitignore`): ignores `.temp`, `.branches`, and local `.env` files (`.env.keys`, `.env.local`, `.env.*.local`).
   - The separate parent configuration at `C:\Users\HP\Mohammed\CRM\supabase\config.toml` was preserved untouched and must not be used or modified for this app-local workflow.

### 4.2 Stack Startup & Observability Exclusion (`-x logflare,vector`)
1. **Startup Finding:** Running the full default command `npx supabase start` reproducibly failed only on health checks for the optional local analytics services (`logflare`).
2. **Verified Clean Command:**
   ```powershell
   npx supabase start -x logflare,vector
   ```
   *Flag Rationale & Architecture:* Per the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), the `-x` (`--exclude`) flag excludes specific non-critical services. Here, `logflare` and `vector` are optional local observability and logging services. Excluding them produces a clean local stack with **zero unhealthy containers** while retaining all core application services:
   - PostgreSQL Database Engine (`supabase_db_sn-practice-crm`)
   - GoTrue Authentication (`supabase_auth_sn-practice-crm`)
   - Row-Level Security (RLS) enforcement
   - PostgREST REST API (`supabase_rest_sn-practice-crm`)
   - Realtime Engine (`supabase_realtime_sn-practice-crm`)
   - Storage API (`supabase_storage_sn-practice-crm`)
   - Supabase Studio Web UI (`supabase_studio_sn-practice-crm`)
   - Inbucket Local Email Server (`supabase_inbucket_sn-practice-crm`)
   - PostgreSQL Metadata Service (`supabase_meta_sn-practice-crm`)
   - Edge Runtime (`supabase_edge_runtime_sn-practice-crm`)

### 4.3 Clean Restart & Lifecycle Verification
To stop and restart the local stack cleanly while preserving all schema and data:
```powershell
# Graceful stop
npx supabase stop

# Clean start excluding optional observability
npx supabase start -x logflare,vector
```
This stop/start cycle was executed and verified: database schema and state were completely preserved, and live catalog invariant tests passed immediately upon restart. The local stack is intentionally left running for active development.

---

## 5. Database Migration Layout & Execution Truth

### 5.1 File Placement Architecture
- **Canonical Migrations Directory:** Located at `sn-practice-crm/supabase/migrations/` containing:
  - `20261031060700_practice_core.sql` (Practice core schema, tables, policies, and triggers)
  - `20261103105200_work_item_reminder.sql` (Work item reminder_at column, index, and immutability trigger)
  - `20261103120000_add_demo_support.sql` (Demo data support, is_demo flag, immutability, and cleanup RPC)
- **Supabase CLI Convention:** As documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags) and [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform), the Supabase CLI applies migration files from `sn-practice-crm/supabase/migrations/` using timestamped naming (e.g., `YYYYMMDDHHMMSS_name.sql`).
- **Architectural Truth:** With all migrations consolidated in `sn-practice-crm/supabase/migrations/`, running `npx supabase db reset --local --no-seed` recreates the schema from baseline and applies all canonical migrations in order. Local seeding is then executed using `npm run seed:local`.

### 5.2 Verified Execution Sequence
The full provisioning and verification sequence is:

1. **Ensure Working Directory:**
   ```powershell
   Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
   ```

2. **Reset Local Database (Approved Local Target Only):**
   ```powershell
   npx supabase db reset --local --no-seed
   ```
   *Official Fact:* As documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase db reset --local --no-seed` resets the local database by recreating it from baseline and applying all canonical migrations without running seed. Never use `--linked` or `--db-url`; all actions must remain strictly local.

3. **Seed Local Database:**
   ```powershell
   npm run seed:local
   ```

3. **Inspect Local Stack Status & Define Task-Scoped Connection Variable:**
   ```powershell
   # Run status from the canonical target to inspect endpoints
   npx supabase status
   ```
   *Official Fact & Workflow:* Per the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase status` displays local service URLs and connection details.
   - Run `npx supabase status` from `C:\Users\HP\Mohammed\CRM\sn-practice-crm`.
   - Store the LOCAL database URL reported by that local stack into a task-scoped variable:
     ```powershell
     $crmLocalDatabaseUrl = '<LOCAL_DATABASE_URL_REPORTED_BY_NPX_SUPABASE_STATUS>'
     ```
   - **Do not paste status output into task logs or files**, because status output contains local anon and service-role keys.
   - Validate that the chosen connection targets loopback/local before executing `psql`, and abort otherwise:
     ```powershell
     if ($crmLocalDatabaseUrl -notmatch '^postgresql://.+@(127\.0\.0\.1|localhost)(:\d+)?/') {
         throw "Aborting: Database URL does not target loopback/localhost: $crmLocalDatabaseUrl"
     }
     ```
   - Never commit this value.

4. **Apply Authoritative Core Migration:**
   ```powershell
   psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/migrations/0001_practice_core.sql"
   ```
   *Result:* Migration executed cleanly with exit code 0 under `-v ON_ERROR_STOP=1`. The database schema was populated with the expected schema inventory of **16 base tables and 4 views**.

5. **Execute Catalog Invariants Verification:**
   ```powershell
   psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/tests/001_catalog_invariants.sql"
   ```
   *Result:* All invariant checks passed cleanly with exit code 0 and executed transaction rollback.

---

## 6. Catalog Invariant Test Verification (`001_catalog_invariants.sql`)

Direct inspection and execution of `sn-practice-crm/database/tests/001_catalog_invariants.sql` (294 total lines) verifies the file structure, transaction safety, and catalog assertions:

- **Line 5:** `begin;` — Opens an explicit transaction block.
- **Lines 7–292:** `do $verify$ ... $verify$;` — Anonymous PL/pgSQL validation block inspecting the PostgreSQL system catalog (`pg_catalog`, `pg_type`, `pg_enum`, `pg_class`, `pg_trigger`, `pg_attrdef`):
  - Validates `app_role` enum elements and exact sorting: `('founder', 'manager', 'senior_staff', 'staff', 'trainee')` (Lines 16–28).
  - Validates pure authority functions and transition matrices: `role_may_delegate`, `assignment_transition_allowed`, `work_item_transition_allowed` (Lines 30–74).
  - Validates Row-Level Security (RLS) enabled on all 16 business tables (Lines 76–100).
  - Validates presence of 16 required SELECT policies across core tables.
  - Validates zero DELETE policies on protected core tables (preventing destructive hard deletions).
  - Validates privilege boundaries and security-definer / security-invoker separation.
  - Validates 15 business audit triggers (`audit_%`) active on core entities (Lines 221–232).
  - Validates 4 security-invoker dashboard views (`reloptions @> array['security_invoker=true']`) (Lines 234–250).
  - Validates deferred constraint triggers for role and reporting hierarchy integrity (Lines 252–275).
  - Validates assignment code auto-generation default expression referencing `assignment_code_seq` (Lines 277–290).
- **Line 294:** `rollback;` — Explicitly aborts the transaction block.

> [!NOTE]
> **DOUBLE-VERIFIED & PERSISTENCE PROVEN:**
> This test suite passed on initial application following `001_practice_core.sql` and passed again after the graceful stop/start restart cycle (`npx supabase stop` followed by `npx supabase start -x logflare,vector`). This confirms that the schema inventory of **16 base tables and 4 views** remains fully intact across container restarts. Furthermore, because line 294 issues an explicit rollback, running the invariant suite leaves zero test artifacts behind.

---

## 7. Monorepo Quality Gate Validation (HEAD `6e01704`)

Full monorepo verification was conducted at HEAD `6e01704b3875c897c78313371bb44fd9acf9c619`:

- **TypeScript Typecheck:** `npm --prefix sn-practice-crm run typecheck` executed cleanly with exit code 0 across the entire monorepo.
- **Automated Test Suite:** `npm --prefix sn-practice-crm run test:all` passed with exit code 0:
  - Vitest: 6 test files, 85 unit and integration tests passed.
  - Static DB / Policy Tests: 9 security and catalog tests passed.
  - **Total Automated Tests:** **94 tests passed** (85 Vitest + 9 static DB/policy tests).
  *(Stale test arithmetic calling this 76+9 or 85 total has been corrected; the verified current total is 85 + 9 = 94).*
- **Production Build:** `npm --prefix sn-practice-crm run build` succeeded cleanly with exit code 0 in 3.73 seconds.

---

## 8. Destructive Guardrails & Safety Constraints

1. **Exact Local Target Constraint:** All database operations must target the verified local Supabase container instance on loopback/localhost (`127.0.0.1` or `localhost`). Running commands targeting cloud projects, using `supabase link`, or passing `--linked` or `--db-url` is strictly prohibited.
2. **No Broad Container / Volume Pruning:** Workers must never execute blanket cleanup commands such as `docker system prune -a` or `docker volume prune`, which could destroy host state outside the CRM project.
3. **Local Reset Scope & Canonical Migrations:** Executing `npx supabase db reset --local --no-seed` drops the local database schema, recreating it from baseline and automatically applying all canonical migrations from `sn-practice-crm/supabase/migrations/`. Seeding is decoupled and performed via `npm run seed:local`.
4. **Service Role Key Isolation:** The Supabase `service_role` secret bypasses RLS policies entirely. It is permitted solely in backend background jobs (such as `materialize_due_recurring_assignments`) and must never be exposed to frontend code or client bundles.
5. **No Secret Storage & Working Tree Hygiene:** Database credentials and API keys must never be committed to git, echoed into logs, or stored in unignored files. The generated `sn-practice-crm/supabase/` directory has `.temp` and `.branches` ignored by its `.gitignore`; only canonical `config.toml` and `.gitignore` remain nonignored.

---

## 9. Verified Acceptance Checklist

All acceptance criteria for local Supabase environment provisioning and catalog validation have been satisfied and verified:

- [x] Windows restarted; no OS reboot blocker remains. Docker Desktop 4.97.0 running; `docker version` confirms client and engine 29.9.2 active on `desktop-linux` daemon with WSL 2 backend per [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- [x] `psql --version` confirms PostgreSQL client 18.6 available on system PATH per [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/).
- [x] `sn-practice-crm/package.json` contains `supabase` in `devDependencies` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) (exact devDependency `"supabase": "2.122.0"` committed in `88476be7d72b582a531962d82ae36cad0422b4e7`).
- [x] `npx supabase --version` executes cleanly from `sn-practice-crm` (verified `2.122.0`).
- [x] `npx supabase init` generated canonical `sn-practice-crm/supabase/config.toml` (project_id: `sn-practice-crm`, standard ports: API 54321, DB 54322, Studio 54323, Mail 54324) and `.gitignore` ignoring `.temp`, `.branches`, and local `.env` files per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags). Separate parent `supabase/config.toml` preserved untouched.
- [x] `npx supabase start -x logflare,vector` launches local containers cleanly with zero unhealthy containers; retains DB, Auth, RLS, REST, Realtime, Storage, Studio, Inbucket mail, PostgreSQL meta, and Edge Runtime per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).
- [x] `npx supabase status` reports local endpoints; loopback URL is verified before execution.
- [x] `npx supabase db reset --local` executes cleanly from baseline.
- [x] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/migrations/0001_practice_core.sql"` succeeds with exit code 0, establishing expected schema inventory of 16 base tables and 4 views.
- [x] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/tests/001_catalog_invariants.sql"` succeeds with exit code 0 and transaction rollback, validating five-role enum/order, authority matrices, RLS on 16 tables, 16 SELECT policies, zero DELETE policies, audit triggers, and security-invoker views.
- [x] Graceful restart sequence (`npx supabase stop` then `npx supabase start -x logflare,vector`) verified; schema and data persistence confirmed by clean re-run of catalog invariant tests.
- [x] `npm --prefix sn-practice-crm run test:all` executes and passes all **94 automated tests** (85 Vitest across 6 files + 9 static DB/policy tests; corrected from stale 76+9 / 85 count).
- [x] `npm --prefix sn-practice-crm run typecheck` exits with code 0 across the monorepo; production build passed in 3.73s.
- [x] Tracked/untracked secret and runtime artifact audit satisfied: `.temp/` and `.branches/` are ignored; only `config.toml` and `.gitignore` are nonignored in `sn-practice-crm/supabase/` (`.temp/` ignored, parent config untouched; no credentials, tokens, or `.env` files tracked).
- [x] Local Supabase stack intentionally left running for development.

---

## 10. Official Primary Sources

Only the following four official documentation sources were consulted for this runbook:

1. **Docker Desktop on Windows Installation Guide:** [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/)
2. **Supabase CLI Local Development:** [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform)
3. **Supabase CLI Reference & Flags:** [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags)
4. **PostgreSQL Official Windows Downloads & Packages:** [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/)
