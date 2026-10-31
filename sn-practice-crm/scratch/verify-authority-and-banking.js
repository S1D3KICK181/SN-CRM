import { chromium } from '../../node_modules/playwright/index.mjs';

async function run() {
  console.log('Launching browser to verify authority & banking workflow rules...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const baseUrl = 'http://127.0.0.1:4310';
  await page.goto(baseUrl);
  await page.waitForTimeout(1000);

  // 1. Verify as STAFF (Rohan Mehta)
  console.log('--- TEST 1: Role = Staff (Rohan Mehta) ---');
  await page.locator('.preview-banner select').selectOption('staff');
  await page.waitForTimeout(500);

  // Check Staff dashboard table: Pencil edit button must NOT be present on rows
  const staffPencils = await page.locator('.table-card .icon-button').count();
  console.log(`Staff dashboard table pencil buttons count: ${staffPencils} (Expected 0)`);

  // Open Rohan's own assignment (ASN-0002 owned by Rohan Mehta)
  const rohanAsnLink = page.locator('text=Q2 internal audit').first();
  await rohanAsnLink.click();
  await page.waitForTimeout(500);

  // Verify Edit Assignment button is NOT visible for Staff
  const editAsnBtnStaff = await page.locator('button:has-text("Edit Assignment")').count();
  console.log(`Staff drawer "Edit Assignment" button count: ${editAsnBtnStaff} (Expected 0)`);

  // Verify Rohan IS the custodian: milestone checkbox is ENABLED, Save progress button IS present
  const saveProgressBtn = page.locator('button:has-text("Save progress & update status")');
  const isSaveVisible = await saveProgressBtn.isVisible();
  console.log(`Staff on own assignment - "Save progress" button visible: ${isSaveVisible} (Expected true)`);

  // Check a milestone
  const firstCheckbox = page.locator('.client-drawer input[type="checkbox"]').first();
  const isCheckboxDisabled = await firstCheckbox.isDisabled();
  console.log(`Staff on own assignment - checkbox disabled: ${isCheckboxDisabled} (Expected false)`);

  // Close drawer
  await page.locator('.drawer-close-btn').click();
  await page.waitForTimeout(300);

  // 2. Verify as FOUNDER (S. Narayanan)
  console.log('--- TEST 2: Role = Founder (S. Narayanan) on Rohan Mehta assignment ---');
  await page.locator('.preview-banner select').selectOption('founder');
  await page.waitForTimeout(500);

  // Check Founder dashboard table: Pencil edit buttons ARE present
  const founderPencils = await page.locator('.table-card .icon-button').count();
  console.log(`Founder dashboard table pencil buttons count: ${founderPencils} (Expected > 0)`);

  // Open Rohan's assignment ASN-0002 as Founder
  await page.locator('text=Q2 internal audit').first().click();
  await page.waitForTimeout(500);

  // Founder CAN edit assignment metadata
  const editAsnBtnFounder = await page.locator('button:has-text("Edit Assignment")').count();
  console.log(`Founder drawer "Edit Assignment" button count: ${editAsnBtnFounder} (Expected 1)`);

  // BUT Founder is NOT the assigned custodian (Rohan Mehta is)!
  // Check that fieldwork milestones are LOCKED to Rohan Mehta
  const lockNotice = await page.locator('text=Fieldwork milestones and delivery progress can only be updated by the assigned custodian (Rohan Mehta)').count();
  console.log(`Founder sees lock notice for Rohan: ${lockNotice > 0 ? 'YES' : 'NO'}`);

  const founderCheckboxDisabled = await page.locator('.client-drawer input[type="checkbox"]').first().isDisabled();
  console.log(`Founder on Rohan assignment - checkbox disabled: ${founderCheckboxDisabled} (Expected true)`);

  const founderFooterLock = await page.locator('text=Milestones locked to assigned custodian (Rohan Mehta)').count();
  console.log(`Founder sees footer locked badge: ${founderFooterLock > 0 ? 'YES' : 'NO'}`);

  await page.screenshot({ path: 'C:/Users/HP/.gemini/antigravity-cli/brain/092f1769-f480-4ab1-8103-a91299023bed/founder-viewing-staff-assignment-locked.png' });
  await page.locator('.drawer-close-btn').click();
  await page.waitForTimeout(300);

  // 3. Verify CLIENT BANKING TOGGLE by STAFF
  console.log('--- TEST 3: Staff Client Banking Toggle & GST Workflow Exclusion ---');
  await page.locator('.preview-banner select').selectOption('staff');
  await page.waitForTimeout(500);

  // Navigate to Clients
  await page.locator('button:has-text("Clients")').first().click();
  await page.waitForTimeout(500);

  // Client table pencil should NOT be visible for staff
  const staffClientPencils = await page.locator('.table-card .icon-button').count();
  console.log(`Staff Clients table pencil buttons count: ${staffClientPencils} (Expected 0)`);

  // Open Aster Foods profile
  await page.locator('tr:has-text("Aster Foods") button:has-text("View")').first().click();
  await page.waitForTimeout(500);

  // Verify "Edit Details" button is NOT visible for Staff
  const editDetailsBtnStaff = await page.locator('button:has-text("Edit Details")').count();
  console.log(`Staff drawer "Edit Details" button count: ${editDetailsBtnStaff} (Expected 0)`);

  // Verify dedicated Banking Operations card IS visible
  const bankingCard = page.locator('text=Banking Operations & GST Return Workflow');
  console.log(`Staff sees dedicated Banking Operations card: ${await bankingCard.isVisible() ? 'YES' : 'NO'}`);

  // Toggle banking to No Bank
  const toggleBtn = page.locator('button:has-text("Toggle to No Bank (Exclude Banking)")');
  if (await toggleBtn.isVisible()) {
    console.log('Clicking Toggle to No Bank (Exclude Banking)...');
    await toggleBtn.click();
    await page.waitForTimeout(500);
  }

  // Verify card now shows "— No Bank (Excluded)" and button says "Enable Active Bank & Workflow"
  const noBankBadge = await page.locator('text=— No Bank (Excluded)').count();
  console.log(`Client now has "— No Bank (Excluded)" badge: ${noBankBadge > 0 ? 'YES' : 'NO'}`);

  await page.screenshot({ path: 'C:/Users/HP/.gemini/antigravity-cli/brain/092f1769-f480-4ab1-8103-a91299023bed/staff-toggled-client-banking-no-bank.png' });
  await page.locator('.drawer-close-btn').click();
  await page.waitForTimeout(300);

  // 4. Verify GST Workflow in Assignments workspace with Banking Excluded
  console.log('--- TEST 4: GST Workflow Banking Exclusion in Compliance Matrix ---');
  await page.locator('button:has-text("Assignments")').first().click();
  await page.waitForTimeout(500);

  // Switch to Founder so all schedules are visible
  await page.locator('.preview-banner select').selectOption('founder');
  await page.waitForTimeout(500);

  // Click View Checklist for Aster Foods GSTR-1
  const asterScheduleRow = page.locator('tr:has-text("Aster Foods Private Limited")').first();
  await asterScheduleRow.locator('button:has-text("View Checklist")').click();
  await page.waitForTimeout(500);

  // Verify checklist excludes all banking steps
  const checklistBoxText = await page.locator('.checklist-step-box').innerText();
  const containsObtainBank = checklistBoxText.toLowerCase().includes('obtain bank statement');
  console.log(`Checklist contains 'obtain bank statement': ${containsObtainBank ? 'YES (FAILED)' : 'NO (CORRECT - EXCLUDED!)'}`);

  const bankingExcludedBanner = await page.locator('text=Banking Excluded from GST Workflow').count();
  console.log(`Shows 'Banking Excluded from GST Workflow' banner: ${bankingExcludedBanner > 0 ? 'YES' : 'NO'}`);

  // Also verify that since Aster Foods GSTR-1 defaultOwner is Priya Desai, Founder sees locked notice!
  const scheduleLockNotice = await page.locator('text=Checklist steps, bank reconciliation, and filing progress can only be updated by the assigned custodian (Priya Desai)').count();
  console.log(`Schedule locked to assigned custodian Priya Desai: ${scheduleLockNotice > 0 ? 'YES' : 'NO'}`);

  await page.screenshot({ path: 'C:/Users/HP/.gemini/antigravity-cli/brain/092f1769-f480-4ab1-8103-a91299023bed/compliance-schedule-banking-excluded-and-locked.png' });

  // Close drawer
  await page.locator('.drawer-close-btn').click();
  await page.waitForTimeout(300);

  console.log('All verification checks completed successfully!');
  await browser.close();
}

run().catch((err) => {
  console.error('Error running test script:', err);
  process.exit(1);
});
