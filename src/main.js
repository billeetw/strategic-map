import "./style.css";
import { astro } from "iztro";
import { KB2026 } from "./kb_2026.js";

/**
 * 核心狀態管理
 */
const SIHUA_2026 = KB2026.annual_sihua_2026;
let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;
let _resizeTimer = null;

// ===== 工具函式 (Utilities) =====
const $ = (id) => document.getElementById(id);
const toSafeText = (v) => (v === null || v === undefined ? "" : String(v));
const normalizePalaceName = (name) => (name || "").replace("宮", "");

function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

// ===== 介面控制 (UI & Bottom Sheet) =====
let _sheet = null;
function initBottomSheet() {
  _sheet = {
    root: $("sheet-root"),
    panel: $("sheet-panel"),
    backdrop: $("sheet-backdrop"),
    closeBtn: $("sheet-close"),
    title: $("sheet-title"),
    body: $("sheet-body"),
    isOpen: false
  };
  if (!_sheet.root) return;

  const close = () => {
    _sheet.panel.classList.add("translate-y-full");
    _sheet.isOpen = false;
    setTimeout(() => {
      _sheet.root.classList.add("hidden");
      document.body.style.overflow = "";
    }, 220);
  };
  _sheet.backdrop.onclick = close;
  _sheet.closeBtn.onclick = close;
}

function openBottomSheet({ title, html }) {
  if (!_sheet) return;
  _sheet.title.textContent = title;
  _sheet.body.innerHTML = html;
  _sheet.root.classList.remove("hidden");
  _sheet.body.scrollTop = 0;
  document.body.style.overflow = "hidden";
  _sheet.isOpen = true;
  requestAnimationFrame(() => _sheet.panel.classList.remove("translate-y-full"));
}

// ===== 命理邏輯核心 (Core Logic) =====

function starsOfPalace(palace) {
  return (palace?.majorStars || []).map((s) => s.name).filter(Boolean);
}

/**
 * 處理借對宮邏輯：如果該宮位無主星，則抓取對宮主星
 */
function getMajorStarsOrBorrow(idx) {
  const palace = _lastChart?.palaces?.[idx];
  if (!palace) return { mode: "none", palace: null, majors: [] };

  const majors = starsOfPalace(palace);
  if (majors.length) return { mode: "direct", palace, majors };

  const oppIdx = (idx + 6) % 12;
  const opp = _lastChart?.palaces?.[oppIdx];
  return { mode: "borrow", palace, opp, oppIdx, majors: starsOfPalace(opp) };
}

function starTagForMajors(majors) {
  if (!majors || !majors.length) return null;
  // 優先檢查雙星組合
  if (majors.length >= 2) {
    const combo1 = `${majors[0]}${majors[1]}`;
    const combo2 = `${majors[1]}${majors[0]}`;
    const hit = KB2026.star_profiles?.[combo1] || KB2026.star_profiles?.[combo2];
    if (hit) return hit;
  }
  return KB2026.star_profiles?.[majors[0]] || null;
}

// ===== 渲染器 (Renderers) =====

function deployTacticalMap() {
  const y = parseInt($("dob-year").value), m = parseInt($("dob-month").value), d = parseInt($("dob-day").value);
  const tob = $("tob").value, gender = $("gender").value === "female" ? "女" : "男", calendar = $("calendar").value;

  try {
    _lastChart = calendar === "lunar" 
      ? astro.byLunar(y, m, d, false, timeIndexFromInput(tob), gender, true, "zh-TW")
      : astro.bySolar(`${y}-${m}-${d}`, timeIndexFromInput(tob), gender, true, "zh-TW");
  } catch (e) {
    alert("演算失敗，請檢查日期");
    return;
  }

  $("input-section").classList.add("hidden");
  $("result-section").classList.remove("hidden");
  $("btn-reset").classList.remove("hidden");
  $("btn-recalc").classList.remove("hidden");

  renderMainChart();
  updateAnalysisUI();
  
  // 默認選中命宮
  const soulIdx = _lastChart.palaces.findIndex(p => p.earthlyBranch === _lastChart.earthlyBranchOfSoulPalace);
  selectPalace(soulIdx, { openSheet: false });
  
  setTimeout(drawClashLine, 300);
}

function renderMainChart() {
  const root = $("map-root");
  const centerHole = root.querySelector(".center-hole");
  const svgOverlay = $("svg-overlay");
  root.innerHTML = ""; root.appendChild(centerHole); root.appendChild(svgOverlay);

  _lastChart.palaces.forEach((palace, idx) => {
    const isNominal = palace.earthlyBranch === _lastChart.earthlyBranchOfSoulPalace;
    const pDiv = document.createElement("div");
    pDiv.id = `palace-${idx}`;
    pDiv.className = `palace p-${palace.earthlyBranch} ${isNominal ? "is-nominal" : ""}`;

    // 渲染主星與四化
    let starHtml = '<div class="flex h-full"><div class="flex">';
    palace.majorStars.forEach(s => {
      if (s.name === "廉貞") _lastLianZhenIdx = idx;
      const bHua = s.lunarSihua ? `<div class="hua-tag hua-birth">${s.lunarSihua}</div>` : "";
      const yHua = SIHUA_2026[s.name] ? `<div class="hua-tag hua-2026">${SIHUA_2026[s.name]}</div>` : "";
      starHtml += `<div class="star-main">${s.name}${bHua}${yHua}</div>`;
    });
    starHtml += '</div><div class="flex">';
    palace.minorStars.forEach(s => { starHtml += `<div class="star-minor">${s.name}</div>`; });
    starHtml += '</div></div>';

    pDiv.innerHTML = `${starHtml}<div class="palace-label">${palace.name}</div><div class="meta-label">${palace.heavenlyStem}${palace.earthlyBranch}</div><div class="age-label">${palace.changsheng12}</div>`;
    pDiv.onclick = () => selectPalace(idx, { openSheet: true });
    root.appendChild(pDiv);
  });

  $("bureau-text").innerText = _lastChart.fiveElementsClass;
  $("destiny-text").innerText = `${_lastChart.chineseDate} 生 / 命主 ${_lastChart.soul}`;
}

/**
 * 渲染宮位詳細解析 (這是你原本最精華的白話文邏輯)
 */
function renderPalaceDetail(idx) {
  const pack = getMajorStarsOrBorrow(idx);
  const palace = pack.palace;
  const key = normalizePalaceName(palace.name);
  const def = KB2026.palace_definitions?.[key];
  const tag = starTagForMajors(pack.majors);

  // 四化提示邏輯
  const huaLines = [];
  palace.majorStars.forEach(s => {
    if (s.lunarSihua) huaLines.push(`本命 ${s.name} 化${s.lunarSihua}`);
    if (SIHUA_2026[s.name]) huaLines.push(`2026 ${s.name} 化${SIHUA_2026[s.name]}`);
  });

  return `
    <div class="space-y-4">
      <div>
        <div class="text-xl font-black text-gold">${key}宮 <span class="text-sm text-zinc-500">#${palace.earthlyBranch}</span></div>
        <div class="text-xs text-zinc-500 font-mono">${palace.heavenlyStem}${palace.earthlyBranch} ｜ ${palace.changsheng12}</div>
      </div>
      ${def ? `<div class="p-3 bg-zinc-900 border-l-2 border-gold text-sm text-zinc-200">
        <strong>場景：${def.label}</strong><br/>${def.desc}
      </div>` : ""}
      ${pack.mode === "borrow" ? `<div class="text-xs text-red-400 italic">此宮無主星，借對宮（${normalizePalaceName(pack.oppPalace?.name || "對")}宮）主星參看</div>` : ""}
      <div class="grid grid-cols-2 gap-4 mt-4">
        <div>
          <label class="label">主星人設</label>
          <div class="text-sm font-bold text-zinc-100">${tag ? tag.tag : "性格多面，需綜合判定"}</div>
        </div>
        <div>
          <label class="label">四化紅綠燈</label>
          <div class="text-xs text-zinc-300">${huaLines.join("<br/>") || "今年平穩"}</div>
        </div>
      </div>
      <div class="mt-4 pt-4 border-t border-zinc-800">
        <label class="label">戰略行動建議</label>
        <ul class="text-sm text-zinc-300 space-y-2">
          ${(def?.cta || ["保持覺察，順勢而為"]).map(c => `<li>• ${c}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function selectPalace(idx, opts = { openSheet: true }) {
  _selectedPalaceIdx = idx;
  document.querySelectorAll(".palace").forEach(el => el.classList.remove("is-selected"));
  $(`palace-${idx}`).classList.add("is-selected");

  const html = renderPalaceDetail(idx);
  $("palace-detail").innerHTML = html;
  $("selected-palace-name").textContent = `${normalizePalaceName(_lastChart.palaces[idx].name)}宮`;

  if (opts.openSheet && window.innerWidth < 640) {
    openBottomSheet({ title: "戰略解析", html });
  }
}

// ===== 視覺畫線 & CSV 導出 (保持原版功能) =====

function drawClashLine() {
  const svg = $("svg-overlay"); svg.innerHTML = "";
  if (_lastLianZhenIdx === -1) return;
  const rootRect = $("map-root").getBoundingClientRect();
  const p1 = $(`palace-${_lastLianZhenIdx}`).getBoundingClientRect();
  const p2 = $(`palace-${(_lastLianZhenIdx + 6) % 12}`).getBoundingClientRect();

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", p1.left - rootRect.left + p1.width/2);
  line.setAttribute("y1", p1.top - rootRect.top + p1.height/2);
  line.setAttribute("x2", p2.left - rootRect.left + p2.width/2);
  line.setAttribute("y2", p2.top - rootRect.top + p2.height/2);
  line.setAttribute("stroke", "#C41E3A"); line.setAttribute("stroke-width", "2"); line.setAttribute("stroke-dasharray", "5,5");
  svg.appendChild(line);
}

function updateAnalysisUI() {
  // 更新年度導航 Aphorism
  const lzPalace = _lastChart.palaces[_lastLianZhenIdx];
  const lzName = lzPalace ? lzPalace.name : "未知宮位";
  $("aphorism-text").innerText = `2026 丙午年，流年化忌（廉貞）落入你的【${lzName}】。這意味著該領域是今年的「修繕重點區」，建議採取「先守後攻」的戰略。`;
  
  // 更新流月任務
  const months = (KB2026.monthly_strategy || []).map(it => `
    <div class="quest-item">
      <div class="text-gold font-black mb-1">${it.month}月｜${it.theme}</div>
      <div class="text-zinc-300 text-xs">${it.desc}</div>
    </div>
  `).join("");
  $("quest-list").innerHTML = months;
}

// ===== 初始化 & 事件綁定 =====
window.onload = () => {
  initDOBSelectors(); // 這裡延用你原本的 select 生成邏輯
  initBottomSheet();
  $("btn-export-csv")?.addEventListener("click", exportCSV);
};

window.deployTacticalMap = deployTacticalMap;
window.resetToInput = () => location.reload();

window.onresize = () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(drawClashLine, 200);
};

// ... 此處省略 exportCSV 函式，建議延用你原本寫得很好的版本 ...
