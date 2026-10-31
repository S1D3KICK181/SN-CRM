# Local Supabase Setup & Verification Runbook

> - **Task Reference:** `CRM-P1-T9A`
> - **Date:** 2026-10-31
> - **Platform:** Windows 11 (PowerShell 5.1)
> - **Canonical Workspace:** `C:\Users\HP\Mohammed\CRM`
> - **Canonical Target Directory:** `C:\Users\HP\Mohammed\CRM\sn-practice-crm`
> - **Accepted Parent Commit:** `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1`

---

> [!CAUTION]
> ### CURRENT STATUS: BLOCKED — PREREQUISITES ABSENT
>
> **Required local tooling (`docker`, `supabase`, `psql`) is not installed on this host.**
>
> **Database migration and live catalog invariant verification (`001_catalog_invariants.sql`) have NOT run.**
>
> No containers, daemons, background processes, or network links were started or altered during this task.

---

## 1. Preflight Environment Evidence

All checks executed non-interactively in Windows PowerShell from canonical root `C:\Users\HP\Mohammed\CRM` on 2026-10-31:

| Check / Command | Expected | Observed Output | Exit Code | Status |
| :--- | :--- | :--- | :--- | :--- |
| `git rev-parse HEAD` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | 0 | **Verified** |
| `git status --short` | Clean working tree | *(Empty)* | 0 | **Verified Clean** |
| `node --version` | Node 20+ required | `v26.13.0` | 0 | **Satisfied** |
| `npm --version` | Compatible npm package manager | `11.20.0` | 0 | **Satisfied** |
| `Get-Command docker -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap)** |
| `Get-Command supabase -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap)** |
| `Get-Command psql -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap)** |
| `Test-Path sn-practice-crm/supabase/config.toml` | `False` (uninitialized) | `False` | 0 | **Expected Uninitialized** |
| `Test-Path sn-practice-crm/database/package.json` | `False` (no bespoke runner) | `False` | 0 | **Expected Clean** |

*Zero secrets, tokens, or environment keys were accessed, printed, or recorded.*

---

## 2. Official Windows Prerequisite Installation Instructions

> [!IMPORTANT]
> **STATUS OF COMMANDS IN THIS SECTION: NOT EXECUTED.**
>
> This documentation task is strictly non-mutating. Software installation, system configuration changes, and package installations require authorization and a subsequent dedicated implementation task.

### 2.1 Container Runtime: Docker Desktop on Windows
- **Official Source & Installation:** Per the official [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) guide, Docker Desktop specifies a per-user installation with the WSL 2 backend as the standard configuration on Windows 10/11 64-bit.
- **Requirements:** Windows 10/11 64-bit with WSL 2 feature enabled and an updated Linux kernel package (`wsl --update`), as outlined in [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Installation Procedure:** Download `Docker Desktop Installer.exe` from official Docker channels and execute the installer ensuring the "Use WSL 2 instead of Hyper-V" option is selected, following [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Service Verification:** Docker Desktop must be launched and the daemon verified running before invoking container commands.

### 2.2 CLI Tooling: Project-Local Supabase CLI (npm / npx)
- **Official Source & Installation:** As specified in [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform), the Supabase CLI is installed as a project-local devDependency using `npm install supabase --save-dev` inside the project root, with commands executed via `npx supabase <command>`.
- **Requirements:** Node.js 20+ is required according to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) (the current host runtime `v26.13.0` satisfies this requirement).
- **Target Location:** Must be installed strictly inside `sn-practice-crm/` (`sn-practice-crm/package.json`), never globally or at the parent repository root.
- **Command Invocation:** All subsequent commands use `npx supabase` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) to guarantee version locking and sandbox reproducibility.

### 2.3 Database Client Tooling: PostgreSQL `psql`
- **Official Source & Distribution:** The [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) page provides certified EDB Windows installers and archive packages to obtain client utilities including `psql`.
- **Requirements:** `psql` command-line executable installed on the host and available in Windows `PATH`, as described in [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/).
- **Verification Rule:** `Get-Command psql` must resolve successfully before attempting direct SQL script execution.

---

## 3. Safe Future Verification Commands

> [!NOTE]
> **STATUS: NOT EXECUTED.**
>
> The next worker must run these read-only checks to confirm tool readiness prior to any stack initialization:

```powershell
# Verify container runtime daemon
docker version

# Verify project-local Supabase CLI via npx from sn-practice-crm root
Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
npx supabase --version

# Verify PostgreSQL client on system PATH
psql --version
```

---

## 4. Local Stack Initialization Workflow

> [!IMPORTANT]
> **STATUS: NOT EXECUTED.**
>
> Initialization must take place exclusively from canonical directory `C:\Users\HP\Mohammed\CRM\sn-practice-crm`.

1. **Step 1 — Local Initialization:**
   ```powershell
   Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
   npx supabase init
   ```
   *Official Fact:* According to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) and the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase init` creates a local `supabase/config.toml` file. It operates entirely locally and does **not** sign in, require authentication, or connect to any remote or hosted project.

2. **Step 2 — Configuration Review:**
   Inspect the generated `supabase/config.toml` and review the configured local port bindings alongside the actual status output to ensure no port collisions occur with existing host services, as guided by the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).

3. **Step 3 — Container Stack Startup:**
   ```powershell
   npx supabase start
   ```
   *Official Fact:* According to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) and the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase start` starts the local Supabase services in the supported container runtime (Docker Desktop using the WSL 2 backend on Windows, per [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/)).

---

## 5. Database Migration Layout & Execution Truth

### 5.1 File Placement Architecture
- **Authoritative Core Migration:** Located at `sn-practice-crm/database/migrations/0001_practice_core.sql` (2,960 lines).
- **Supabase CLI Convention:** As documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags) and [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform), the Supabase CLI applies migration files from `sn-practice-crm/supabase/migrations/` using timestamped naming (e.g., `YYYYMMDDHHMMSS_name.sql`).
- **Architectural Truth (Source-Backed Fact & Project Inference):** Because authoritative core migration SQL resides under `database/migrations/` and not `supabase/migrations/`, running local database reset alone drops and recreates the database schema but will **not** apply `0001_practice_core.sql`. This is a source-backed fact based on official CLI behavior documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags) combined with this repository's project-specific directory structure.

### 5.2 Safe Future Local-Only Execution Sequence
When the environment is operational, the next worker must follow this strict sequence:

1. **Ensure Working Directory:**
   ```powershell
   Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
   ```

2. **Reset Local Database (Approved Local Target Only):**
   ```powershell
   npx supabase db reset --local
   ```
   *Official Fact:* As documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase db reset --local` resets the local database by recreating it from baseline and running local migrations in `supabase/migrations`. Never use `--linked` or `--db-url` in this verification task; all actions must remain strictly local.

3. **Inspect Local Stack Status & Define Task-Scoped Connection Variable:**
   ```powershell
   # Run status from the canonical target to inspect endpoints
   npx supabase status
   ```
   *Official Fact & Workflow:* Per the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags), `supabase status` displays the local service URLs and connection details.
   - Run `npx supabase status` from the exact canonical target directory (`C:\Users\HP\Mohammed\CRM\sn-practice-crm`).
   - Copy only the LOCAL database URL reported by that local stack into a task-scoped placeholder:
     ```powershell
     $crmLocalDatabaseUrl = '<LOCAL_DATABASE_URL_REPORTED_BY_NPX_SUPABASE_STATUS>'
     ```
   - **Do not paste the full status output into task logs or files**, because status output may also display local anon and service-role keys.
   - Explicitly validate that the chosen connection targets loopback/local before executing `psql`, and abort otherwise:
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
   The flag `-v ON_ERROR_STOP=1` halts execution immediately if any SQL statement fails.

5. **Execute Catalog Invariants Verification:**
   ```powershell
   psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/tests/001_catalog_invariants.sql"
   ```

---

## 6. Catalog Invariant Test Inspection (`001_catalog_invariants.sql`)

Direct inspection of `sn-practice-crm/database/tests/001_catalog_invariants.sql` (294 total lines) confirms the file structure and transaction safety:

- **Line 5:** `begin;` — Opens an explicit transaction block.
- **Lines 7–292:** `do $verify$ ... $verify$;` — Contains an anonymous PL/pgSQL validation block that inspects the PostgreSQL system catalog (`pg_catalog`, `pg_type`, `pg_enum`, `pg_class`, `pg_trigger`, `pg_attrdef`):
  - Validates `app_role` enum elements and exact sorting: `('founder', 'manager', 'senior_staff', 'staff', 'trainee')` (Lines 16–28).
  - Validates pure authority functions: `role_may_delegate`, `assignment_transition_allowed`, `work_item_transition_allowed` (Lines 30–74).
  - Validates RLS enabled on all 16 business tables (Lines 76–100).
  - Validates 15 business audit triggers (`audit_%`) (Lines 221–232).
  - Validates 4 security-invoker dashboard views (`reloptions @> array['security_invoker=true']`) (Lines 234–250).
  - Validates deferred constraint triggers for role/reporting integrity (Lines 252–275).
  - Validates assignment code auto-generation default expression referencing `assignment_code_seq` (Lines 277–290).
- **Line 294:** `rollback;` — Explicitly aborts the transaction block.

> [!NOTE]
> Because line 294 rolls back the explicit transaction block, no changes from this verification script persist when it completes normally. This guarantees isolation for the inspected verification script itself without implying broader system guarantees.

---

## 7. Destructive Guardrails & Safety Constraints

1. **Exact Local Target Constraint:** All database operations must target the verified local Supabase container instance on loopback/localhost (`127.0.0.1` or `localhost`). Running commands targeting cloud projects, using `supabase link`, or passing `--linked` or `--db-url` is strictly prohibited.
2. **No Broad Container / Volume Pruning:** Workers must never execute blanket cleanup commands such as `docker system prune -a` or `docker volume prune`, which could destroy host state outside the CRM project.
3. **Local Reset Scope:** Be aware that `npx supabase db reset --local` drops the local database schema, recreating it from baseline as documented in the [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags). It is safe during local testing before data accumulation, but future persistent fixtures must be scripted.
4. **Service Role Key Isolation:** The Supabase `service_role` secret bypasses RLS policies entirely. It is permitted solely in backend background jobs (such as `materialize_due_recurring_assignments`) and must never be exposed to frontend code or client bundles.
5. **No Secret Storage:** Database credentials and API keys must never be committed to git, echoed into logs, or stored in unignored files.

---

## 8. Next-Worker Acceptance Checklist

Prior to claiming completion of local database provisioning in a subsequent task, the implementation worker must satisfy every check:

- [ ] `docker version` confirms Docker daemon running with WSL 2 backend per [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- [ ] `psql --version` confirms PostgreSQL client available on system PATH per [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/).
- [ ] `sn-practice-crm/package.json` contains `supabase` in `devDependencies` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform).
- [ ] `npx supabase --version` executes cleanly from `sn-practice-crm`.
- [ ] `npx supabase init` generates valid `sn-practice-crm/supabase/config.toml` per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).
- [ ] `npx supabase start` launches local containers with zero port conflicts per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).
- [ ] `npx supabase status` reports local endpoints; loopback URL is verified before execution.
- [ ] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/migrations/0001_practice_core.sql"` succeeds with exit code 0.
- [ ] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/tests/001_catalog_invariants.sql"` succeeds with exit code 0 and transaction rollback.
- [ ] `npm --prefix sn-practice-crm run test:all` executes and passes all **75 automated tests** (24 domain + 42 API + 9 static DB).
- [ ] `npm --prefix sn-practice-crm run typecheck` exits with code 0 across the monorepo.
- [ ] `git status` verifies no `.env`, secret tokens, or unintended runtime caches are tracked.

---

## 9. Official Primary Sources

Only the following four official documentation sources were consulted for this runbook:

1. **Docker Desktop on Windows Installation Guide:** [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/)
2. **Supabase CLI Local Development:** [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform)
3. **Supabase CLI Reference & Flags:** [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags)
4. **PostgreSQL Official Windows Downloads & Packages:** [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/)
