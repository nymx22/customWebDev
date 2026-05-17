/**
 * Tab-separated text → `<table class="site-frame__text-table">`.
 * Shared by `site-frame.js` (live mount) and `staging-gui-settings.js` (preview).
 *
 * First line = header cells (tab-separated); following lines = body rows.
 * Single line = one body row (all `<td>`).
 *
 * @param {string} raw
 * @returns {HTMLTableElement | null}
 */
export function buildTabTextTable(raw) {
  const lines = String(raw || "")
    .split(/\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");
  if (!lines.length) {
    return null;
  }
  const table = document.createElement("table");
  table.className = "site-frame__text-table";
  if (lines.length === 1) {
    const tbody = document.createElement("tbody");
    const tr = document.createElement("tr");
    lines[0].split("\t").forEach((c) => {
      const td = document.createElement("td");
      td.textContent = c.trim();
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    table.appendChild(tbody);
    return table;
  }
  const headerParts = lines[0].split("\t");
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  headerParts.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c.trim();
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  const colCount = headerParts.length;
  for (let i = 1; i < lines.length; i++) {
    const tr = document.createElement("tr");
    const parts = lines[i].split("\t");
    for (let j = 0; j < colCount; j++) {
      const td = document.createElement("td");
      td.textContent = (parts[j] != null ? String(parts[j]) : "").trim();
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}
