import "./style.css";
import { astro } from "iztro";

// 2026 丙午年四化：同機昌廉
const SIHUA_2026 = { "天同": "祿", "天機": "權", "文昌": "科", "廉貞": "忌" };

// ===== 人生/性格導向：四化白話 =====
const HUA_MEANING_LIFE = {
  "祿": "更容易得到支持、資源靠近你（舒服，但也可能變懶）",
  "權": "主導感變強、責任上身、你會被推去做決定（也更容易累）",
  "科": "更容易被看見與肯定，適合建立作品/口碑/信用",
  "忌": "容易卡住或反覆，會戳到你的焦慮點（但也是最能長大的地方）",
};

// ===== 人生/性格導向：宮位白話（先做最重要幾個） =====
const PALACE_MEANING_LIFE = {
  "命": "你這個人最核心的性格與人生主題（做事本能）",
  "福德": "你怎麼快樂、怎麼充電、內在安全感來源",
  "疾厄": "壓力反應、耗損點、身心修復方式",
  "夫妻": "親密關係互動模式、承諾與界線",
  "交友": "人際圈與社交風格、你吸引什麼人、支持系統",
  "官祿": "工作風格與角色感（也會影響自我價值）",
  "財帛": "你對金錢/價值的信念、如何把能力變現",
};

// ===== 人生/性格導向：14 主星白話（天賦/陰影/需要/練習） =====
const STAR_PROFILE = {
  "紫微": { gift:"主心骨、格局感", shadow:"容易背太多、控制/責任過頭", need:"信任與授權", practice:"把『我扛』改成『我帶』" },
  "天機": { gift:"洞察、策略、反應快", shadow:"想太多、焦慮、三心二意", need:"節奏與收斂", practice:"每次只做一件『最重要的事』" },
  "太陽": { gift:"行動力、願意照亮別人", shadow:"逞強、怕示弱、過勞", need:"休息不等於退縮", practice:"把『被需要』改成『被尊重』" },
  "武曲": { gift:"務實可靠、能扛績效", shadow:"太硬、情緒被壓住", need:"允許自己脆弱", practice:"先說感受，再談解法" },
  "天同": { gift:"人緣、溫柔修復力", shadow:"逃避衝突、拖延", need:"界線與決斷", practice:"把『好好』改成『清楚』" },
  "廉貞": { gift:"原則、魅力、重整能力", shadow:"黑白分明、糾結拉扯", need:"灰度與彈性", practice:"先問『我想要什麼』再談對錯" },
  "天府": { gift:"穩、守成、資源整合", shadow:"怕變動、安逸", need:"適度冒險", practice:"每季做一次小幅更新" },
  "太陰": { gift:"細膩、感受深、品味", shadow:"敏感內耗、悶", need:"被理解與安全感", practice:"把想法說出來，不要只放心裡" },
  "貪狼": { gift:"企圖心、人脈、享受人生", shadow:"分心、過量", need:"排序與節制", practice:"先選一個主線，其餘當獎勵" },
  "巨門": { gift:"思辨、抓問題核心", shadow:"挑剔、鑽牛角尖", need:"同理與降噪", practice:"先確認『我們同一隊』再討論" },
  "天相": { gift:"公平、專業、協調", shadow:"怕得罪人、猶豫", need:"決策底線", practice:"設定原則：可談/不可談" },
  "天梁": { gift:"保護力、貴人、風險控管", shadow:"太保守、說教", need:"允許享受", practice:"把『應該』換成『選擇』" },
  "七殺": { gift:"果斷攻堅、破局", shadow:"太急、硬碰硬", need:"策略與耐心", practice:"先佈局再出手" },
  "破軍": { gift:"改革、重啟勇氣", shadow:"衝動全砍、忽略成本", need:"收尾能力", practice:"改版要保留一條安全繩" },
};

let _lastChart = null;
let _lastLianZhenIdx = -1;
let _selectedPalaceIdx = -1;

function showError(msg) {
  const box = document.getElementById("error-box");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}
function clearError() {
  const box = document.getElementById("error-box");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
}

function toSafeText(v) {
  return v === null || v === undefined ? "" : String(v);
}

// iztro timeIndex：0..12（含早/晚子）
// - 00:00~00:59 → 0（早子）
// - 23:00~23:59 → 12（晚子）
// - 其餘每 2 小時一段：1..11
function timeIndexFromInput(tob) {
  const hour = parseInt((tob || "12:00").split(":")[0], 10);
  if (hour === 0) return 0;
  if (hour === 23) return 12;
  return Math.floor((hour + 1) / 2);
}

function normalizePalaceName(name) {
  return (name || "").replace("宮", "");
}

function starLineLife(starName) {
  const p = STAR_PROFILE[starName];
  if (!p) return `【${toSafeText(starName)}】（尚未建立白話）`;
  return `【${toSafeText(starName)}】天賦：${p.gift}｜陰影：${p.shadow}｜需要：${p.need}｜練習：${p.practice}`;
}

function huaHintsLife(palace) {
  const lines = [];
  for (const s of (palace.majorStars || [])) {
    const annual = SIHUA_2026[s.name];
    const natal = s.lunarSihua;

    if (natal && HUA_MEANING_LIFE[natal]) {
      lines.push(`本命 ${s.name} 化${natal}：${HUA_MEANING_LIFE[natal]}`);
    }
    if (annual && HUA_MEANING_LIFE[annual]) {
      lines.push(`2026 ${s.name} 化${annual}：${HUA_MEANING_LIFE[annual]}`);
    }
  }
  return lines;
}

function buildLifeExplainHTML(palace) {
  const key = normalizePalaceName(palace.name);
  const meaning = PALACE_MEANING_LIFE[key] || "（此宮位人生意義待補）";

  const majors = (palace.majorStars || []).map(s => s.name).slice(0, 3);
  const starText = majors.length ? majors.map(starLineLife).join("<br/>") : "此宮主星較少：更建議看你在此領域的行為模式與四化提示。";

  const hua = huaHintsLife(palace);
  const huaText = hua.length
    ? `- ${hua.join("<br/>- ")}`
    : "（此宮今年沒有明顯四化標記，重點回到主星的天賦/陰影如何被你使用。）";

  return `
    <div class="mt-4 border-t border-zinc-800 pt-4">
      <div class="text-[11px] text-zinc-400 mb-2">新手白話（人生/性格）</div>
      <div class="text-[12px] leading-relaxed text-zinc-200">
        <div class="mb-2">這是【${toSafeText(palace.name)}】：${meaning}</div>
        <div class="mb-3">${starText}</div>
        <div class="text-zinc-300">
          <div class="text-[11px] text-zinc-400 mb-1">四化提示</div>
          ${huaText}
        </div>
      </div>
    </div>
  `;
}

function buildProfileSummaryHTML(chart) {
  const getPalaceByKey = (k) =>
    chart.palaces.find(p => normalizePalaceName(p.name) === k) || null;

  // 命宮：優先用「宮名=命」找，避免抓錯（你之前出現（無）就是常見情況）
  const ming = getPalaceByKey("命") || null;

  const fud = getPalaceByKey("福德");
  const jie = getPalaceByKey("疾厄");
  const fuqi = getPalaceByKey("夫妻");
  const friends = getPalaceByKey("交友");

  const pickStars = (p) => (p?.majorStars || []).map(s => s.name).slice(0, 2).join("、") || "（無）";

  const mingStars = pickStars(ming);
  const fudStars = pickStars(fud);
  const jieStars = pickStars(jie);

  return `
    <div class="text-zinc-200">
      你的性格核心（命宮）：<span class="text-[#D4AF37] font-bold">${toSafeText(mingStars)}</span>
    </div>

    <div class="text-zinc-400 mt-2">快樂與安全感（福德）：${toSafeText(fudStars)}</div>
    <div class="text-zinc-400 mt-1">壓力反應（疾厄）：${toSafeText(jieStars)}</div>
    <div class="text-zinc-400 mt-1">關係模式（夫妻 / 交友）：${toSafeText(pickStars(fuqi))} ／ ${toSafeText(pickStars(friends))}</div>

    <div class="mt-3 text-[11px] text-zinc-500 leading-relaxed">
      讀盤順序（小白版）：命宮看「你怎麼做事」→ 福德看「你怎麼快樂」→ 疾厄看「你怎麼耗損」→ 夫妻/交友看「你怎麼連結」。
      四化是今年在哪裡更容易舒服/卡住的提示。
    </div>
  `;
}

function resetToInput() {
  document.getElementById("result-section")?.classList.add("hidden");
  document.getElementById("input-section")?.classList.remove("hidden");
  document.getElementById("btn-reset")?.classList.add("hidden");
  document.getElementById("btn-recalc")?.classList.add("hidden");
  clearError();

  _lastChart = null;
  _lastLianZhenIdx = -1;
  _selectedPalaceIdx = -1;

  const detail = document.getElementById("palace-detail");
  if (detail) detail.innerHTML = `<div class="text-zinc-500 text-[11px]">尚未選擇宮位。</div>`;

  const profile = document.getElementById("profile-summary");
  if (profile) profile.innerHTML = `<div class="text-zinc-500 text-[11px]">請先啟動演算。</div>`;
}

function scrollToTopQuests() {
  const el = document.getElementById("quest-list");
  if (el) el.scrollTop = 0;
}

function deployTacticalMap() {
  clearError();

  const dob = document.getElementById("dob")?.value;
  const tob = document.getElementById("tob")?.value;
  const gender = document.getElementById("gender")?.value || "male";
  const calendar = document.getElementById("calendar")?.value || "gregorian";

  if (!dob) {
    showError("請先輸入出生日期。");
    return;
  }

  // 顯示結果區
  document.getElementById("input-section")?.classList.add("hidden");
  document.getElementById("result-section")?.classList.remove("hidden");
  document.getElementById("btn-reset")?.classList.remove("hidden");
  document.getElementById("btn-recalc")?.classList.remove("hidden");

  const [y, m, d] = dob.split("-").map(Number);
  const timeIdx = timeIndexFromInput(tob);
  const genderZh = gender === "female" ? "女" : "男";

  let chart;
  try {
    if (calendar === "lunar") {
      // lunar: byLunar(year, month, day, isLeapMonth, timeIndex, gender, fixLeap, locale?)
      chart = astro.byLunar(y, m, d, false, timeIdx, genderZh, true, "zh-TW");
    } else {
      chart = astro.bySolar(`${y}-${m}-${d}`, timeIdx, genderZh, true, "zh-TW");
    }
  } catch (e) {
    console.error(e);
    showError("演算失敗：請確認輸入資料是否正確，或切換『曆法』重算。");
    resetToInput();
    return;
  }

  _lastChart = chart;
  _selectedPalaceIdx = -1;

  // 重建盤面（保留中心與 SVG overlay）
  const root = document.getElementById("map-root");
  const centerHole = root?.querySelector(".center-hole");
  const svgOverlay = root?.querySelector("#svg-overlay");
  if (!root || !centerHole || !svgOverlay) {
    showError("頁面結構缺失：找不到盤面容器（map-root）。");
    return;
  }

  root.innerHTML = "";
  root.appendChild(centerHole);
  root.appendChild(svgOverlay);

  // 命宮地支（iztro）
  const nominalBranch = chart.earthlyBranchOfSoulPalace;

  // 找廉貞位置（畫對沖線）
  let lianZhenIdx = -1;

  chart.palaces.forEach((palace, idx) => {
    const pDiv = document.createElement("div");
    pDiv.id = `palace-${idx}`;

    const isNominal = palace.earthlyBranch === nominalBranch;
    pDiv.className = `palace p-${palace.earthlyBranch} ${isNominal ? "is-nominal" : ""}`;

    pDiv.tabIndex = 0;
    pDiv.setAttribute("role", "button");
    pDiv.setAttribute("aria-label", `${toSafeText(palace.name)} 宮`);

    const flex = document.createElement("div");
    flex.className = "flex h-full";

    const majorWrap = document.createElement("div");
    majorWrap.className = "flex";

    const minorWrap = document.createElement("div");
    minorWrap.className = "flex";

    // 主星
    (palace.majorStars || []).forEach((s) => {
      if (s.name === "廉貞") lianZhenIdx = idx;

      const star = document.createElement("div");
      star.className = "star-main";
      star.textContent = toSafeText(s.name);

      // 本命四化（如果資料有）
      if (s.lunarSihua) {
        const tag = document.createElement("div");
        tag.className = "hua-tag hua-birth";
        tag.textContent = toSafeText(s.lunarSihua);
        star.appendChild(tag);
      }

      // 2026 流年四化（固定映射）
      if (SIHUA_2026[s.name]) {
        const tag2 = document.createElement("div");
        tag2.className = "hua-tag hua-2026";
        tag2.textContent = toSafeText(SIHUA_2026[s.name]);
        star.appendChild(tag2);
      }

      majorWrap.appendChild(star);
    });

    // 輔星
    (palace.minorStars || []).forEach((s) => {
      const star = document.createElement("div");
      star.className = "star-minor";
      star.textContent = toSafeText(s.name);
      minorWrap.appendChild(star);
    });

    flex.appendChild(majorWrap);
    flex.appendChild(minorWrap);

    const label = document.createElement("div");
    label.className = "palace-label";
    label.textContent = toSafeText(palace.name);

    const meta = document.createElement("div");
    meta.className = "meta-label";
    meta.textContent = `${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)}`;

    const age = document.createElement("div");
    age.className = "age-label";
    age.textContent = toSafeText(palace.changsheng12);

    pDiv.appendChild(flex);
    pDiv.appendChild(label);
    pDiv.appendChild(meta);
    pDiv.appendChild(age);

    pDiv.addEventListener("click", () => selectPalace(idx));
    pDiv.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        selectPalace(idx);
      }
    });

    root.appendChild(pDiv);
  });

  _lastLianZhenIdx = lianZhenIdx;

  document.getElementById("bureau-text").innerText = toSafeText(chart.fiveElementsClass);
  document.getElementById("destiny-text").innerText =
    `${toSafeText(chart.chineseDate)} 生 / 命主 ${toSafeText(chart.soul)}`;

  updateAnalysis(chart, lianZhenIdx);

  // NEW：渲染命格一分鐘摘要
  const profileEl = document.getElementById("profile-summary");
  if (profileEl) profileEl.innerHTML = buildProfileSummaryHTML(chart);

  // 預設選命宮（以宮名=命為主）
  const nominalIdx = chart.palaces.findIndex((p) => normalizePalaceName(p.name) === "命");
  if (nominalIdx >= 0) selectPalace(nominalIdx);

  drawClashLine(lianZhenIdx);

  window.removeEventListener("resize", _onResizeRedraw);
  window.addEventListener("resize", _onResizeRedraw);
}

function _onResizeRedraw() {
  if (_lastChart) drawClashLine(_lastLianZhenIdx);
}

function selectPalace(idx) {
  _selectedPalaceIdx = idx;

  for (let i = 0; i < 12; i++) {
    const el = document.getElementById(`palace-${i}`);
    if (el) el.classList.remove("is-selected");
  }
  const current = document.getElementById(`palace-${idx}`);
  if (current) current.classList.add("is-selected");

  const palace = _lastChart?.palaces?.[idx];
  if (!palace) return;
  renderPalaceDetail(palace, idx);
}

function renderPalaceDetail(palace, idx) {
  const major = (palace.majorStars || []).map((s) => {
    const birth = s.lunarSihua
      ? ` <span class="px-1.5 py-0.5 rounded bg-red-800/70 text-white text-[10px]">${toSafeText(s.lunarSihua)}</span>`
      : "";
    const ann = SIHUA_2026[s.name]
      ? ` <span class="px-1.5 py-0.5 rounded bg-blue-800/70 text-white text-[10px]">${toSafeText(SIHUA_2026[s.name])}</span>`
      : "";
    return `<div class="flex items-center gap-2">
      <div class="text-[#D4AF37] font-black">${toSafeText(s.name)}</div>
      <div class="flex gap-1">${birth}${ann}</div>
    </div>`;
  }).join("");

  const minor = (palace.minorStars || []).map((s) =>
    `<span class="inline-block mr-2 mb-2 px-2 py-1 border border-zinc-800 text-zinc-300 text-[11px]">${toSafeText(s.name)}</span>`
  ).join("");

  const detailEl = document.getElementById("palace-detail");
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-black">${toSafeText(palace.name)} <span class="text-[11px] text-zinc-500">#${idx}</span></div>
        <div class="text-[11px] text-zinc-500 font-mono mt-1">
          ${toSafeText(palace.heavenlyStem)}${toSafeText(palace.earthlyBranch)} ｜ ${toSafeText(palace.changsheng12)}
        </div>
      </div>
    </div>

    <div class="mt-4">
      <div class="text-[11px] text-zinc-400 mb-2">主星</div>
      <div class="space-y-2">${major || `<div class="text-zinc-500 text-[11px]">（無資料）</div>`}</div>
    </div>

    <div class="mt-4">
      <div class="text-[11px] text-zinc-400 mb-2">輔星</div>
      <div>${minor || `<div class="text-zinc-500 text-[11px]">（無資料）</div>`}</div>
    </div>
  `;

  // NEW：宮位小白說明（人生/性格）
  detailEl.innerHTML += buildLifeExplainHTML(palace);
}

function updateAnalysis(chart, lzIdx) {
  const jiPalace = lzIdx >= 0 ? chart.palaces[lzIdx] : null;
  const luPalace = chart.palaces.find((p) => (p.majorStars || []).some((s) => s.name === "天同")) || null;

  const jiName = jiPalace ? jiPalace.name : "（未定位）";
  const luName = luPalace ? luPalace.name : "（未定位）";

  document.getElementById("aphorism-text").innerText =
    `2026 丙午年戰略重點在於「轉化」與「重組」。` +
    `流年化忌（廉貞）落入你的【${jiName}】，代表該領域在 2026 年容易面臨結構性壓力：先修系統、先補洞，再談衝刺。` +
    `而天同化祿進入【${luName}】，這裡是年度更容易出現「資源／合作／收入窗口」的突破口，適合把成果做成可複製的產品化流程。`;

  const months = buildMonthlyQuests(luName, jiName);
  document.getElementById("quest-list").innerHTML = months.map((q) => `
    <div class="quest-item">
      <div class="text-[#D4AF37] font-bold mb-1">${q.m}｜戰略任務</div>
      <div class="text-zinc-400 leading-relaxed">${q.task}</div>
    </div>
  `).join("");
}

function buildMonthlyQuests(luName, jiName) {
  const focus = {
    lu: `（機會點：${luName}）`,
    ji: `（壓力點：${jiName}）`
  };

  return [
    { m: "1 月",  task: `年度過渡期：清點資源、關掉不賺的支線，把 KPI 變成 2～3 個可執行指標。${focus.ji}` },
    { m: "2 月",  task: `啟動月：挑一個「最能變現」的切入點做 MVP，上線後用數據迭代。${focus.lu}` },
    { m: "3 月",  task: `擴散月：用合作／聯名／渠道換取曝光，建立「可重複成交」的內容漏斗。${focus.lu}` },
    { m: "4 月",  task: `修正月：做一次成本結構盤點（時間/人力/錢），把卡住的流程拆解到可交付。${focus.ji}` },
    { m: "5 月",  task: `權限月：把 SOP、權責、交付節點寫清楚，避免「人治」造成反覆返工。${focus.ji}` },
    { m: "6 月",  task: `產品月：把成果包裝成可銷售的方案（清楚價目、交付範圍、保固條款）。${focus.lu}` },
    { m: "7 月",  task: `轉換月：針對轉換率做優化：落地頁、報價結構、追蹤節點、客服腳本。${focus.lu}` },
    { m: "8 月",  task: `防火月：檢查合約與風險點，替最脆弱的一環做備援（人/系統/資金）。${focus.ji}` },
    { m: "9 月",  task: `品牌月：集中火力打造「你被記住的關鍵一句話」，統一視覺與訊息。${focus.lu}` },
    { m: "10 月", task: `整併月：砍掉低效專案，保留最強的 1～2 條主幹，把資源壓到能贏的地方。${focus.ji}` },
    { m: "11 月", task: `收割月：把年度成果做案例化（數據、前後對比、證言），用來打下一年度的單。${focus.lu}` },
    { m: "12 月", task: `封存月：年度復盤（哪些賺錢、哪些耗能），把流程與知識庫整理成可複製模板。${focus.ji}` },
  ];
}

function drawClashLine(idx) {
  const svg = document.getElementById("svg-overlay");
  const root = document.getElementById("map-root");
  if (!svg || !root) return;

  svg.innerHTML = "";
  if (idx === -1) return;

  const container = root.getBoundingClientRect();
  const el1 = document.getElementById(`palace-${idx}`);
  const el2 = document.getElementById(`palace-${(idx + 6) % 12}`);
  if (!el1 || !el2) return;

  const r1 = el1.getBoundingClientRect();
  const r2 = el2.getBoundingClientRect();

  const x1 = r1.left - container.left + r1.width / 2;
  const y1 = r1.top - container.top + r1.height / 2;
  const x2 = r2.left - container.left + r2.width / 2;
  const y2 = r2.top - container.top + r2.height / 2;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("stroke", "#C41E3A");
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("stroke-dasharray", "6,4");
  line.setAttribute("opacity", "0.65");

  const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c1.setAttribute("cx", x1);
  c1.setAttribute("cy", y1);
  c1.setAttribute("r", "2.8");
  c1.setAttribute("fill", "#C41E3A");
  c1.setAttribute("opacity", "0.55");

  const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c2.setAttribute("cx", x2);
  c2.setAttribute("cy", y2);
  c2.setAttribute("r", "2.8");
  c2.setAttribute("fill", "#C41E3A");
  c2.setAttribute("opacity", "0.55");

  svg.appendChild(line);
  svg.appendChild(c1);
  svg.appendChild(c2);
}

// 讓 HTML onclick 可呼叫（Vite module scope 不會自動變全域）
window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.scrollToTopQuests = scrollToTopQuests;

window.deployTacticalMap = deployTacticalMap;
window.resetToInput = resetToInput;
window.scrollToTopQuests = scrollToTopQuests;
