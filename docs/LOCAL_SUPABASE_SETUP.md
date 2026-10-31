# Local Supabase Setup & Verification Runbook

> - **Task Reference:** `CRM-P1-T9A`
> - **Date:** 2026-10-31
> - **Platform:** Windows 11 (PowerShell 5.1)
> - **Canonical Workspace:** `C:\Users\HP\Mohammed\CRM`
> - **Canonical Target Directory:** `C:\Users\HP\Mohammed\CRM\sn-practice-crm`
> - **Initial Baseline Commit:** `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1`
> - **Status Refresh Base Commit:** `0ea6ff88ee361787274650a12c84679120d24220`

---

> [!WARNING]
> ### CURRENT STATUS: TOOLING INSTALLED — RUNTIME INITIALIZATION PENDING RESTART
>
> **Required local tooling (`docker` CLI, `supabase` CLI, `psql`) is installed on this host, but runtime engines are NOT running.**
>
> - **Docker Desktop:** Official WinGet package `Docker.DockerDesktop 4.97.0` is installed (Docker CLI `29.9.2, build a82e528`). Windows reports a pending CBS reboot. Docker Desktop has **NOT** been launched, the Docker daemon has **NOT** been verified, and first-launch terms have **NOT** been accepted.
> - **Supabase CLI:** Project-local Supabase CLI `2.122.0` is installed as exact `devDependencies` `"supabase": "2.122.0"` in `sn-practice-crm/package.json` with lockfile (committed in `88476be7d72b582a531962d82ae36cad0422b4e7`). `npx supabase --version` succeeded (`2.122.0`).
> - **PostgreSQL Client:** PostgreSQL `18.6-5` is installed through Scoop (`psql (PostgreSQL) 18.6`). User PATH contains `C:\Users\HP\scoop\apps\postgresql\current\bin`. Pre-existing long-lived terminals may need reopening to refresh PATH. No PostgreSQL background service or process was started.
> - **Local Stack & Database:** `npx supabase init`, `npx supabase start`, `npx supabase status`, containers, database migration (`0001_practice_core.sql`), and live catalog invariant SQL (`001_catalog_invariants.sql`) have **NOT** run.
>
> No Docker/Supabase/PostgreSQL runtime or local database container was started. The next manual action is: restart Windows, launch Docker Desktop, accept its first-launch terms, then verify the daemon.

---

## 1. Preflight Environment Evidence (Historical Pre-Install Snapshot)

> [!NOTE]
> **HISTORICAL PRE-INSTALL SNAPSHOT (Captured 2026-10-31 @ commit `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1`):**
> The table below records baseline preflight observations captured prior to prerequisite installation. These absence records reflect the historical state when CRM-P1-T9A was first drafted; see Section 2 for the current post-installation tooling state.

All checks executed non-interactively in Windows PowerShell from canonical root `C:\Users\HP\Mohammed\CRM` on 2026-10-31:

| Check / Command | Expected | Observed Output | Exit Code | Status |
| :--- | :--- | :--- | :--- | :--- |
| `git rev-parse HEAD` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | `03fc85d65d5af033e98b8ba6040cc7b2f75bc0a1` | 0 | **Verified** |
| `git status --short` | Clean working tree | *(Empty)* | 0 | **Verified Clean** |
| `node --version` | Node 20+ required | `v26.13.0` | 0 | **Satisfied** |
| `npm --version` | Compatible npm package manager | `11.20.0` | 0 | **Satisfied** |
| `Get-Command docker -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap — Historical Snapshot)** |
| `Get-Command supabase -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap — Historical Snapshot)** |
| `Get-Command psql -ErrorAction SilentlyContinue` | Binary present | *(No output / Null)* | 0 | **ABSENT (Gap — Historical Snapshot)** |
| `Test-Path sn-practice-crm/supabase/config.toml` | `False` (uninitialized) | `False` | 0 | **Expected Uninitialized** |
| `Test-Path sn-practice-crm/database/package.json` | `False` (no bespoke runner) | `False` | 0 | **Expected Clean** |

*Zero secrets, tokens, or environment keys were accessed, printed, or recorded.*

---

## 2. Tooling Status & Official Installation Guidance

### 2.1 Current Tooling Status

| Tool / Component | Installed Version / Package | Verification Evidence | Current State & Remaining Action |
| :--- | :--- | :--- | :--- |
| **Docker Desktop** | `Docker.DockerDesktop 4.97.0` (WinGet) | Direct binary at `C:\Program Files\Docker\Docker\resources\bin\docker.exe` reports Docker CLI `29.9.2, build a82e528` | **Installed; daemon unverified.** Windows reports pending CBS reboot. Docker Desktop NOT launched; first-launch terms NOT accepted. Remaining: Restart Windows, launch Docker Desktop, accept terms, verify daemon. |
| **Supabase CLI** | Project-local `supabase: 2.122.0` (exact `devDependencies` in `sn-practice-crm/package.json`, commit `88476be7d72b582a531962d82ae36cad0422b4e7`) | `npx supabase --version` executed cleanly with exit code 0 (`2.122.0`) | **Installed locally; stack uninitialized.** Containers and `supabase init`/`start`/`status` NOT run. Remaining: Run `npx supabase init` and `npx supabase start` once Docker daemon is live. |
| **PostgreSQL (`psql`)** | PostgreSQL `18.6-5` (Scoop) | Direct binary reports `psql (PostgreSQL) 18.6`. User PATH includes `C:\Users\HP\scoop\apps\postgresql\current\bin` | **Installed; client utility only.** No background PostgreSQL service or daemon was started. Pre-existing long-lived terminal may need reopening to refresh PATH. Remaining: Execute core migration and invariant tests once local database is up. |

> [!NOTE]
> **INSTALLATION VS. RUNTIME INITIALIZATION:** Prerequisite tooling packages have been installed on the host. However, runtime daemons, containers, local Supabase stacks, and database migrations remain unexecuted pending system reboot and manual first launch.

### 2.2 Container Runtime: Docker Desktop on Windows
- **Official Source & Installation:** Per the official [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) guide, Docker Desktop specifies a per-user installation with the WSL 2 backend as the standard configuration on Windows 10/11 64-bit.
- **Requirements:** Windows 10/11 64-bit with WSL 2 feature enabled and an updated Linux kernel package (`wsl --update`), as outlined in [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Installation Procedure:** Download `Docker Desktop Installer.exe` from official Docker channels or install via WinGet (`winget install Docker.DockerDesktop`), ensuring the "Use WSL 2 instead of Hyper-V" option is selected, following [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/).
- **Service Verification:** Docker Desktop must be launched and the daemon verified running before invoking container commands.

### 2.3 CLI Tooling: Project-Local Supabase CLI (npm / npx)
- **Official Source & Installation:** As specified in [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform), the Supabase CLI is installed as a project-local devDependency using `npm install supabase --save-dev` inside the project root, with commands executed via `npx supabase <command>`.
- **Requirements:** Node.js 20+ is required according to [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) (the current host runtime `v26.13.0` satisfies this requirement).
- **Target Location:** Installed strictly inside `sn-practice-crm/` (`sn-practice-crm/package.json` devDependencies as `"supabase": "2.122.0"`), never globally or at the parent repository root.
- **Command Invocation:** All subsequent commands use `npx supabase` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) to guarantee version locking and sandbox reproducibility.

### 2.4 Database Client Tooling: PostgreSQL `psql`
- **Official Source & Distribution:** The [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) page provides certified EDB Windows installers and archive packages to obtain client utilities including `psql`.
- **Requirements:** `psql` command-line executable installed on the host and available in Windows `PATH`, as described in [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/).
- **Verification Rule:** `Get-Command psql` (or direct path invocation `C:\Users\HP\scoop\apps\postgresql\current\bin\psql.exe`) must resolve successfully before attempting direct SQL script execution.

---

## 3. Safe Verification Commands (Post-Restart & Post-First-Launch)

> [!IMPORTANT]
> **PREREQUISITE GATE: RUN ONLY AFTER RESTART AND FIRST LAUNCH.**
>
> Because Windows has a pending CBS reboot and Docker Desktop has not completed its first launch or accepted terms of service, these verification commands must be executed only after:
> 1. Windows is restarted.
> 2. Docker Desktop is launched and its first-launch terms of service are accepted.
> 3. The Docker engine is confirmed running in the system tray.
> 4. A fresh PowerShell terminal is opened to pick up environment and PATH variables.
>
> Zero secrets, tokens, or environment keys should be printed or recorded.

```powershell
# 1. Verify container runtime daemon and WSL 2 backend
docker version

# 2. Verify project-local Supabase CLI via npx from canonical sn-practice-crm root
Set-Location "C:\Users\HP\Mohammed\CRM\sn-practice-crm"
npx supabase --version

# 3. Verify PostgreSQL client on system PATH
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

- [ ] `docker version` confirms Docker daemon running with WSL 2 backend per [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/) (Docker Desktop 4.97.0 installed; first launch, terms acceptance, and daemon verification pending Windows restart).
- [x] `psql --version` confirms PostgreSQL client available on system PATH per [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/) (PostgreSQL 18.6-5 installed via Scoop; direct psql reports 18.6; long-lived shells may require reopening).
- [x] `sn-practice-crm/package.json` contains `supabase` in `devDependencies` per [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform) (exact devDependency `"supabase": "2.122.0"` committed in `88476be7d72b582a531962d82ae36cad0422b4e7`).
- [x] `npx supabase --version` executes cleanly from `sn-practice-crm` (verified `2.122.0`).
- [ ] `npx supabase init` generates valid `sn-practice-crm/supabase/config.toml` per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).
- [ ] `npx supabase start` launches local containers with zero port conflicts per [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags).
- [ ] `npx supabase status` reports local endpoints; loopback URL is verified before execution.
- [ ] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/migrations/0001_practice_core.sql"` succeeds with exit code 0.
- [ ] `psql -v ON_ERROR_STOP=1 "$crmLocalDatabaseUrl" -f "database/tests/001_catalog_invariants.sql"` succeeds with exit code 0 and transaction rollback.
- [x] `npm --prefix sn-practice-crm run test:all` executes and passes all **85 automated tests** (76 Vitest + 9 static DB/policy).
- [x] `npm --prefix sn-practice-crm run typecheck` exits with code 0 across the monorepo (typecheck and production build passed).
- [ ] A final tracked/untracked secret/runtime-artifact audit is still required before provisioning completion (verifying no `.env`, secret tokens, or unintended runtime caches are tracked).

---

## 9. Official Primary Sources

Only the following four official documentation sources were consulted for this runbook:

1. **Docker Desktop on Windows Installation Guide:** [Docker Desktop Windows installation](https://docs.docker.com/desktop/setup/install/windows-install/)
2. **Supabase CLI Local Development:** [Supabase CLI local development](https://supabase.com/docs/guides/local-development/cli/getting-started?platform=npm&queryGroups=platform)
3. **Supabase CLI Reference & Flags:** [Supabase CLI reference](https://supabase.com/docs/reference/cli/global-flags)
4. **PostgreSQL Official Windows Downloads & Packages:** [PostgreSQL Windows downloads](https://www.postgresql.org/download/windows/)
