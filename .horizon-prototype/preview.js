const iconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M9 12v2h6v-2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-5A8 8 0 1 1 21 15z"/>',
  receipt: '<path d="M6 2l2 2 2-2 2 2 2-2 2 2 2-2v20l-2-2-2 2-2-2-2 2-2-2-2 2V2z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 13h2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16l4-5 4 3 5-8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 .68 1.65 1.65 0 0 0-.26.92V21h-4v-.09a1.65 1.65 0 0 0-1.08-1.59 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-.68A1.65 1.65 0 0 0 10.18 2H14v.09a1.65 1.65 0 0 0 1.08 1.59 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.38.12.79 0 1H21v4h-1.6c.12.33.12.67 0 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warning: '<path d="M10.3 3.6L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
  building: '<path d="M3 21h18M6 21V5l6-3 6 3v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/>',
};

function icon(name, className = '') {
  return `<svg class='icon ${className}' aria-hidden='true' viewBox='0 0 24 24'>${iconPaths[name] ?? iconPaths.dashboard}</svg>`;
}

const variants = {
  A: { label: 'A · Horizon classic', render: renderClassic },
  B: { label: 'B · Operations first', render: renderOperations },
  C: { label: 'C · Leadership view', render: renderLeadership },
};

const assignments = {
  gst: {
    code: 'ASN-0001',
    title: 'GST return — September',
    client: 'Aster Foods Private Limited',
    due: '03/11/2026',
    status: 'In Progress',
    progress: 72,
    owner: 'Priya Desai',
    blocker: 'No blocker. Two portal exceptions remain for review.',
  },
  audit: {
    code: 'ASN-0002',
    title: 'Q2 internal audit',
    client: 'BluePeak Technologies LLP',
    due: '06/11/2026',
    status: 'Pending Internal Review',
    progress: 84,
    owner: 'Rohan Mehta',
    blocker: 'Awaiting management response on the revenue cut-off observation.',
  },
  docs: {
    code: 'ASN-0003',
    title: 'Collect missing bank statements',
    client: 'Sharma Retail',
    due: '30/10/2026',
    status: 'Awaiting Client Documents',
    progress: 45,
    owner: 'Neha Kapoor',
    blocker: 'October bank statement and two purchase invoices are still missing.',
  },
  collection: {
    code: 'INV-2048',
    title: 'Collections follow-up',
    client: 'BluePeak Technologies LLP',
    due: 'Today',
    status: 'Overdue',
    progress: 30,
    owner: 'Finance team',
    blocker: '₹88,500 remains unpaid. Last reminder was sent five days ago.',
  },
};

const navGroups = [
  {
    label: 'Workspace',
    items: [
      ['Dashboard', 'dashboard'],
      ['Clients', 'users'],
      ['Services & Engagements', 'briefcase'],
      ['Work Assignments', 'clipboard'],
      ['My Tasks', 'check'],
    ],
  },
  {
    label: 'Practice',
    items: [
      ['Team & Departments', 'users'],
      ['Documents', 'files'],
      ['Communication', 'message'],
      ['Billing & Invoices', 'receipt'],
      ['Receipts & Collections', 'wallet'],
      ['Internal Audit', 'shield'],
      ['Reports', 'chart'],
    ],
  },
  {
    label: 'System',
    items: [['Settings', 'settings']],
  },
];

function sidebar() {
  const groups = navGroups
    .map(
      (group, groupIndex) => `
        <li class='nav-label'>${group.label}</li>
        ${group.items
          .map(
            ([label, iconName], index) => `
              <li>
                <button class='nav-item ${groupIndex === 0 && index === 0 ? 'is-active' : ''}' type='button' data-toast='${label} would open here'>
                  ${icon(iconName)}<span>${label}</span>
                </button>
              </li>`,
          )
          .join('')}`,
    )
    .join('');

  return `
    <aside id='sidebar' class='sidebar' aria-label='Primary navigation'>
      <a class='brand' href='#' aria-label='SN Practice CRM home'>
        <span class='brand-mark'>SN</span>
        <span class='brand-copy'><strong>SN Practice CRM</strong><small>SN &amp; Associates</small></span>
      </a>
      <div class='sidebar-divider'></div>
      <ul class='nav-list'>${groups}</ul>
      <div class='sidebar-footer'>
        <button class='profile-card' type='button' data-toast='Profile menu opened'>
          <span class='avatar'>SN</span>
          <span class='profile-copy'><strong>S. Narayanan</strong><small>Founder / Super Admin</small></span>
          ${icon('chevron')}
        </button>
      </div>
    </aside>`;
}

function topbar() {
  return `
    <div class='demo-banner'>
      <span><strong>Local demo:</strong> data stays in this browser and never reaches Lovable Cloud.</span>
      <button type='button' data-toast='Demo data would reset after confirmation'>Reset demo data</button>
    </div>
    <header class='topbar'>
      <button class='mobile-menu' type='button' aria-label='Open navigation'>${icon('menu')}</button>
      <div class='breadcrumb'><span>Pages / Dashboard</span><strong>Main dashboard</strong></div>
      <div class='topbar-actions'>
        <label class='search-control'>
          ${icon('search')}
          <span class='sr-only'>Search clients</span>
          <input type='search' placeholder='Search clients, PAN, GSTIN…' aria-label='Search clients' />
        </label>
        <button class='icon-button' type='button' aria-label='Notifications' data-toast='You have two items needing review'>${icon('bell')}</button>
        <button class='icon-button' type='button' aria-label='Open shortcuts' data-toast='Quick actions opened'>${icon('plus')}</button>
        <span class='user-avatar' aria-hidden='true'>SN</span>
      </div>
    </header>`;
}

function shell(content) {
  return `
    <div class='app-shell'>
      ${sidebar()}
      <div class='main-column'>
        ${topbar()}
        <main class='dashboard'>${content}</main>
      </div>
      <button class='mobile-backdrop' type='button' aria-label='Close navigation' hidden></button>
    </div>`;
}

function pageHeading(title, description, primaryLabel = 'New assignment') {
  return `
    <div class='page-heading'>
      <div>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <div class='heading-actions'>
        <button class='soft-button' type='button' data-toast='Date range changed'>${icon('calendar')} October 2026</button>
        <button class='primary-button' type='button' data-toast='Assignment composer opened'>${icon('plus')} ${primaryLabel}</button>
      </div>
    </div>`;
}

function metricCard({ label, value, note, iconName, tone = '', task = '' }) {
  return `
    <button class='metric-card' type='button' ${task ? `data-task='${task}'` : `data-toast='${label} details opened'`}>
      <span class='metric-icon ${tone ? `is-${tone}` : ''}'>${icon(iconName)}</span>
      <span class='metric-copy'>
        <span>${label}</span>
        <strong>${value}</strong>
        ${note ? `<small class='${tone === 'red' ? 'is-red' : ''}'>${note}</small>` : ''}
      </span>
    </button>`;
}

function metricsRow() {
  const metrics = [
    { label: 'Active clients', value: '2', note: 'Both in good standing', iconName: 'users' },
    { label: 'Open work', value: '2', note: '1 due this week', iconName: 'briefcase' },
    { label: 'Pending review', value: '1', note: 'Partner action needed', iconName: 'check', tone: 'gold', task: 'audit' },
    { label: 'Awaiting documents', value: '6', note: 'Across four clients', iconName: 'files', tone: 'gold', task: 'docs' },
    { label: 'Collected', value: '₹15,000', note: 'Recorded receipts', iconName: 'wallet', tone: 'green' },
    { label: 'Overdue fees', value: '₹14,500', note: 'Follow-up due today', iconName: 'warning', tone: 'red', task: 'collection' },
  ];
  return `<section class='kpi-grid' aria-label='Practice summary'>${metrics.map(metricCard).join('')}</section>`;
}

function collectionChart({ leadership = false } = {}) {
  return `
    <section class='card card-padding chart-card ${leadership ? 'finance-card' : ''}'>
      <div class='card-header'>
        <div>
          <h2>${leadership ? 'Billing and collections' : 'Collections movement'}</h2>
          <p>${leadership ? 'Billed, received, and outstanding fees' : 'Cumulative receipts against the October plan'}</p>
        </div>
        <div class='segmented' aria-label='Chart period'>
          <button type='button' data-period='week'>Week</button>
          <button class='is-active' type='button' data-period='month'>Month</button>
          <button type='button' data-period='quarter'>Quarter</button>
        </div>
      </div>
      ${
        leadership
          ? `<div class='finance-summary'>
              <div><span>Invoiced</span><strong>₹1,18,000</strong><small>2 invoices this month</small></div>
              <div><span>Collected</span><strong>₹15,000</strong><small>12.7% conversion</small></div>
              <div><span>Outstanding</span><strong>₹1,03,000</strong><small>₹14,500 overdue</small></div>
            </div>`
          : `<div class='chart-summary'><strong>₹15,000</strong><span>↑ ₹7,500 since last receipt</span></div>`
      }
      <div class='line-chart'>
        <svg viewBox='0 0 760 208' role='img' aria-label='Illustrative October collection trend'>
          <line class='chart-grid-line' x1='20' x2='744' y1='32' y2='32'/>
          <line class='chart-grid-line' x1='20' x2='744' y1='82' y2='82'/>
          <line class='chart-grid-line' x1='20' x2='744' y1='132' y2='132'/>
          <line class='chart-grid-line' x1='20' x2='744' y1='182' y2='182'/>
          <path class='chart-area' d='M20 173 C92 164 122 150 164 151 S258 133 310 136 S407 104 456 112 S551 79 600 86 S690 44 744 52 L744 182 L20 182 Z'/>
          <path class='chart-line-secondary' d='M20 164 C112 150 180 139 270 122 S450 93 540 68 S675 40 744 28'/>
          <path class='chart-line' d='M20 173 C92 164 122 150 164 151 S258 133 310 136 S407 104 456 112 S551 79 600 86 S690 44 744 52'/>
          <circle class='chart-point' cx='20' cy='173' r='4'/>
          <circle class='chart-point' cx='164' cy='151' r='4'/>
          <circle class='chart-point' cx='310' cy='136' r='4'/>
          <circle class='chart-point' cx='456' cy='112' r='4'/>
          <circle class='chart-point' cx='600' cy='86' r='4'/>
          <circle class='chart-point' cx='744' cy='52' r='4'/>
        </svg>
        <div class='chart-labels'><span>1 Oct</span><span>7 Oct</span><span>13 Oct</span><span>19 Oct</span><span>25 Oct</span><span>29 Oct</span></div>
      </div>
      <div class='chart-legend'><span class='legend-item'><i class='legend-dot'></i>Recorded receipts</span><span class='legend-item'><i class='legend-dot is-gold'></i>Illustrative monthly plan</span></div>
    </section>`;
}

function riskCard() {
  return `
    <section class='card card-padding risk-card'>
      <div class='card-header'>
        <div><h2>Statutory readiness</h2><p>Next seven calendar days</p></div>
        <button class='card-menu' type='button' aria-label='Open deadline report' data-toast='Deadline report opened'>${icon('chart')}</button>
      </div>
      <div class='risk-ring-wrap'>
        <div class='risk-ring'>
          <svg viewBox='0 0 120 120' aria-hidden='true'><circle class='ring-track' cx='60' cy='60' r='48'/><circle class='ring-value' cx='60' cy='60' r='48' pathLength='100'/></svg>
          <div class='ring-copy'><strong>78%</strong><span>ready</span></div>
        </div>
        <div class='risk-copy'><strong>One filing needs attention</strong><p>GST return review is due before 03/11. Supporting documents are complete.</p></div>
      </div>
      <div class='risk-list'>
        <div class='risk-row'><i></i><span>Ready to file</span><strong>3</strong></div>
        <div class='risk-row'><i class='is-amber'></i><span>Pending review</span><strong>1</strong></div>
        <div class='risk-row'><i class='is-red'></i><span>Blocked by client</span><strong>1</strong></div>
      </div>
    </section>`;
}

function attentionTable(title = 'Work needing attention') {
  const rows = [
    ['gst', 'ASN-0001', 'GST return — September', 'Aster Foods Private Limited', '03/11/2026', 'In Progress', '72'],
    ['audit', 'ASN-0002', 'Q2 internal audit', 'BluePeak Technologies LLP', '06/11/2026', 'Pending Review', '84'],
    ['docs', 'ASN-0003', 'Collect missing bank statements', 'Sharma Retail', '30/10/2026', 'Awaiting Documents', '45'],
    ['collection', 'INV-2048', 'Collections follow-up', 'BluePeak Technologies LLP', 'Today', 'Overdue', '30'],
  ];
  return `
    <section class='card table-card'>
      <div class='card-header'>
        <div><h2>${title}</h2><p>Sorted by deadline and financial consequence</p></div>
        <button class='soft-button' type='button' data-toast='All assignments opened'>View all ${icon('chevron')}</button>
      </div>
      <div class='table-wrap'>
        <table class='data-table'>
          <thead><tr><th>Work</th><th>Client</th><th>Due</th><th>Status</th><th>Progress</th><th>Owner</th></tr></thead>
          <tbody>
            ${rows
              .map(([id, code, work, client, due, statusText, progress]) => {
                const tone = statusText === 'Overdue' ? 'is-red' : statusText.includes('Pending') || statusText.includes('Awaiting') ? 'is-amber' : '';
                const owner = assignments[id].owner;
                return `<tr>
                  <td><button class='table-link' type='button' data-task='${id}'><span class='table-primary'>${work}</span><span class='table-secondary'>${code}</span></button></td>
                  <td><span class='table-primary'>${client}</span><span class='table-secondary'>Active client</span></td>
                  <td><span class='table-primary'>${due}</span><span class='table-secondary'>Asia/Kolkata</span></td>
                  <td><span class='status ${tone}'>${statusText}</span></td>
                  <td class='progress-cell'><div class='progress-track'><i style='width:${progress}%'></i></div><span>${progress}% complete</span></td>
                  <td><span class='table-primary'>${owner}</span></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function workloadCard() {
  const rows = [
    ['GST Return Filing', '1 open · 0 done', 32],
    ['Internal Audit', '1 open · 0 done', 18],
    ['Virtual CFO Advisory', '0 open · 1 done', 100],
    ['Tax Compliance', '0 open · 2 done', 100],
  ];
  return `
    <section class='card card-padding'>
      <div class='card-header'><div><h2>Service workload</h2><p>Open and completed assignments</p></div><button class='card-menu' type='button' data-toast='Workload report opened'>${icon('chart')}</button></div>
      <div class='workload-list'>${rows.map(([name, count, value]) => `<div class='workload-row'><span>${name}</span><strong>${count}</strong><div class='progress-track'><i style='width:${value}%'></i></div></div>`).join('')}</div>
    </section>`;
}

function receivablesCard() {
  return `
    <section class='card card-padding'>
      <div class='card-header'><div><h2>Top client outstanding</h2><p>Receivables requiring follow-up</p></div><button class='card-menu' type='button' data-toast='Receivables report opened'>${icon('receipt')}</button></div>
      <div class='receivable-list'>
        <div class='receivable-row'><span><strong>BluePeak Technologies LLP</strong><small>INV-2048 · 62 days overdue</small></span><strong>₹88,500</strong></div>
        <div class='receivable-row'><span><strong>Aster Foods Private Limited</strong><small>INV-2051 · due 03/11/2026</small></span><strong>₹14,500</strong></div>
        <div class='receivable-row'><span><strong>Other active clients</strong><small>No outstanding balance</small></span><strong style='color:var(--green)'>₹0</strong></div>
      </div>
    </section>`;
}

function renderClassic() {
  const content = `
    ${pageHeading('Good day, S. Narayanan', 'FY 2026–27 · Thursday, 29 October 2026 · Asia/Kolkata')}
    ${metricsRow()}
    <div class='overview-grid'>${collectionChart()}${riskCard()}</div>
    ${attentionTable()}
    <div class='lower-grid'>${workloadCard()}${receivablesCard()}</div>`;
  return shell(content);
}

function triageCard() {
  return `
    <section class='card card-padding triage-card'>
      <div class='card-header'><div><h2>Operational triage</h2><p>Risk, value, and dependencies across the practice</p></div><button class='card-menu' type='button' data-toast='Triage view expanded'>${icon('warning')}</button></div>
      <div class='triage-summary'><div><span>Risk concentration</span><h2>Two blockers can change this week’s outcome.</h2></div><strong>4<small>signals</small></strong></div>
      <div class='triage-list'>
        <button class='triage-row' type='button' data-task='gst'><span class='triage-icon is-red'>${icon('warning')}</span><span><strong>GST portal exceptions unresolved</strong><small>Aster Foods · statutory filing</small></span><span class='triage-impact is-red'>High risk</span></button>
        <button class='triage-row' type='button' data-task='docs'><span class='triage-icon is-amber'>${icon('files')}</span><span><strong>Evidence pack is incomplete</strong><small>Sharma Retail · client dependency</small></span><span class='triage-impact is-amber'>3 documents</span></button>
        <button class='triage-row' type='button' data-task='audit'><span class='triage-icon'>${icon('shield')}</span><span><strong>Audit response awaits partner review</strong><small>BluePeak · internal quality gate</small></span><span class='triage-impact'>Partner</span></button>
        <button class='triage-row' type='button' data-task='collection'><span class='triage-icon is-gold'>${icon('wallet')}</span><span><strong>Collection exposure is concentrated</strong><small>BluePeak · 62 days overdue</small></span><span class='triage-impact is-gold'>₹88,500</span></button>
      </div>
    </section>`;
}

function deadlinesCard() {
  return `
    <section class='card card-padding deadline-card'>
      <div class='card-header'><div><h2>Deadline radar</h2><p>Next five working days</p></div><button class='card-menu' type='button' data-toast='Calendar opened'>${icon('calendar')}</button></div>
      <div class='deadline-days'>
        <div class='deadline-day'><span class='deadline-date'>29<small>Thu</small></span><span><strong>Internal GST review</strong><span>Aster Foods</span></span><small>Today</small></div>
        <div class='deadline-day'><span class='deadline-date'>30<small>Fri</small></span><span><strong>Client documents</strong><span>Sharma Retail</span></span><small>Blocked</small></div>
        <div class='deadline-day'><span class='deadline-date'>03<small>Tue</small></span><span><strong>GSTR-1 filing</strong><span>Aster Foods</span></span><small>5 days</small></div>
        <div class='deadline-day'><span class='deadline-date'>06<small>Fri</small></span><span><strong>Internal audit close</strong><span>BluePeak Technologies</span></span><small>8 days</small></div>
      </div>
    </section>`;
}

function compactMetrics() {
  const items = [
    ['Due today', '1', 'GST internal review'],
    ['Open assignments', '2', 'Both assigned'],
    ['Pending review', '1', 'Partner action'],
    ['Outstanding fees', '₹1,03,000', '₹14,500 overdue'],
  ];
  return `<section class='compact-kpi-grid' aria-label='Operational summary'>${items.map(([label, value, note]) => `<div class='card compact-kpi'><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</section>`;
}

function teamCard() {
  return `
    <section class='card card-padding'>
      <div class='card-header'><div><h2>Team load</h2><p>Capacity for the next seven days</p></div><button class='card-menu' type='button' data-toast='Team view opened'>${icon('users')}</button></div>
      <div class='team-list'>
        <div class='team-row'><span><strong>Priya Desai</strong><small>GST &amp; compliance · 4 assignments</small></span><span class='status is-amber'>85% load</span></div>
        <div class='team-row'><span><strong>Rohan Mehta</strong><small>Audit · 3 assignments</small></span><span class='status'>67% load</span></div>
        <div class='team-row'><span><strong>Neha Kapoor</strong><small>Client documents · 5 follow-ups</small></span><span class='status is-green'>53% load</span></div>
      </div>
    </section>`;
}

function renderOperations() {
  const content = `
    ${pageHeading('Good day, S. Narayanan', 'Operational risk and delivery pressure for Thursday, 29 October 2026', 'Add work')}
    <div class='ops-layout'>${triageCard()}${deadlinesCard()}</div>
    ${compactMetrics()}
    ${attentionTable('All open assignments')}
    <div class='lower-grid'>${teamCard()}${receivablesCard()}</div>`;
  return shell(content);
}

function healthCard() {
  return `
    <section class='card card-padding health-card'>
      <div class='card-header'><div><h2>Practice health</h2><p>Delivery and cash discipline</p></div><button class='card-menu' type='button' data-toast='Practice score methodology opened'>${icon('shield')}</button></div>
      <div class='health-score'>
        <div class='health-number'>82<small>of 100</small></div>
        <div class='health-copy'><strong>Healthy, with two exceptions</strong><span>Delivery is on track. Collections and one client-document dependency require attention.</span></div>
      </div>
      <div class='health-list'>
        <div class='health-row'><span>Delivery readiness</span><strong>92%</strong><div class='progress-track'><i style='width:92%'></i></div></div>
        <div class='health-row'><span>Review velocity</span><strong>78%</strong><div class='progress-track'><i style='width:78%'></i></div></div>
        <div class='health-row'><span>Collections discipline</span><strong>61%</strong><div class='progress-track'><i style='width:61%;background:var(--gold)'></i></div></div>
      </div>
    </section>`;
}

function clientPortfolio() {
  return `
    <section class='card card-padding'>
      <div class='card-header'><div><h2>Client portfolio</h2><p>Fees, work state, and collection exposure</p></div><button class='soft-button' type='button' data-toast='Client portfolio opened'>View clients ${icon('chevron')}</button></div>
      <div>
        <div class='client-row'><div><strong>BluePeak Technologies LLP</strong><small>CL-0002 · Technology</small></div><div><span>3 active</span><small>assignments</small></div><div><span>₹88,500</span><small>outstanding</small></div><span class='status is-red'>Action</span></div>
        <div class='client-row'><div><strong>Aster Foods Private Limited</strong><small>CL-0001 · Manufacturing</small></div><div><span>2 active</span><small>assignments</small></div><div><span>₹14,500</span><small>outstanding</small></div><span class='status is-amber'>Review</span></div>
        <div class='client-row'><div><strong>Sharma Retail</strong><small>CL-0006 · Retail</small></div><div><span>1 active</span><small>assignment</small></div><div><span>₹0</span><small>outstanding</small></div><span class='status'>Documents</span></div>
        <div class='client-row'><div><strong>Kedia Holdings</strong><small>CL-0004 · Investment</small></div><div><span>1 active</span><small>assignment</small></div><div><span>₹0</span><small>outstanding</small></div><span class='status is-green'>On track</span></div>
      </div>
    </section>`;
}

function collectionsSnapshot() {
  return `
    <section class='card card-padding'>
      <div class='card-header'><div><h2>Collections snapshot</h2><p>Current fee position</p></div><button class='card-menu' type='button' data-toast='Collections opened'>${icon('wallet')}</button></div>
      <div class='collection-stack'>
        <div class='collection-stat'><span>Invoiced this month</span><strong>₹1,18,000</strong><small>2 issued invoices</small></div>
        <div class='collection-stat'><span>Receipts recorded</span><strong>₹15,000</strong><small>12.7% collected</small></div>
        <div class='collection-stat'><span>Outstanding</span><strong>₹1,03,000</strong><small>Across two clients</small></div>
        <div class='collection-stat is-danger'><span>Overdue</span><strong>₹14,500</strong><small>Follow-up due today</small></div>
      </div>
    </section>`;
}

function renderLeadership() {
  const content = `
    ${pageHeading('Practice overview', 'Delivery, client exposure, and cash position for FY 2026–27', 'Create report')}
    <div class='leadership-grid'>${collectionChart({ leadership: true })}${healthCard()}</div>
    <div class='portfolio-grid'>${clientPortfolio()}${collectionsSnapshot()}</div>
    <div style='margin-top:18px'>${attentionTable('Exceptions requiring management attention')}</div>`;
  return shell(content);
}

const app = document.querySelector('#app');
const variantLabel = document.querySelector('#variant-label');
const drawer = document.querySelector('#assignment-drawer');
const drawerBackdrop = document.querySelector('#drawer-backdrop');
const toastRegion = document.querySelector('#toast-region');
const prototypeToolbar = document.querySelector('#prototype-toolbar');
const variantSwitcher = document.querySelector('#variant-switcher');
let drawerOpener = null;
let drawerCloseTimer = null;

function currentVariant() {
  const key = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return variants[key] ? key : 'A';
}

function render() {
  const key = currentVariant();
  app.innerHTML = variants[key].render();
  variantLabel.textContent = variants[key].label;
  document.title = `SN Practice CRM — ${variants[key].label.replace('·', '—')}`;
  closeDrawer(true);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function switchVariant(direction) {
  const keys = Object.keys(variants);
  const activeIndex = keys.indexOf(currentVariant());
  const next = keys[(activeIndex + direction + keys.length) % keys.length];
  const url = new URL(window.location.href);
  url.searchParams.set('variant', next);
  window.history.pushState({}, '', url);
  render();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function isolateBackground(isolated) {
  [app, prototypeToolbar].forEach((element) => {
    element.inert = isolated;
    if (isolated) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
  });
  document.body.classList.toggle('drawer-open', isolated);
}

function drawerFocusableElements() {
  const candidates = drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]');
  return [...candidates].filter((element) => element.tabIndex >= 0);
}

function openDrawer(taskId, opener) {
  const task = assignments[taskId];
  if (!task) return;
  window.clearTimeout(drawerCloseTimer);
  drawerOpener = opener instanceof HTMLElement ? opener : document.activeElement;
  drawer.innerHTML = `
    <div class='drawer-head'>
      <div><h2 id='drawer-title'>${task.title}</h2><p>${task.code} · ${task.client}</p></div>
      <button class='icon-button' type='button' aria-label='Close assignment details' data-close-drawer>${icon('close')}</button>
    </div>
    <div class='drawer-section'><span class='status ${task.status === 'Overdue' ? 'is-red' : task.status.includes('Pending') || task.status.includes('Awaiting') ? 'is-amber' : ''}'>${task.status}</span></div>
    <section class='drawer-section'><h3>Assignment details</h3><div class='drawer-kv'><span>Due date</span><strong>${task.due}</strong><span>Owner</span><strong>${task.owner}</strong><span>Progress</span><strong>${task.progress}%</strong><span>Work period</span><strong>October 2026</strong></div></section>
    <section class='drawer-section'><h3>Progress</h3><div class='progress-track'><i style='width:${task.progress}%'></i></div></section>
    <section class='drawer-section'><h3>Current context</h3><div class='drawer-note'>${task.blocker}</div></section>
    <div class='drawer-actions'><button class='primary-button' type='button' data-toast='Assignment workspace opened'>Open assignment</button><button class='soft-button' type='button' data-toast='Follow-up added'>Add follow-up</button></div>`;
  drawer.hidden = false;
  drawerBackdrop.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  isolateBackground(true);
  requestAnimationFrame(() => {
    drawer.classList.add('is-open');
    drawerBackdrop.classList.add('is-visible');
  });
  window.setTimeout(() => drawer.querySelector('[data-close-drawer]')?.focus(), 80);
}

function closeDrawer(immediate = false) {
  if (drawer.hidden) return;
  window.clearTimeout(drawerCloseTimer);
  const restoreTarget = drawerOpener;
  drawerOpener = null;
  drawer.classList.remove('is-open');
  drawerBackdrop.classList.remove('is-visible');
  drawer.setAttribute('aria-hidden', 'true');
  isolateBackground(false);
  const finishClose = () => {
    drawerBackdrop.hidden = true;
    drawer.hidden = true;
    drawer.innerHTML = '';
    if (!immediate && restoreTarget?.isConnected) restoreTarget.focus();
  };
  if (immediate) {
    finishClose();
  } else {
    drawerCloseTimer = window.setTimeout(finishClose, 240);
  }
}

function toggleMobileNav(open) {
  const sidebarElement = document.querySelector('#sidebar');
  const backdrop = document.querySelector('.mobile-backdrop');
  if (!sidebarElement || !backdrop) return;
  sidebarElement.classList.toggle('is-open', open);
  backdrop.hidden = !open;
}

document.querySelector('#previous-variant').addEventListener('click', () => switchVariant(-1));
document.querySelector('#next-variant').addEventListener('click', () => switchVariant(1));
variantSwitcher.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  switchVariant(event.key === 'ArrowLeft' ? -1 : 1);
});
drawerBackdrop.addEventListener('click', () => closeDrawer());

document.addEventListener('click', (event) => {
  const taskButton = event.target.closest('[data-task]');
  if (taskButton) {
    openDrawer(taskButton.dataset.task, taskButton);
    return;
  }

  const toastButton = event.target.closest('[data-toast]');
  if (toastButton) {
    showToast(toastButton.dataset.toast);
  }

  if (event.target.closest('[data-close-drawer]')) closeDrawer();
  if (event.target.closest('.mobile-menu')) toggleMobileNav(true);
  if (event.target.closest('.mobile-backdrop')) toggleMobileNav(false);

  const periodButton = event.target.closest('[data-period]');
  if (periodButton) {
    periodButton.parentElement.querySelectorAll('button').forEach((button) => button.classList.toggle('is-active', button === periodButton));
    showToast(`${periodButton.textContent.trim()} view selected`);
  }
});

document.addEventListener('keydown', (event) => {
  if (!drawer.hidden && event.key === 'Tab') {
    const focusable = drawerFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      drawer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  if (event.key === 'Escape') {
    closeDrawer();
    toggleMobileNav(false);
    return;
  }

});

document.addEventListener('submit', (event) => event.preventDefault());
window.addEventListener('popstate', render);

render();
