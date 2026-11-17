(function () {
  "use strict";
  const FRAME_COUNT = 16;
  const COLORS = ["#56c8ff", "#5cf0cb", "#ffc45f", "#c38cff", "#ff7e90", "#72a0ff", "#e9f27a", "#70e6ff", "#ff9d5c", "#8df59a", "#e1a6ff", "#ff6ec7"];
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
  const hexByte = value => clamp(value).toString(16).toUpperCase().padStart(2, "0");

  const state = {
    channels: [], selected: 0, frame: 0, playing: false, timer: null, backup: null,
    previewMap: { drl: 0, low: 1, high: 2, accent: 3 },
    mapping: { block: "", offset: 0, mode: "all", byteOrder: "normal" }
  };

  function pattern(type, channelIndex) {
    return Array.from({ length: FRAME_COUNT }, (_, frame) => {
      const x = frame / (FRAME_COUNT - 1);
      if (type === "welcome") return clamp(255 * Math.sin(Math.max(0, Math.min(1, x * 1.35 - channelIndex * .045)) * Math.PI / 2));
      if (type === "breath") return clamp(20 + 235 * (.5 - .5 * Math.cos(x * Math.PI * 2)));
      if (type === "sweep") return clamp(255 * Math.exp(-Math.pow(frame - channelIndex * 1.65 - 2, 2) / 5));
      if (type === "pulse") return clamp(255 * Math.max(Math.exp(-Math.pow(frame - 4, 2) / 2), Math.exp(-Math.pow(frame - 11, 2) / 2.4)));
      if (type === "linear") return clamp(x * 255);
      return 0;
    });
  }

  function resetDemo() {
    const names = ["DRL Left", "Low Beam", "High Beam", "Welcome Accent", "DRL Right", "Corner Left", "Corner Right", "Laser / Matrix"];
    state.channels = names.map((name, index) => ({ id: `ch-${Date.now()}-${index}`, name, color: COLORS[index], values: pattern(index < 4 ? "welcome" : "sweep", index) }));
    state.selected = 0; state.frame = 0;
    state.previewMap = { drl: 0, low: 1, high: 2, accent: 3 };
    renderAll();
  }

  function selectedChannel() { return state.channels[state.selected]; }
  function combinedBytes() { return Uint8Array.from(state.channels.flatMap(channel => channel.values.map(clamp))); }
  function formatHex(bytes, lineSize = 16) { return [...bytes].map(hexByte).reduce((text, value, index) => text + (index && index % lineSize === 0 ? "\n" : index ? " " : "") + value, ""); }
  function parseHex(text) {
    const compact = String(text).replace(/0x/gi, "").replace(/[\s,;:_-]+/g, "").trim();
    if (!compact) return [];
    if (!/^[0-9a-f]+$/i.test(compact)) throw new Error("包含非十六进制字符");
    if (compact.length % 2) throw new Error("十六进制字符数量必须为偶数");
    return compact.match(/.{2}/g).map(item => parseInt(item, 16));
  }
  function checksum(bytes) {
    let hash = 0x811c9dc5;
    for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash.toString(16).toUpperCase().padStart(8, "0");
  }
  function describe(value) {
    if (value === 0) return "关闭";
    if (value < 32) return "微亮";
    if (value < 96) return "低亮度";
    if (value < 176) return "中亮度";
    if (value < 240) return "高亮度";
    return "全亮";
  }

  function renderChannelList() {
    $("#channelList").innerHTML = state.channels.map((channel, index) => `<button class="channel-card ${index === state.selected ? "active" : ""}" style="--channel-color:${channel.color}" data-channel="${index}"><strong>${String(index + 1).padStart(2, "0")} · ${escapeHtml(channel.name)}</strong><span>${Math.max(...channel.values)} MAX · ${Math.round(channel.values.reduce((a, b) => a + b, 0) / channel.values.length)} AVG</span></button>`).join("");
    $$("[data-channel]").forEach(button => button.addEventListener("click", () => { state.selected = Number(button.dataset.channel); renderAll(); }));
  }

  function renderEditor() {
    const channel = selectedChannel();
    if (!channel) return;
    $("#selectedChannelTitle").textContent = `Channel ${String(state.selected + 1).padStart(2, "0")}`;
    $("#selectedChannelMeta").textContent = `${channel.values.length} bytes · 0–255`;
    $("#channelNameInput").value = channel.name;
    $("#hexInput").value = formatHex(channel.values);
    $("#hexValidation").textContent = `${channel.values.length} / ${FRAME_COUNT} bytes`;
    $("#hexValidation").className = "validation ok";
    $("#byteTranslation").innerHTML = channel.values.map((value, index) => `<div class="translation-item"><span>${String(index).padStart(2, "0")} · 0x${hexByte(value)}</span><strong>${describe(value)} · ${Math.round(value / 255 * 100)}%</strong></div>`).join("");
    drawCurve();
  }

  function drawCurve() {
    const canvas = $("#curveCanvas");
    const channel = selectedChannel();
    if (!channel || !canvas.clientWidth) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = width * ratio; canvas.height = height * ratio;
    const context = canvas.getContext("2d"); context.scale(ratio, ratio);
    const pad = { left: 28, right: 16, top: 15, bottom: 23 };
    const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,.065)"; context.lineWidth = 1;
    for (let row = 0; row <= 4; row += 1) { const y = pad.top + plotHeight * row / 4; context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke(); }
    for (let col = 0; col < FRAME_COUNT; col += 1) { const x = pad.left + plotWidth * col / (FRAME_COUNT - 1); context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke(); }
    const points = channel.values.map((value, index) => ({ x: pad.left + plotWidth * index / (FRAME_COUNT - 1), y: pad.top + plotHeight * (1 - value / 255) }));
    const gradient = context.createLinearGradient(0, pad.top, 0, height - pad.bottom); gradient.addColorStop(0, channel.color + "55"); gradient.addColorStop(1, channel.color + "02");
    context.beginPath(); context.moveTo(points[0].x, height - pad.bottom); points.forEach(point => context.lineTo(point.x, point.y)); context.lineTo(points.at(-1).x, height - pad.bottom); context.closePath(); context.fillStyle = gradient; context.fill();
    context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.strokeStyle = channel.color; context.lineWidth = 2.2; context.shadowColor = channel.color; context.shadowBlur = 8; context.stroke(); context.shadowBlur = 0;
    points.forEach((point, index) => { context.beginPath(); context.arc(point.x, point.y, index === state.frame ? 4.7 : 3, 0, Math.PI * 2); context.fillStyle = index === state.frame ? "#fff" : channel.color; context.fill(); });
    context.fillStyle = "rgba(190,205,222,.55)"; context.font = "9px monospace"; context.fillText("255", 3, pad.top + 4); context.fillText("0", 13, height - pad.bottom + 3);
  }

  function renderZoneSelectors() {
    $$('[data-zone-select]').forEach(select => {
      const zone = select.dataset.zoneSelect;
      const current = Math.min(state.previewMap[zone] || 0, state.channels.length - 1);
      state.previewMap[zone] = current;
      select.innerHTML = state.channels.map((channel, index) => `<option value="${index}" ${index === current ? "selected" : ""}>${String(index + 1).padStart(2, "0")} · ${escapeHtml(channel.name)}</option>`).join("");
      select.onchange = () => { state.previewMap[zone] = Number(select.value); renderPreview(); };
    });
  }

  function renderPreview() {
    for (const zone of ["drl", "low", "high", "accent"]) {
      const channel = state.channels[state.previewMap[zone]] || state.channels[0];
      const level = channel ? channel.values[state.frame] / 255 : 0;
      $$(`[data-zone="${zone}"]`).forEach(element => { element.style.opacity = String(.04 + level * .96); element.style.filter = `brightness(${.45 + level * 1.45}) saturate(${.6 + level * .65})`; });
      if (zone === "low" || zone === "high") $$(`.beam-${zone === "low" ? "left" : "right"}`).forEach(element => element.style.opacity = String(level));
    }
    $("#timelineRange").value = state.frame;
    $("#frameReadout").textContent = `FRAME ${String(state.frame + 1).padStart(2, "0")} / ${FRAME_COUNT}`;
    $("#timeReadout").textContent = `${(state.frame * Number($("#speedSelect").value) / 1000).toFixed(2)} s`;
    drawCurve();
  }

  function orderedWriteBytes() {
    let groups = state.mapping.mode === "selected" ? [selectedChannel().values.slice()] : state.channels.map(channel => channel.values.slice());
    if (state.mapping.byteOrder === "reverse-channel") groups = groups.map(values => values.reverse());
    let bytes = groups.flat();
    if (state.mapping.byteOrder === "reverse-all") bytes.reverse();
    return Uint8Array.from(bytes);
  }

  function mappingSnapshot() {
    return { format: "bmw-light-channel-mapping", version: 1, block: state.mapping.block, offset: state.mapping.offset, mode: state.mapping.mode, byteOrder: state.mapping.byteOrder, channelBytes: FRAME_COUNT };
  }

  function renderMapping() {
    state.mapping.block = $("#blockSelect").value || state.mapping.block;
    state.mapping.offset = Math.max(0, Number($("#offsetInput").value) || 0);
    state.mapping.mode = $("#writeModeSelect").value;
    state.mapping.byteOrder = $("#byteOrderSelect").value;
    const button = $("#exportBackupButton"), fill = $("#rangeMeterFill"), desc = $("#rangeDescription");
    if (!state.backup || !state.mapping.block || !state.backup.blocks.has(state.mapping.block)) {
      fill.style.width = "0"; fill.classList.remove("error"); desc.textContent = "载入备份后检查写入范围"; renderDiff([]); button.disabled = true; return;
    }
    const block = state.backup.blocks.get(state.mapping.block), bytes = orderedWriteBytes();
    const end = state.mapping.offset + bytes.length, valid = end <= block.length;
    fill.style.width = `${Math.min(100, end / block.length * 100)}%`; fill.classList.toggle("error", !valid);
    desc.textContent = valid ? `块 ${block.address} · 偏移 0x${state.mapping.offset.toString(16).toUpperCase()}–0x${(end - 1).toString(16).toUpperCase()} · ${bytes.length} / ${block.length} bytes` : `超出块范围：需要 ${end} bytes，数据块只有 ${block.length} bytes`;
    const diffs = valid ? [...bytes].flatMap((value, index) => block.bytes[state.mapping.offset + index] === value ? [] : [{ offset: state.mapping.offset + index, old: block.bytes[state.mapping.offset + index], value }]) : [];
    renderDiff(diffs);
    button.disabled = !(valid && diffs.length && $("#riskCheckbox").checked);
  }

  function renderDiff(diffs) {
    $("#diffCount").textContent = `${diffs.length} bytes`; $("#diffCount").className = `badge ${diffs.length ? "ok" : "neutral"}`;
    $("#diffList").innerHTML = diffs.length ? diffs.slice(0, 120).map(diff => `<div class="diff-row"><span>+0x${diff.offset.toString(16).toUpperCase().padStart(4, "0")}</span><span class="old">${hexByte(diff.old)}</span><span>→</span><span class="new">${hexByte(diff.value)}</span></div>`).join("") + (diffs.length > 120 ? `<p class="empty-state">另有 ${diffs.length - 120} 项未展开</p>` : "") : '<p class="empty-state">当前映射没有产生字节变化</p>';
  }

  function renderSummary() {
    const bytes = combinedBytes();
    $("#channelCountStat").textContent = state.channels.length; $("#bytesPerChannelStat").textContent = `${FRAME_COUNT} B`; $("#totalBytesStat").textContent = `${bytes.length} B`; $("#checksumStat").textContent = checksum(bytes); $("#combinedHexOutput").textContent = formatHex(bytes);
  }
  function renderAll() { renderChannelList(); renderEditor(); renderZoneSelectors(); renderPreview(); renderSummary(); renderMapping(); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
  function download(name, contents, type) { const blob = contents instanceof Blob ? contents : new Blob([contents], { type }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const area = document.createElement("textarea"); area.value = text; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); } }

  window.LightStudio = { state, FRAME_COUNT, pattern, resetDemo, renderAll, renderMapping, renderPreview, selectedChannel, orderedWriteBytes, mappingSnapshot, parseHex, formatHex, download, copy, clamp, hexByte };
  resetDemo();
})();
