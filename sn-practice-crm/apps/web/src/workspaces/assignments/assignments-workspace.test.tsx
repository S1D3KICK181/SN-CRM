import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(
  new URL('../../app.tsx', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const tableSource = readFileSync(
  new URL('./assignments-table.tsx', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const workspaceSource = readFileSync(
  new URL('./assignments-workspace.tsx', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

describe('Assignments workspace source contracts', () => {
  it('verifies app.tsx imports extracted modules and maintains drawer declaration boundaries', () => {
    // 1. app.tsx imports AssignmentsTable and AssignmentsWorkspace from extracted modules
    expect(appSource).toMatch(
      /import\s*\{[^}]*\bAssignmentsTable\b[^}]*\}\s*from\s*['"]\.\/workspaces\/assignments\/assignments-table['"]/,
    );
    expect(appSource).toMatch(
      /import\s*\{[^}]*\bAssignmentsWorkspace\b[^}]*\}\s*from\s*['"]\.\/workspaces\/assignments\/assignments-workspace['"]/,
    );

    // app source does not declare AssignmentsTable, AssignmentsWorkspace, or ScheduleDetailDrawer
    expect(appSource).not.toMatch(/\bfunction\s+AssignmentsTable\b/);
    expect(appSource).not.toMatch(/\bconst\s+AssignmentsTable\b/);
    expect(appSource).not.toMatch(/\bfunction\s+AssignmentsWorkspace\b/);
    expect(appSource).not.toMatch(/\bconst\s+AssignmentsWorkspace\b/);
    expect(appSource).not.toMatch(/\bfunction\s+ScheduleDetailDrawer\b/);
    expect(appSource).not.toMatch(/\bconst\s+ScheduleDetailDrawer\b/);

    // app source still declares AssignmentDetailDrawer
    expect(appSource).toMatch(/\bfunction\s+AssignmentDetailDrawer\b/);
  });

  it('verifies assignments-table exports AssignmentsTable with optional callbacks and default props', () => {
    // assignments-table source exports AssignmentsTable
    expect(tableSource).toMatch(/export\s+(?:function|const)\s+AssignmentsTable\b/);

    // retains optional onSelectAssignment/onNavigate
    expect(tableSource).toMatch(/onSelectAssignment\s*\?:\s*\(assignment:\s*AssignmentRow\)\s*=>\s*void/);
    expect(tableSource).toMatch(/onNavigate\s*\?:\s*\(page:\s*PageKey\)\s*=>\s*void/);

    // retains compact/canEdit defaults
    expect(tableSource).toMatch(/compact\s*=\s*false/);
    expect(tableSource).toMatch(/canEdit\s*=\s*false/);

    // retains existing fallbacks
    expect(tableSource).toMatch(
      /onNavigate\s*\?\s*onNavigate\(\s*['"]Assignments['"]\s*\)\s*:\s*onToast\(\s*['"]Assignments workspace opened['"]\s*\)/,
    );
    expect(tableSource).toMatch(/if\s*\(\s*onSelectAssignment\s*\)\s*onSelectAssignment\(\s*row\s*\);\s*else\s*onToast\(/);
    expect(tableSource).toMatch(/canEdit\s*&&\s*onSelectAssignment/);
  });

  it('verifies assignments-workspace module boundaries, imports, and flat required callback contracts', () => {
    // exports AssignmentsWorkspace
    expect(workspaceSource).toMatch(/export\s+(?:function|const)\s+AssignmentsWorkspace\b/);

    // imports AssignmentsTable
    expect(workspaceSource).toMatch(
      /import\s*\{[^}]*\bAssignmentsTable\b[^}]*\}\s*from\s*['"]\.\/assignments-table['"]/,
    );

    // keeps ScheduleDetailDrawer unexported
    expect(workspaceSource).toMatch(/\bfunction\s+ScheduleDetailDrawer\b/);
    expect(workspaceSource).not.toMatch(/export\s+(?:default\s+)?(?:function|const)\s+ScheduleDetailDrawer\b/);
    expect(workspaceSource).not.toMatch(/export\s*\{[^}]*\bScheduleDetailDrawer\b[^}]*\}/);

    // retains exact flat required callback props
    expect(workspaceSource).toMatch(/onToast:\s*\(message:\s*string\)\s*=>\s*void/);
    expect(workspaceSource).toMatch(/onCompose:\s*\(mode:\s*DialogMode\)\s*=>\s*void/);
    expect(workspaceSource).toMatch(/onUpdateSchedule:\s*\(updated:\s*RecurringScheduleRecord\)\s*=>\s*void/);
    expect(workspaceSource).toMatch(/onUpdateAssignment:\s*\(updated:\s*AssignmentRow\)\s*=>\s*void/);
    expect(workspaceSource).toMatch(/onSelectAssignment:\s*\(assignment:\s*AssignmentRow\)\s*=>\s*void/);

    // confirms none of these callbacks are optional
    expect(workspaceSource).not.toMatch(/onToast\?:/);
    expect(workspaceSource).not.toMatch(/onCompose\?:/);
    expect(workspaceSource).not.toMatch(/onUpdateSchedule\?:/);
    expect(workspaceSource).not.toMatch(/onUpdateAssignment\?:/);
    expect(workspaceSource).not.toMatch(/onSelectAssignment\?:/);
  });

  it('verifies critical business contracts: leadership gate, non-leadership owner scope, compose schedule, and one-off forwarding', () => {
    // founder/manager leadership gate
    expect(workspaceSource).toMatch(
      /const\s+leadership\s*=\s*role\s*===\s*['"]founder['"]\s*\|\|\s*role\s*===\s*['"]manager['"]/,
    );

    // non-leadership owner scope filtering
    expect(workspaceSource).toMatch(
      /if\s*\(!leadership\)\s*\{[\s\S]*?s\.defaultOwner\s*!==\s*myAssignedStaffName[\s\S]*?return false;\s*\}/,
    );

    // add schedule calls onCompose('schedule') inside leadership guard
    expect(workspaceSource).toMatch(/onCompose\(\s*['"]schedule['"]\s*\)/);
    expect(workspaceSource).toMatch(
      /\{leadership\s*\?\s*\([\s\S]*?onCompose\(\s*['"]schedule['"]\s*\)[\s\S]*?\)\s*:\s*null\}/,
    );

    // one-off table forwards onSelectAssignment
    expect(workspaceSource).toMatch(
      /<AssignmentsTable[\s\S]*?onSelectAssignment=\{onSelectAssignment\}[\s\S]*?\/>/,
    );
  });

  it('verifies custodian gating, bank reconciliation coupling, save mutation flow, and zero-state copy', () => {
    // custodian gate/lock logic and message
    expect(workspaceSource).toMatch(/const\s+isAssignedCustodian\s*=\s*Boolean\(/);
    expect(workspaceSource).toMatch(
      /Checklist steps, bank reconciliation, and filing progress can only be updated by the assigned custodian/,
    );
    expect(workspaceSource).toMatch(
      /Workflow\s+(?:&|&amp;)\s+filing progress locked to assigned custodian/,
    );

    // bank reconciliation / checklist coupling: checking step 0 marks bank rec Completed
    expect(workspaceSource).toMatch(
      /if\s*\(hasBank\s*&&\s*idx\s*===\s*0\s*&&\s*next\[0\]\s*&&\s*schedule\.category\s*===\s*['"]GST['"]\)\s*\{\s*setBankRecStatus\(\s*['"]Completed['"]\s*\);\s*\}/,
    );

    // bank reconciliation Completed button marks step 0 checked
    expect(workspaceSource).toMatch(
      /if\s*\(st\s*===\s*['"]Completed['"]\)\s*\{\s*setCheckedSteps\(\s*\(prev\)\s*=>\s*\(\{\s*\.\.\.prev,\s*0:\s*true\s*\}\)\s*\);\s*\}/,
    );

    // handleSave updates schedule with bankRecStatus/currentStatus then closes
    expect(workspaceSource).toMatch(
      /function\s+handleSave\(\)\s*\{[\s\S]*?if\s*\(!isAssignedCustodian\)\s*return;[\s\S]*?const\s+updated:\s*RecurringScheduleRecord\s*=\s*\{[\s\S]*?bankRecStatus,[\s\S]*?currentStatus,[\s\S]*?\};[\s\S]*?onUpdateSchedule\(updated\);[\s\S]*?onClose\(\);[\s\S]*?\}/,
    );

    // zero-state copy
    expect(workspaceSource).toMatch(/No compliance schedules match your current filters\./);
  });
});
