const canvas = document.getElementById("graphCanvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const stats = document.getElementById("graphStats");
const amountFilters = document.getElementById("amountFilters");
const clearFilters = document.getElementById("clearFilters");
const startupMode = document.getElementById("startupMode");
const domainMode = document.getElementById("domainMode");

const raw = window.HRTECH_GRAPH_DATA;
const categories = raw.categories;
const categoryNames = Object.keys(categories);
const amountBuckets = raw.amountBuckets;
const quarterSlots = buildQuarterSlots(raw.startups);

const state = {
  width: 0,
  height: 0,
  mode: "startups",
  hovered: null,
  selected: null,
  dragging: null,
  animating: false,
  frame: 0,
  closedTooltipId: null,
  activeAmounts: new Set(amountBuckets),
  renderNodes: [],
  amountBounds: null,
};

const startupNodes = raw.startups.map((item, index) => ({
  ...item,
  kind: "startup",
  label: item.name,
  index,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  visible: true,
  radius: 8,
  baseRadius: 8.5,
}));

const nodeById = new Map(startupNodes.map((node) => [node.id, node]));
const links = raw.relations
  .map((link) => ({
    ...link,
    a: nodeById.get(link.source),
    b: nodeById.get(link.target),
  }))
  .filter((link) => link.a && link.b);

function radiusForStartup(item, maxAmount) {
  const amount = Number(item.amountM) || 0;
  if (!amount) return 7.5;
  return 7.5 + Math.sqrt(amount / Math.max(1, maxAmount)) * 42;
}

function colorFor(node) {
  return categories[node.category]?.color || node.color || "#9CA3AF";
}

function hashNumber(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  state.width = Math.max(320, rect.width);
  state.height = Math.max(520, rect.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(state.width * dpr);
  canvas.height = Math.floor(state.height * dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rebuildRenderNodes(true);
}

function passesFilters(item) {
  return state.activeAmounts.has(item.amountBucket);
}

function startupVisibleNodes() {
  for (const node of startupNodes) node.visible = passesFilters(node);
  const visible = startupNodes.filter((node) => node.visible);
  for (const node of visible) {
    node.baseRadius = 8.5;
    node.radius = node.baseRadius;
  }
  return visible;
}

function plotArea() {
  return {
    left: state.width < 720 ? 54 : 92,
    right: state.width - (state.width < 720 ? 28 : 54),
    top: state.width < 720 ? 112 : 122,
    bottom: state.height - (state.width < 720 ? 168 : 126),
  };
}

function metricScale(value, max) {
  return Math.log1p(Math.max(0, value)) / Math.log1p(Math.max(1, max));
}

function quarterNumber(value) {
  const match = String(value || "").match(/([1-4])/);
  return match ? Number(match[1]) : 1;
}

function quarterKey(item) {
  return `${item.year}:Q${quarterNumber(item.quarter)}`;
}

function quarterLabel(slot) {
  return `${String(slot.year).slice(-2)} Q${slot.quarter}`;
}

function buildQuarterSlots(items) {
  const observed = items
    .filter((item) => item.year && item.quarter)
    .map((item) => ({ year: Number(item.year), quarter: quarterNumber(item.quarter) }))
    .sort((a, b) => a.year - b.year || a.quarter - b.quarter);
  if (!observed.length) return [];
  const first = observed[0];
  const last = observed[observed.length - 1];
  const slots = [];
  for (let year = first.year; year <= last.year; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      if (year === first.year && quarter < first.quarter) continue;
      if (year === last.year && quarter > last.quarter) continue;
      slots.push({ year, quarter, key: `${year}:Q${quarter}` });
    }
  }
  return slots;
}

function quarterX(node) {
  const area = plotArea();
  const index = Math.max(0, quarterSlots.findIndex((slot) => slot.key === quarterKey(node)));
  if (quarterSlots.length <= 1) return (area.left + area.right) / 2;
  return area.left + (area.right - area.left) * (index / (quarterSlots.length - 1));
}

function amountY(amountM) {
  const area = plotArea();
  const maxAmount = state.amountBounds?.maxAmount || 1;
  return area.bottom - (area.bottom - area.top) * metricScale(amountM, maxAmount);
}

function buildAmountBounds() {
  const visibleStartups = raw.startups.filter(passesFilters);
  const startupAmounts = visibleStartups.map((item) => Number(item.amountM) || 0);
  return { maxAmount: Math.max(1, ...startupAmounts) };
}

function categoryAnchor(category) {
  const area = plotArea();
  const anchor = categories[category]?.anchor || { x: 0.5, y: 0.5 };
  return {
    x: area.left + (area.right - area.left) * anchor.x,
    y: area.top + (area.bottom - area.top) * anchor.y,
  };
}

function nodeDomains(node) {
  const weights = Array.isArray(node.categoryWeights) && node.categoryWeights.length
    ? node.categoryWeights
    : [{ category: node.category, weight: 1 }];
  return weights.filter((item) => categories[item.category]);
}

function startupTarget(node) {
  const h = hashNumber(node.id);
  const jitter = ((h % 100) / 100 - 0.5) * 28;
  const amount = Number(node.amountM) || 0;
  return { x: quarterX(node) + jitter, y: amountY(amount) };
}

function buildDomainNodes() {
  const categoryStats = new Map(categoryNames.map((name) => [
    name,
    {
      kind: "domain",
      id: `domain:${name}`,
      label: name,
      category: name,
      group: categories[name]?.group || "Other",
      description: categories[name]?.description || "",
      count: 0,
      exposureCount: 0,
      weightedCount: 0,
      fundingCount: 0,
      mnaCount: 0,
      amountM: 0,
      primaryAmountM: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 10,
      baseRadius: 10,
      visible: true,
    },
  ]));

  for (const startup of raw.startups.filter(passesFilters)) {
    const primaryStat = categoryStats.get(startup.category);
    if (primaryStat) {
      primaryStat.count += 1;
      primaryStat.primaryAmountM += Number(startup.amountM) || 0;
      if (startup.mna) primaryStat.mnaCount += 1;
      else primaryStat.fundingCount += 1;
    }

    const domains = nodeDomains(startup);
    const total = domains.reduce((sum, item) => sum + Number(item.weight || 0), 0) || 1;
    for (const item of domains) {
      const stat = categoryStats.get(item.category);
      if (!stat) continue;
      const weight = Number(item.weight || 0) / total;
      stat.exposureCount += 1;
      stat.weightedCount += weight;
      stat.amountM += (Number(startup.amountM) || 0) * weight;
    }
  }

  const usedDomains = [...categoryStats.values()].filter((node) => node.exposureCount > 0);
  const maxDomainAmount = Math.max(1, ...usedDomains.map((node) => node.amountM));
  for (const node of usedDomains) {
    const anchor = categoryAnchor(node.category);
    node.x = anchor.x;
    node.y = anchor.y;
    node.capitalIntensityM = node.weightedCount ? node.amountM / node.weightedCount : 0;
    node.baseRadius = 10 + Math.sqrt(node.amountM / maxDomainAmount) * 38 + Math.sqrt(node.weightedCount) * 0.8;
    node.radius = node.baseRadius;
  }

  return usedDomains;
}

function nodeTarget(node) {
  if (node.kind === "startup") return startupTarget(node);
  return categoryAnchor(node.category);
}

function rebuildRenderNodes(resetPositions = false) {
  state.amountBounds = buildAmountBounds();
  state.renderNodes = state.mode === "startups" ? startupVisibleNodes() : buildDomainNodes();
  updateStats();
  if (resetPositions) fitLayout();
  kickAnimation();
}

function fitLayout() {
  const grouped = new Map();
  for (const node of state.renderNodes) {
    const key = node.category;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }

  for (const node of state.renderNodes) {
    const key = node.category;
    const group = grouped.get(key) || [];
    const groupIndex = group.indexOf(node);
    const target = nodeTarget(node);
    const h = hashNumber(node.id);
    const ring = 18 + (h % 54);
    const angle = (groupIndex / Math.max(1, group.length)) * Math.PI * 2 + (h % 100) / 80;
    node.x = target.x + Math.cos(angle) * ring;
    node.y = target.y + Math.sin(angle) * ring;
    node.vx = 0;
    node.vy = 0;
  }
}

function updateStats() {
  if (state.mode === "domains") {
    const domainNodes = state.renderNodes.filter((node) => node.kind === "domain");
    const investment = domainNodes.reduce((sum, node) => sum + node.amountM, 0);
    const deals = domainNodes.reduce((sum, node) => sum + node.count, 0);
    const avg = domainNodes.reduce((sum, node) => sum + node.capitalIntensityM, 0) / Math.max(1, domainNodes.length);
    stats.textContent = `${domainNodes.length} доменов · ${deals} primary-сделок · ${formatMoney(investment)} weighted · ${formatMoney(avg)}/сделка`;
    return;
  }

  const visible = state.renderNodes;
  const funding = visible.filter((node) => !node.mna).length;
  const mna = visible.filter((node) => node.mna).length;
  stats.textContent = `${visible.length} сделок · ${funding} инвестиций, ${mna} M&A`;
}

function initControls() {
  for (const bucket of amountBuckets) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = bucket;
    button.className = "active";
    button.addEventListener("click", () => toggleSet(state.activeAmounts, bucket, button));
    amountFilters.appendChild(button);
  }

  if (startupMode && domainMode) {
    bindModeButton(startupMode, "startups");
    bindModeButton(domainMode, "domains");
    startupMode.classList.toggle("active", state.mode === "startups");
    domainMode.classList.toggle("active", state.mode === "domains");
  }

  clearFilters.addEventListener("click", () => {
    hideTooltip({ clearSelection: true });
    state.activeAmounts = new Set(amountBuckets);
    document.querySelectorAll(".horizontal-chips button").forEach((el) => el.classList.add("active"));
    rebuildRenderNodes(true);
  });
}

function setMode(mode) {
  state.mode = mode;
  state.hovered = null;
  state.selected = null;
  tooltip.hidden = true;
  if (startupMode && domainMode) {
    startupMode.classList.toggle("active", mode === "startups");
    domainMode.classList.toggle("active", mode === "domains");
  }
  rebuildRenderNodes(true);
}

function bindModeButton(button, mode) {
  if (!button) return;
  const handler = (event) => {
    event.preventDefault();
    setMode(mode);
  };
  button.addEventListener("click", handler);
  button.addEventListener("pointerdown", handler);
}

function toggleSet(set, value, button) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
  button.classList.toggle("active", set.has(value));
  hideTooltip({ clearSelection: true });
  rebuildRenderNodes(true);
}

function tickPhysics() {
  const visible = state.renderNodes;
  const centerX = state.width * 0.5;
  const centerY = state.height * 0.52;

  for (const node of visible) {
    const target = nodeTarget(node);
    node.vx += (target.x - node.x) * 0.0062;
    node.vy += (target.y - node.y) * 0.0062;
    node.vx += (centerX - node.x) * 0.000015;
    node.vy += (centerY - node.y) * 0.000015;
  }

  collide(visible);

  const area = plotArea();
  for (const node of visible) {
    const targetRadius = node.baseRadius;
    node.radius += (targetRadius - node.radius) * 0.14;
    if (state.dragging !== node) {
      node.x += node.vx;
      node.y += node.vy;
    }
    node.vx *= 0.84;
    node.vy *= 0.84;
    node.x = Math.max(area.left, Math.min(area.right, node.x));
    node.y = Math.max(area.top, Math.min(area.bottom, node.y));
  }
}

function collide(nodes) {
  const grid = new Map();
  const cellSize = 84;
  for (const node of nodes) {
    const gx = Math.floor(node.x / cellSize);
    const gy = Math.floor(node.y / cellSize);
    const key = `${gx}:${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  }

  for (const a of nodes) {
    const gx = Math.floor(a.x / cellSize);
    const gy = Math.floor(a.y / cellSize);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get(`${gx + ox}:${gy + oy}`);
        if (!bucket) continue;
        for (const b of bucket) {
          if (a.indexKey && b.indexKey ? a.indexKey >= b.indexKey : a.id >= b.id) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          const minDist = a.radius + b.radius + (state.mode === "domains" ? 10 : 12);
          if (dist < minDist) {
            const force = (minDist - dist) * 0.006;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, state.width, state.height);
  drawMetricPlane();

  const activeId = state.selected?.id || state.hovered?.id;

  const visibleCount = state.renderNodes.length;
  for (const node of state.renderNodes) {
    const active = activeId && node.id === activeId;
    ctx.globalAlpha = activeId && !active ? 0.22 : 1;
    drawNode(node);
    if (active || node.radius >= (state.mode === "domains" ? 19 : 23) || visibleCount < 52) {
      drawLabel(node, active);
    }
    ctx.globalAlpha = 1;
  }
}

function drawMetricPlane() {
  const area = plotArea();
  const maxAmount = state.amountBounds?.maxAmount || 1;
  const capitalTicks = [0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000].filter((tick) => tick <= Math.ceil(maxAmount));

  ctx.save();
  ctx.strokeStyle = "rgba(248,250,252,0.17)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(area.left, area.top);
  ctx.lineTo(area.left, area.bottom);
  ctx.lineTo(area.right, area.bottom);
  ctx.stroke();

  ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = "rgba(248,250,252,0.48)";
  ctx.textBaseline = "middle";

  for (const slot of quarterSlots) {
    const x = quarterX({ year: slot.year, quarter: `Q${slot.quarter}` });
    ctx.strokeStyle = "rgba(248,250,252,0.07)";
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillText(quarterLabel(slot), x, area.bottom + 18);
  }

  for (const tick of capitalTicks) {
    const y = amountY(tick);
    ctx.strokeStyle = "rgba(248,250,252,0.07)";
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(formatMoney(tick), area.left - 10, y);
  }

  ctx.fillStyle = "rgba(248,250,252,0.68)";
  ctx.textAlign = "right";
  ctx.fillText("КВАРТАЛ СДЕЛКИ", area.right, area.bottom + 38);

  ctx.save();
  ctx.translate(area.left - 54, area.top);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "right";
  ctx.fillText("ОБЪЁМ ИНВЕСТИЦИЙ", 0, 0);
  ctx.restore();

  if (state.mode === "domains") {
    ctx.font = '600 8.5px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const node of state.renderNodes) {
      ctx.fillStyle = "rgba(248,250,252,0.12)";
      wrapLabel(node.label.toUpperCase(), node.x, node.y - node.radius - 16, 90, 10, 2);
    }
  }
  ctx.restore();
}

function drawNode(node) {
  const color = colorFor(node);
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = node === state.selected ? "#f8fafc" : "rgba(5,5,7,0.62)";
  ctx.stroke();

  if (node.kind === "startup" && node.confidence === "Low") {
    ctx.beginPath();
    ctx.arc(node.x + node.radius * 0.55, node.y - node.radius * 0.55, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
  }
}

function drawLabel(node, active) {
  ctx.font = `700 ${active ? 12 : 10.5}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(248,250,252,0.94)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  wrapLabel(node.label || node.name, node.x, node.y, Math.max(64, node.radius * 4.2), active ? 14 : 12, active ? 3 : 2);
}

function wrapLabel(text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines) clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/\s+\S+$/, "")}...`;
  const startY = y - ((clipped.length - 1) * lineHeight) / 2;
  clipped.forEach((entry, index) => ctx.fillText(entry, x, startY + index * lineHeight));
}

function kickAnimation() {
  state.frame = 0;
  if (!state.animating) {
    state.animating = true;
    requestAnimationFrame(loop);
  }
}

function loop() {
  state.frame += 1;
  tickPhysics();
  draw();
  if (state.frame < 90 || state.dragging) requestAnimationFrame(loop);
  else state.animating = false;
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function findNodeAt(x, y) {
  let best = null;
  for (const node of state.renderNodes) {
    const dist = Math.hypot(node.x - x, node.y - y);
    if (dist <= node.radius + 8 && (!best || dist < best.dist)) best = { node, dist };
  }
  return best?.node || null;
}

function setHovered(node, event = null) {
  const previous = state.hovered;
  state.hovered = node;
  if (node && previous !== node) showTooltip(node, event);
  if (previous !== node) draw();
}

function showTooltip(node, event = null) {
  if (!node) return;
  tooltip.hidden = false;
  tooltip.innerHTML = node.kind === "startup" ? startupTooltip(node) : domainTooltip(node);
  placeTooltip(event || { clientX: node.x + canvas.getBoundingClientRect().left, clientY: node.y + canvas.getBoundingClientRect().top });
}

function hideTooltip({ clearSelection = false } = {}) {
  if (clearSelection) state.selected = null;
  tooltip.hidden = true;
  tooltip.innerHTML = "";
  draw();
}

function tooltipFrame(content) {
  return `
    ${content}
  `;
}

function placeTooltip(event) {
  const margin = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + margin;
  let top = event.clientY + margin;
  if (left + rect.width > window.innerWidth - margin) left = event.clientX - rect.width - margin;
  if (top + rect.height > window.innerHeight - margin) top = event.clientY - rect.height - margin;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function startupTooltip(node) {
  const tagsMarkup = (node.tags || [])
    .slice(0, 5)
    .map((tag) => `<span class="tooltip-pill tag-pill">${escapeHtml(tag)}</span>`)
    .join("");
  const linksMarkup = [
    linkMarkup(node.dealSourceUrl, "Релиз / новость"),
  ].filter(Boolean).join("");
  const titleMarkup = /^https?:\/\//.test(String(node.website || ""))
    ? `<a class="tooltip-title" href="${escapeHtml(node.website)}" target="_blank" rel="noreferrer">${escapeHtml(node.name)}</a>`
    : `<strong class="tooltip-title">${escapeHtml(node.name)}</strong>`;
  const dealAmount = node.mna ? "M&A" : (node.investmentOriginal || node.amountBucket || "");

  return tooltipFrame(`
    <span class="tooltip-kicker">${escapeHtml(node.year)} · ${escapeHtml(node.quarter)} · ${escapeHtml(dealAmount)}</span>
    ${titleMarkup}
    <p>${escapeHtml(cleanSummary(node))}</p>
    <div class="tooltip-section">
      <span class="tooltip-section-label">Теги</span>
      <div class="tooltip-domains">${tagsMarkup || `<span class="tooltip-pill">нет тегов</span>`}</div>
    </div>
    ${node.sameCompanyDealCount > 1 ? `<div class="tooltip-domains meta-pills"><span class="tooltip-pill">${escapeHtml(node.sameCompanyDealCount)} сделки по той же компании</span></div>` : ""}
    <div class="tooltip-links">${linksMarkup}</div>
  `);
}

function domainTooltip(node) {
  return tooltipFrame(`
    <span class="tooltip-kicker">Домен</span>
    <strong>${escapeHtml(node.label)}</strong>
    <p>${escapeHtml(node.description || "")}</p>
    <div class="tooltip-domains">
      <span class="tooltip-pill">${node.count} primary-сделок</span>
      <span class="tooltip-pill">${node.exposureCount} с пересечениями</span>
      <span class="tooltip-pill">${Math.round(node.weightedCount * 10) / 10} weighted-сделок</span>
      <span class="tooltip-pill">${formatMoney(node.amountM)} weighted-инвестиций</span>
      <span class="tooltip-pill">${formatMoney(node.capitalIntensityM)} / сделка</span>
      <span class="tooltip-pill">${node.mnaCount} M&A</span>
    </div>
  `);
}

function cleanSummary(node) {
  const text = String(node.summary || "");
  const withoutPrefix = text.replace(new RegExp(`^${escapeRegExp(node.name)} is mapped as [^:]+:\\s*`, "i"), "");
  return withoutPrefix.replace(/\s*Product semantics are represented by:.*/i, "").trim() || node.tagsText || node.category;
}

function linkMarkup(url, label) {
  if (!/^https?:\/\//.test(String(url || ""))) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function domainLabel(node) {
  const domains = nodeDomains(node);
  if (!domains.length) return node.category;
  return domains.map((item) => `${item.category} ${Math.round(Number(item.weight || 0) * 100)}%`).join(" · ");
}

function formatMoney(value) {
  const num = Number(value) || 0;
  if (num >= 1000) return `$${Math.round(num / 100) / 10}B`;
  if (num >= 10) return `$${Math.round(num)}M`;
  if (num >= 1) return `$${Math.round(num * 10) / 10}M`;
  return `$${Math.round(num * 1000)}K`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

canvas.addEventListener("mousemove", (event) => {
  const pos = pointerPosition(event);
  if (state.dragging) {
    state.dragging.x = pos.x;
    state.dragging.y = pos.y;
    draw();
    return;
  }
  const node = findNodeAt(pos.x, pos.y);
  setHovered(node, event);
});

canvas.addEventListener("mouseleave", () => {
  setHovered(null);
});
canvas.addEventListener("mousedown", (event) => {
  const pos = pointerPosition(event);
  state.dragging = findNodeAt(pos.x, pos.y);
});
window.addEventListener("mouseup", () => {
  state.dragging = null;
});
canvas.addEventListener("click", (event) => {
  const pos = pointerPosition(event);
  const node = findNodeAt(pos.x, pos.y);
  if (!node) return;
  state.selected = node;
  showTooltip(node, event);
  draw();
});
window.addEventListener("resize", resize);

initControls();
window.__HRTECH_APP = { state, setMode, rebuildRenderNodes };
resize();
