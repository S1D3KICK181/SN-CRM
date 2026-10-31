const variants = [
  { key: "A", name: "Split day" },
  { key: "B", name: "Focus page" },
  { key: "C", name: "Week folio" },
];

const taskData = {
  gst: {
    title: "GSTR-1 filing",
    client: "Verma Hospitals",
    due: "Tomorrow · 30/10/2026",
    owner: "Priya Desai",
    status: "In progress · 72%",
    note: "Sales register is reconciled. Complete the final exception check, then file and send the acknowledgement to the client.",
  },
  documents: {
    title: "Six client documents pending",
    client: "Across four clients",
    due: "This week",
    owner: "Rohan Mehta",
    status: "Waiting on client",
    note: "The oldest request is the bank statement from Sharma Retail. Two reminders have already been sent.",
  },
  invoice: {
    title: "Invoice INV-2048",
    client: "Mehta Infra Projects",
    due: "62 days overdue",
    owner: "Aarav Shah",
    status: "₹2,40,000 outstanding",
    note: "The client promised payment last Friday. Schedule a partner follow-up before sending another automated reminder.",
  },
  review: {
    title: "Draft financial statements",
    client: "Kedia Holdings",
    due: "03/11/2026",
    owner: "Neha Kapoor",
    status: "Partner review",
    note: "Two review points remain open: depreciation policy and related-party disclosure.",
  },
};

const prototype = document.querySelector("#prototype");
const variantLabel = document.querySelector("#variant-label");
const drawer = document.querySelector("#task-drawer");
const backdrop = document.querySelector("#drawer-backdrop");
const toastRegion = document.querySelector("#toast-region");

function currentVariant() {
  const requested = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return variants.find((variant) => variant.key === requested) ?? variants[0];
}

function pageHeader(title, accent, subtitle, action = "Add to day") {
  return `
    <header class="page-header">
      <div>
        <h1 class="greeting">${title} <em>${accent}</em></h1>
        <p class="page-subtitle">${subtitle}</p>
      </div>
      <div class="header-actions">
        <button class="icon-button pressable" type="button" data-toast="Search opened" aria-label="Search">⌕</button>
        <button class="icon-button pressable" type="button" data-toast="No new notifications" aria-label="Notifications">•</button>
        <button class="primary-action pressable" type="button" data-toast="Composer opened">${action}</button>
      </div>
    </header>`;
}

function findingStrip() {
  return `
    <section class="finding-strip" aria-label="Practice summary">
      <div class="finding"><span>Deadlines in the next seven days</span><strong>3</strong></div>
      <div class="finding"><span>Documents waiting on clients</span><strong>6</strong></div>
      <div class="finding is-danger"><span>Overdue receivables</span><strong>₹8.4L</strong></div>
    </section>`;
}

function renderSplitDay() {
  return `
    <div class="page variant-a">
      ${pageHeader("Good morning,", "Aarav.", "Thursday, 29 October · FY 2026–27 · Mumbai", "Add to day")}
      ${findingStrip()}
      <div class="split-layout">
        <section class="panel day-sheet" aria-labelledby="day-title">
          <div class="day-sheet-head">
            <h2 id="day-title">Your Thursday</h2>
            <div class="range-tabs" role="tablist" aria-label="Calendar range">
              <button class="range-tab is-active" type="button" role="tab">Today</button>
              <button class="range-tab" type="button" role="tab">Week</button>
              <button class="range-tab" type="button" role="tab">Month</button>
            </div>
          </div>
          <div class="timeline">
            <div class="time-labels" aria-hidden="true">
              <span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span><span>16:00</span><span>17:00</span>
            </div>
            <div class="timeline-track">
              <button class="timeline-block" data-task="gst" style="top: 2px; height: 108px" type="button">
                <span><strong>GSTR-1 filing</strong><small>Verma Hospitals · review exceptions, then file</small></span><time>09:00–10:45</time>
              </button>
              <button class="timeline-block is-blue" data-task="documents" style="top: 124px; height: 76px" type="button">
                <span><strong>Client document review</strong><small>Six items across four clients</small></span><time>11:10–12:15</time>
              </button>
              <button class="timeline-block is-warning" data-task="review" style="top: 236px; height: 92px" type="button">
                <span><strong>Partner review</strong><small>Kedia Holdings · draft financial statements</small></span><time>13:00–14:30</time>
              </button>
              <button class="timeline-block is-danger" data-task="invoice" style="top: 366px; height: 72px" type="button">
                <span><strong>Collections follow-up</strong><small>Invoice INV-2048 · 62 days overdue</small></span><time>15:15–15:45</time>
              </button>
            </div>
          </div>
        </section>

        <div class="pulse-column">
          <section class="panel panel-tint">
            <div class="panel-heading"><div><h2>Practice pulse</h2><p>Next seven days</p></div><button class="text-link" type="button" data-toast="Calendar opened">View calendar</button></div>
            <div class="week-strip">
              ${[["Thu","29"],["Fri","30"],["Sat","31"],["Sun","1"],["Mon","2"],["Tue","3"],["Wed","4"]].map(([day,date], index) => `<button class="day-cell ${index === 0 ? "is-current" : ""}" type="button"><span>${day}</span><strong>${date}</strong><small>•</small></button>`).join("")}
            </div>
          </section>

          <section class="panel panel-warm">
            <div class="panel-heading"><div><h2>Needs a decision</h2><p>Ordered by consequence, not age</p></div></div>
            <div class="priority-list">
              <button class="priority-row" data-task="invoice" type="button"><span><strong>Call before another reminder</strong><small>Mehta Infra · INV-2048</small></span><span class="row-meta is-danger">₹2.4L</span></button>
              <button class="priority-row" data-task="gst" type="button"><span><strong>Approve final filing</strong><small>Verma Hospitals · GSTR-1</small></span><span class="row-meta">Tomorrow</span></button>
              <button class="priority-row" data-task="documents" type="button"><span><strong>Escalate missing bank statement</strong><small>Sharma Retail · requested 24/10</small></span><span class="row-meta">5 days</span></button>
            </div>
          </section>

          <section class="panel panel-blue">
            <div class="panel-heading"><div><h2>Collections</h2><p>Recorded receipts and fees due</p></div></div>
            <div class="money-line"><div><strong>₹12.8L</strong><span>Collected</span></div><div><strong>₹26.4L</strong><span>Outstanding</span></div><div><strong class="danger">₹8.4L</strong><span>Overdue</span></div></div>
          </section>
        </div>
      </div>
    </div>`;
}

function renderFocusPage() {
  return `
    <div class="page variant-b">
      ${pageHeader("One thing", "at a time.", "Your queue is ordered by statutory risk and financial consequence.", "Create assignment")}
      ${findingStrip()}
      <div class="focus-layout">
        <section class="panel focus-queue">
          <div class="panel-heading"><div><h2>Today’s queue</h2><p>Four consequential actions</p></div></div>
          <button class="queue-row is-selected" data-task="gst" type="button"><span><strong>GSTR-1 filing</strong><small>Verma Hospitals</small></span><span class="row-meta">Now</span></button>
          <button class="queue-row" data-task="documents" type="button"><span><strong>Missing documents</strong><small>Four clients</small></span><span class="row-meta">11:10</span></button>
          <button class="queue-row" data-task="review" type="button"><span><strong>Partner review</strong><small>Kedia Holdings</small></span><span class="row-meta">13:00</span></button>
          <button class="queue-row" data-task="invoice" type="button"><span><strong>Collections call</strong><small>Mehta Infra</small></span><span class="row-meta is-danger">62d</span></button>
          <div class="queue-later"><p>Protected time</p><div><time>15:50</time><span>Review client callback notes</span></div><div><time>16:30</time><span>Team review · 20 minutes</span></div><div><time>17:00</time><span>Prepare tomorrow’s filing list</span></div><div><time>17:30</time><span>Close the day and hand off blockers</span></div></div>
          <div class="queue-summary"><strong>4h 35m</strong>planned · 1h 20m still open</div>
        </section>

        <section class="panel focus-stage" aria-labelledby="focus-title">
          <div class="panel-heading"><div><h2>Current focus</h2><p>09:00–10:45 · 46 minutes reserved</p></div><button class="text-link" data-task="gst" type="button">Open assignment</button></div>
          <span class="focus-index">Current</span>
          <h2 id="focus-title" class="focus-title">File GSTR-1 today.</h2>
          <p class="focus-client">Verma Hospitals · October 2026 · Priya Desai</p>
          <ul class="focus-checklist"><li><i></i><span>Sales register reconciled</span><strong>Done</strong></li><li><i></i><span>Resolve two portal exceptions</span><strong>Now</strong></li><li><i></i><span>File and send acknowledgement</span><strong>Next</strong></li><li><i></i><span>Archive acknowledgement</span><strong>After</strong></li><li><i></i><span>Send completion note to client</span><strong>After</strong></li></ul>
          <div class="focus-progress"><div><div class="progress-track"><div class="progress-fill"></div></div><p>Sales register and portal data reconciled</p></div><strong>72%</strong></div>
          <div class="focus-actions"><button class="complete pressable" type="button" data-complete="gst">Mark filed</button><button class="secondary pressable" type="button" data-toast="Note composer opened">Add note</button></div>
        </section>

        <aside class="panel context-panel">
          <div class="panel-heading"><div><h2>Context</h2><p>Everything needed to decide</p></div></div>
          <section class="context-section"><h3>Deadline</h3><div class="context-kv"><span>Statutory due</span><strong>30/10/2026</strong><span>Internal due</span><strong>Today</strong></div></section>
          <section class="context-section"><h3>Client</h3><div class="context-kv"><span>Contact</span><strong>Rajiv Verma</strong><span>Documents</span><strong>Complete</strong></div></section>
          <section class="context-section"><h3>Money</h3><div class="context-kv"><span>Annual fees</span><strong>₹4.8L</strong><span>Outstanding</span><strong>₹0</strong></div></section>
          <section class="context-section"><h3>Last activity</h3><p>Priya reconciled the sales register at 08:42 and left two exceptions for review.</p></section>
        </aside>

        <section class="deadline-ruler" aria-label="Seven day deadline ruler">
          ${[["Thu 29","Today","1 decision"],["Fri 30","Tomorrow","GSTR-1"],["Sat 31","Saturday","TDS return"],["Sun 1","Sunday","No filings"],["Mon 2","Monday","ROC annual"],["Tue 3","Tuesday","2 reviews"],["Wed 4","Wednesday","GST payment"]].map(([day,date,item]) => `<div><span>${day}</span><strong>${date}</strong><small>${item}</small></div>`).join("")}
        </section>
      </div>
    </div>`;
}

function lane(owner, role, tasks) {
  const cells = tasks.map((task) => task ? `<div class="lane-cell"><button class="lane-task ${task.tone ?? ""}" type="button" data-task="${task.id}"><strong>${task.title}</strong><small>${task.client}</small><small>${task.time}</small></button></div>` : `<div class="lane-cell"></div>`).join("");
  return `<div class="lane"><div class="lane-owner"><strong>${owner}</strong><small>${role}</small></div>${cells}</div>`;
}

function renderWeekFolio() {
  return `
    <div class="page variant-c">
      ${pageHeader("The week", "has shape.", "See capacity, deadlines and client dependencies on one working surface.", "Plan work")}
      <div class="week-layout">
        <section class="panel week-board" aria-label="Team week folio">
          <div class="week-board-head"><div><span>Team folio</span><strong>29 Oct–4 Nov</strong></div><div class="is-current"><span>Thursday</span><strong>29</strong></div><div><span>Friday</span><strong>30</strong></div><div><span>Monday</span><strong>2</strong></div><div><span>Tuesday</span><strong>3</strong></div><div><span>Wednesday</span><strong>4</strong></div></div>
          ${lane("Priya Desai", "Senior manager · 85%", [
            {id:"gst", title:"GSTR-1 exceptions", client:"Verma Hospitals", time:"09:00–10:45"},
            {id:"gst", title:"File GSTR-1", client:"Verma Hospitals", time:"Due 13:00", tone:"is-warm"}, null,
            {id:"review", title:"Partner review", client:"Kedia Holdings", time:"11:30"}, null,
          ])}
          ${lane("Rohan Mehta", "Manager · 67%", [
            {id:"documents", title:"Document chase", client:"Sharma Retail", time:"11:10", tone:"is-blue"}, null,
            {id:"documents", title:"Client follow-up", client:"Four clients", time:"10:00"}, null,
            {id:"review", title:"GST payment", client:"Three clients", time:"15:00", tone:"is-warm"},
          ])}
          ${lane("Neha Kapoor", "Associate · 53%", [
            {id:"review", title:"Draft statements", client:"Kedia Holdings", time:"13:00", tone:"is-warm"}, null, null,
            {id:"review", title:"Close review points", client:"Kedia Holdings", time:"14:30"},
            {id:"documents", title:"Document index", client:"Mehta Infra", time:"16:00", tone:"is-blue"},
          ])}
          ${lane("Aarav Shah", "Partner · 41%", [
            {id:"invoice", title:"Collections call", client:"Mehta Infra", time:"15:15", tone:"is-danger"}, null,
            {id:"review", title:"Advisory meeting", client:"Rao Consumer", time:"12:00"}, null,
            {id:"review", title:"Board pack", client:"Verma Hospitals", time:"17:00"},
          ])}
        </section>

        <aside class="attention-rail">
          <section class="panel panel-warm"><div class="panel-heading"><div><h2>Practice finding</h2><p>What the week is telling you</p></div></div><p class="attention-statement"><strong>Three deadlines</strong> and ₹8.4L overdue need intervention before Friday.</p></section>
          <section class="panel panel-tint"><div class="panel-heading"><div><h2>Capacity</h2><p>68% allocated</p></div></div><div class="capacity-list">${[["Priya Desai",85],["Rohan Mehta",67],["Neha Kapoor",53],["Aarav Shah",41]].map(([name,value]) => `<div class="capacity-row"><span>${name}</span><strong>${value}%</strong><div class="capacity-bar"><i style="width:${value}%"></i></div></div>`).join("")}</div></section>
          <section class="panel panel-blue"><div class="panel-heading"><div><h2>Collections</h2><p>Fees and recorded receipts</p></div></div><div class="money-line"><div><strong>₹12.8L</strong><span>In</span></div><div><strong>₹26.4L</strong><span>Due</span></div><div><strong class="danger">₹8.4L</strong><span>Late</span></div></div></section>
        </aside>
      </div>
    </div>`;
}

function render() {
  const variant = currentVariant();
  variantLabel.textContent = `${variant.key} · ${variant.name}`;
  prototype.innerHTML = variant.key === "B" ? renderFocusPage() : variant.key === "C" ? renderWeekFolio() : renderSplitDay();
  prototype.dataset.variant = variant.key;
  bindInteractions();
  prototype.focus({ preventScroll: true });
}

function setVariant(key, source = "pointer") {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", key);
  window.history.replaceState({}, "", url);
  if (source === "keyboard") prototype.style.transition = "none";
  render();
  requestAnimationFrame(() => { prototype.style.transition = ""; });
}

function cycleVariant(direction, source) {
  const active = currentVariant();
  const index = variants.findIndex((variant) => variant.key === active.key);
  const next = variants[(index + direction + variants.length) % variants.length];
  setVariant(next.key, source);
}

function openDrawer(taskId) {
  const task = taskData[taskId] ?? taskData.gst;
  drawer.innerHTML = `
    <div class="drawer-head"><strong>Assignment detail</strong><button id="close-drawer" type="button" aria-label="Close details">×</button></div>
    <h2 class="drawer-title">${task.title}</h2>
    <p class="drawer-client">${task.client}</p>
    <p class="drawer-status">${task.status}</p>
    <div class="drawer-grid"><div><span>Due</span><strong>${task.due}</strong></div><div><span>Owner</span><strong>${task.owner}</strong></div><div><span>Status</span><strong>${task.status}</strong></div><div><span>Workspace</span><strong>SN Practice</strong></div></div>
    <p class="drawer-note">${task.note}</p>
    <div class="drawer-actions"><button class="primary-action" type="button" data-toast="Full assignment would open here">Open assignment</button><button class="quiet-action" id="drawer-done" type="button">Done</button></div>`;
  backdrop.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  document.querySelector("#close-drawer").focus();
  document.querySelector("#close-drawer").addEventListener("click", closeDrawer);
  document.querySelector("#drawer-done").addEventListener("click", closeDrawer);
  drawer.querySelectorAll("[data-toast]").forEach((element) => element.addEventListener("click", () => showToast(element.dataset.toast)));
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  window.setTimeout(() => { backdrop.hidden = true; }, 180);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.classList.add("is-leaving"), 1900);
  window.setTimeout(() => toast.remove(), 2160);
}

function bindInteractions() {
  prototype.querySelectorAll("[data-task]").forEach((element) => element.addEventListener("click", () => openDrawer(element.dataset.task)));
  prototype.querySelectorAll("[data-toast]").forEach((element) => element.addEventListener("click", () => showToast(element.dataset.toast)));
  prototype.querySelectorAll("[data-complete]").forEach((element) => element.addEventListener("click", () => {
    element.textContent = "Filed";
    element.disabled = true;
    showToast("GSTR-1 marked as filed in this prototype");
  }));
  prototype.querySelectorAll(".range-tab").forEach((tab) => tab.addEventListener("click", () => {
    prototype.querySelectorAll(".range-tab").forEach((item) => item.classList.remove("is-active"));
    tab.classList.add("is-active");
    showToast(`${tab.textContent} view selected`);
  }));
}

document.querySelector("#previous-variant").addEventListener("click", () => cycleVariant(-1, "pointer"));
document.querySelector("#next-variant").addEventListener("click", () => cycleVariant(1, "pointer"));
backdrop.addEventListener("click", closeDrawer);
window.addEventListener("popstate", render);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer();
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, [contenteditable='true']")) return;
  event.preventDefault();
  cycleVariant(event.key === "ArrowRight" ? 1 : -1, "keyboard");
});

render();
