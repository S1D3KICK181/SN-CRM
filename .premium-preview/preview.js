const body = document.body;
const menuButton = document.querySelector(".mobile-menu");
const navItems = document.querySelectorAll(".nav-item");
const periodButtons = document.querySelectorAll("[data-period]");
const receivedValue = document.querySelector("#received-value");
const outstandingValue = document.querySelector("#outstanding-value");

menuButton?.addEventListener("click", () => {
  const next = !body.classList.contains("menu-open");
  body.classList.toggle("menu-open", next);
  menuButton.setAttribute("aria-expanded", String(next));
});

document.addEventListener("click", (event) => {
  if (!body.classList.contains("menu-open")) return;
  if (event.target.closest(".sidebar") || event.target.closest(".mobile-menu")) return;
  body.classList.remove("menu-open");
  menuButton?.setAttribute("aria-expanded", "false");
});

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    navItems.forEach((candidate) => candidate.classList.remove("active"));
    item.classList.add("active");
    if (window.innerWidth <= 760) {
      body.classList.remove("menu-open");
      menuButton?.setAttribute("aria-expanded", "false");
    }
  });
});

const periodData = {
  month: { received: "₹12,80,000", outstanding: "₹28,40,000" },
  quarter: { received: "₹34,65,000", outstanding: "₹28,40,000" },
};

periodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    periodButtons.forEach((candidate) => candidate.classList.remove("active"));
    button.classList.add("active");
    const data = periodData[button.dataset.period];
    if (data) {
      receivedValue.textContent = data.received;
      outstandingValue.textContent = data.outstanding;
    }
  });
});
