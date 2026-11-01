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

const drawerSource = readFileSync(
  new URL('./assignment-detail-drawer.tsx', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

describe('Assignments workspace source contracts', () => {
  it('verifies app.tsx imports extracted modules and maintains drawer declaration boundaries', () => {
    // 1. app.tsx imports AssignmentsTable, AssignmentsWorkspace, and AssignmentDetailDrawer from extracted modules
    expect(appSource).toMatch(
      /import\s*\{[^}]*\bAssignmentDetailDrawer\b[^}]*\}\s*from\s*['"]\.\/workspaces\/assignments\/assignment-detail-drawer['"]/,
    );
    expect(appSource).toMatch(
      /import\s*\{[^}]*\bAssignmentsTable\b[^}]*\}\s*from\s*['"]\.\/workspaces\/assignments\/assignments-table['"]/,
    );
    expect(appSource).toMatch(
      /import\s*\{[^}]*\bAssignmentsWorkspace\b[^}]*\}\s*from\s*['"]\.\/workspaces\/assignments\/assignments-workspace['"]/,
    );

    // app source does not declare AssignmentsTable, AssignmentsWorkspace, ScheduleDetailDrawer, or AssignmentDetailDrawer
    expect(appSource).not.toMatch(/\bfunction\s+AssignmentsTable\b/);
    expect(appSource).not.toMatch(/\bconst\s+AssignmentsTable\b/);
    expect(appSource).not.toMatch(/\bfunction\s+AssignmentsWorkspace\b/);
    expect(appSource).not.toMatch(/\bconst\s+AssignmentsWorkspace\b/);
    expect(appSource).not.toMatch(/\bfunction\s+ScheduleDetailDrawer\b/);
    expect(appSource).not.toMatch(/\bconst\s+ScheduleDetailDrawer\b/);
    expect(appSource).not.toMatch(/\bfunction\s+AssignmentDetailDrawer\b/);
    expect(appSource).not.toMatch(/\bconst\s+AssignmentDetailDrawer\b/);

    // AssignmentDetailDrawer mount remains wired in app.tsx overlays
    expect(appSource).toMatch(
      /<AssignmentDetailDrawer[\s\S]*?assignment=\{selectedAssignmentForDrawer\}[\s\S]*?leadership=\{role === 'founder' \|\| role === 'manager'\}[\s\S]*?role=\{role\}[\s\S]*?onClose=\{[^}]*\}[\s\S]*?onToast=\{setToast\}[\s\S]*?onUpdateAssignment=\{handleUpdateAssignment\}[\s\S]*?onOpenInvoice=\{handleOpenInvoiceForAssignment\}[\s\S]*?\/>/,
    );
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

  it('verifies assignment-detail-drawer exports AssignmentDetailDrawer with exact flat interface, optional props, and defaults', () => {
    // exports AssignmentDetailDrawer
    expect(drawerSource).toMatch(/export\s+(?:function|const)\s+AssignmentDetailDrawer\b/);

    // flat interface and required props
    expect(drawerSource).toMatch(/assignment:\s*AssignmentRow/);
    expect(drawerSource).toMatch(/leadership:\s*boolean/);
    expect(drawerSource).toMatch(/onClose:\s*\(\)\s*=>\s*void/);
    expect(drawerSource).toMatch(/onToast:\s*\(msg:\s*string\)\s*=>\s*void/);
    expect(drawerSource).toMatch(/onUpdateAssignment:\s*\(updated:\s*AssignmentRow\)\s*=>\s*void/);

    // required callbacks are not optional
    expect(drawerSource).not.toMatch(/onClose\?:/);
    expect(drawerSource).not.toMatch(/onToast\?:/);
    expect(drawerSource).not.toMatch(/onUpdateAssignment\?:/);

    // optional props and defaults
    expect(drawerSource).toMatch(/role\?:\s*CompanyRole/);
    expect(drawerSource).toMatch(/onOpenInvoice\?:\s*\(asn:\s*AssignmentRow\)\s*=>\s*void/);
    expect(drawerSource).toMatch(/initialEditing\?:\s*boolean/);
    expect(drawerSource).toMatch(/initialEditing\s*=\s*false/);
  });

  it('verifies assignment-detail-drawer critical contracts: edit gates, custodian locking, progress, bank exemption, invoice flow, and working papers', () => {
    // founder/manager edit gate
    expect(drawerSource).toMatch(
      /const\s+canEditAssignment\s*=\s*role\s*===\s*['"]founder['"]\s*\|\|\s*role\s*===\s*['"]manager['"]/,
    );
    expect(drawerSource).toMatch(
      /\{canEditAssignment\s*\?\s*\([\s\S]*?Edit Assignment[\s\S]*?\)\s*:\s*null\}/,
    );

    // custodian detection logic and lock copy
    expect(drawerSource).toMatch(/const\s+isAssignedCustodian\s*=\s*Boolean\(/);
    expect(drawerSource).toMatch(
      /Fieldwork milestones and delivery progress can only be updated by the assigned custodian/,
    );
    expect(drawerSource).toMatch(
      /Milestones locked to assigned custodian \(\{assignment\.owner\}\)/,
    );

    // milestone progress calculation
    expect(drawerSource).toMatch(
      /Math\.round\(\s*\(\s*doneCount\s*\/\s*next\.length\s*\)\s*\*\s*100\s*\)/,
    );
    expect(drawerSource).toMatch(
      /Math\.round\(\s*\(\s*doneCount\s*\/\s*milestones\.length\s*\)\s*\*\s*100\s*\)/,
    );
    expect(drawerSource).toMatch(
      /Math\.round\(\s*\(\s*visibleMilestones\.filter\([\s\S]*?done\)\.length\s*\/\s*\(visibleMilestones\.length\s*\|\|\s*1\)\s*\)\s*\*\s*100\s*\)/,
    );

    // bank exemption filtering and bankRecStatus edit logic
    expect(drawerSource).toMatch(
      /if\s*\(\s*assignment\.bankStatementRequired\s*===\s*false\s*\)\s*\{[\s\S]*?(?:milestones|indexed)\.filter\([\s\S]*?bank statement[\s\S]*?bank reconciliation[\s\S]*?\)/,
    );
    expect(drawerSource).toMatch(
      /bankRecStatus:\s*editBankStatementReq\s*\?\s*\(assignment\.bankRecStatus\s*\|\|\s*['"]Awaited['"]\)\s*:\s*['"]Not applicable['"]/,
    );

    // invoice leadership/unbilled guard with close then callback
    expect(drawerSource).toMatch(/!assignment\.billed\s*&&\s*leadership/);
    expect(drawerSource).toMatch(
      /onClick=\{\(\)\s*=>\s*\{[\s\S]*?onClose\(\);[\s\S]*?if\s*\(\s*onOpenInvoice\s*\)\s*onOpenInvoice\(\s*assignment\s*\);[\s\S]*?\}\}/,
    );
    expect(drawerSource).toMatch(/Raise Tax Invoice for this Assignment/);

    // working-paper toasts
    expect(drawerSource).toMatch(/onToast\(\s*`Downloaded \$\{paper\}`\s*\)/);
    expect(drawerSource).toMatch(/onToast\(\s*`Added working paper reference`\s*\)/);
  });

  it('verifies assignment edit form submits without redundant onClick double save', () => {
    // Edit form retains onSubmit={handleSaveEdit}
    expect(drawerSource).toMatch(
      /<form\b[^>]*\bid="assignment-edit-form"[^>]*\bonSubmit=\{handleSaveEdit\}/,
    );

    // Footer submit button retains type="submit" and form="assignment-edit-form"
    const footerSubmitMatch = drawerSource.match(
      /<button\b[^>]*\bform="assignment-edit-form"[\s\S]*?>\s*<Check\b/,
    );
    expect(footerSubmitMatch).toBeTruthy();
    expect(footerSubmitMatch![0]).toMatch(/\btype="submit"/);

    // Submit button no longer has an onClick that invokes handleSaveEdit
    expect(footerSubmitMatch![0]).not.toMatch(/\bonClick/);
  });

  it('verifies filtered milestone toggling targets original sourceIndex instead of local visible idx', () => {
    // Rejects passing the filtered map's local idx to toggleMilestone
    expect(drawerSource).not.toMatch(/toggleMilestone\(\s*idx\s*\)/);

    // Derives visible milestone entries with their original source index before filtering
    expect(drawerSource).toMatch(/milestones\.map\([^)]*sourceIndex[^)]*\)/);

    // Passes sourceIndex to toggleMilestone
    expect(drawerSource).toMatch(/toggleMilestone\(\s*sourceIndex\s*\)/);
  });

  it('verifies drawer uses semantic color tokens instead of hardcoded hex literals', () => {
    // Drawer contains none of the hardcoded hex color literals
    expect(drawerSource).not.toMatch(/#01b574/i);
    expect(drawerSource).not.toMatch(/#f1f5f9/i);
    expect(drawerSource).not.toMatch(/#64748b/i);

    // Uses the existing semantic roles for these exact states
    expect(drawerSource).toMatch(
      /background:\s*['"]var\(--canvas\)['"],\s*color:\s*['"]var\(--ink-muted\)['"]/,
    );
    expect(drawerSource).toMatch(
      /color:\s*['"]var\(--success\)['"],\s*fontWeight:\s*600/,
    );
  });
});
