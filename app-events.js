(function () {
  "use strict";
  const studio = window.LightStudio, state = studio.state;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function applyCurrentPreset() {
    const type = $("#presetSelect").value;
    if (type === "video-welcome") {
      state.channels.slice(0, 4).forEach((channel, index) => { channel.values = studio.pattern(type, index); });
      state.previewMap = { drl: 0, low: 1, high: 2, accent: 3 };
      state.previewTheme = type; state.frame = 0; $("#speedSelect").value = "120";
      studio.renderAll();
      return;
    }
    state.previewTheme = "";
    studio.selectedChannel().values = studio.pattern(type, state.selected);
    studio.renderAll();
  }

  function validateHex() {
    const badge = $("#hexValidation");
    try {
      const bytes = studio.parseHex($("#hexInput").value);
      const valid = bytes.length === studio.FRAME_COUNT;
      badge.textContent = `${bytes.length} / ${studio.FRAME_COUNT} bytes`;
      badge.className = `validation ${valid ? "ok" : "error"}`;
      return valid ? bytes : null;
    } catch (error) {
      badge.textContent = error.message; badge.className = "validation error"; return null;
    }
  }

  function stopPlayback() {
    state.playing = false; clearInterval(state.timer); state.timer = null; $("#playButton").textContent = "▶";
  }

  function startPlayback() {
    stopPlayback(); state.playing = true; $("#playButton").textContent = "❚❚";
    state.timer = setInterval(() => {
      if (state.frame >= studio.FRAME_COUNT - 1) {
        if (!$("#loopCheckbox").checked) { stopPlayback(); return; }
        state.frame = 0;
      } else state.frame += 1;
      studio.renderPreview();
    }, Number($("#speedSelect").value));
  }

  function projectPayload() {
    return { format: "bmw-light-channel-studio", version: 1, frames: studio.FRAME_COUNT, channels: state.channels, previewMap: state.previewMap, previewTheme: state.previewTheme, mapping: studio.mappingSnapshot(), exportedAt: new Date().toISOString() };
  }

  async function readJsonFile(file) {
    try { return JSON.parse(await file.text()); } catch { throw new Error("JSON 文件无法解析"); }
  }

  async function importProject(file) {
    const data = await readJsonFile(file);
    if (data.format !== "bmw-light-channel-studio" || !Array.isArray(data.channels)) throw new Error("不是 Light Channel Studio 工程文件");
    const channels = data.channels.map((channel, index) => ({ id: channel.id || `import-${Date.now()}-${index}`, name: String(channel.name || `Channel ${index + 1}`), color: channel.color || `hsl(${index * 47 % 360} 85% 65%)`, values: Array.from(channel.values || []).slice(0, studio.FRAME_COUNT).map(studio.clamp) }));
    if (!channels.length || channels.some(channel => channel.values.length !== studio.FRAME_COUNT)) throw new Error(`每个 Channel 必须正好包含 ${studio.FRAME_COUNT} bytes`);
    state.channels = channels; state.selected = 0; state.previewMap = data.previewMap || state.previewMap; state.previewTheme = data.previewTheme === "video-welcome" ? data.previewTheme : "";
    if (data.mapping) setMapping(data.mapping);
    studio.renderAll();
  }

  function setMapping(mapping) {
    if (mapping.block) state.mapping.block = String(mapping.block).toUpperCase().padStart(4, "0");
    state.mapping.offset = Math.max(0, Number(mapping.offset) || 0);
    state.mapping.mode = mapping.mode === "selected" ? "selected" : "all";
    state.mapping.byteOrder = ["normal", "reverse-channel", "reverse-all"].includes(mapping.byteOrder) ? mapping.byteOrder : "normal";
    $("#offsetInput").value = state.mapping.offset; $("#writeModeSelect").value = state.mapping.mode; $("#byteOrderSelect").value = state.mapping.byteOrder;
    if ([...$("#blockSelect").options].some(option => option.value === state.mapping.block)) $("#blockSelect").value = state.mapping.block;
  }

  async function loadBackup(file) {
    const badge = $("#backupStatusBadge"), message = $("#exportMessage");
    badge.textContent = "解析中"; badge.className = "badge neutral"; message.textContent = "";
    try {
      const cod = BMWBPlist.parseBimmerCode(new Uint8Array(await file.arrayBuffer()), file.name);
      state.backup = cod;
      $("#backupInfo").classList.remove("hidden"); $("#backupFilename").textContent = cod.filename; $("#backupVin").textContent = cod.vin; $("#backupEcu").textContent = `${cod.ecuId} · 0x${cod.diagnosticAddress.toString(16).toUpperCase()}`; $("#backupCafd").textContent = `${cod.cafd}_${cod.version}`; $("#backupBlocks").textContent = `${cod.blocks.size} 个 · ${[...cod.blocks.values()].reduce((sum, block) => sum + block.length, 0)} bytes`;
      $("#blockSelect").innerHTML = [...cod.blocks.values()].sort((a, b) => a.address.localeCompare(b.address)).map(block => `<option value="${block.address}">${block.address} · ${block.length} bytes</option>`).join("");
      if (!cod.blocks.has(state.mapping.block)) state.mapping.block = $("#blockSelect").value;
      $("#blockSelect").value = state.mapping.block;
      badge.textContent = "已载入"; badge.className = "badge ok"; studio.renderMapping();
    } catch (error) {
      state.backup = null; badge.textContent = "解析失败"; badge.className = "badge error"; message.textContent = error.message; $("#backupInfo").classList.add("hidden"); $("#blockSelect").innerHTML = '<option value="">无法读取备份</option>'; studio.renderMapping();
    }
  }

  function exportBackup() {
    try {
      const bytes = studio.orderedWriteBytes();
      const output = BMWBPlist.patchBimmerCode(state.backup, state.mapping.block, state.mapping.offset, bytes);
      const name = BMWBPlist.outputFilename(state.backup);
      studio.download(name, output, "application/octet-stream");
      $("#exportMessage").textContent = `已生成 ${name}，原备份未修改。`;
    } catch (error) { $("#exportMessage").textContent = error.message; }
  }

  function bindCurve() {
    const canvas = $("#curveCanvas"); let dragging = false;
    const update = event => {
      const rect = canvas.getBoundingClientRect(), left = 28, right = 16, top = 15, bottom = 23;
      const x = Math.max(left, Math.min(rect.width - right, event.clientX - rect.left));
      const y = Math.max(top, Math.min(rect.height - bottom, event.clientY - rect.top));
      const index = Math.max(0, Math.min(studio.FRAME_COUNT - 1, Math.round((x - left) / (rect.width - left - right) * (studio.FRAME_COUNT - 1))));
      const value = studio.clamp((1 - (y - top) / (rect.height - top - bottom)) * 255);
      const channel = studio.selectedChannel(), smooth = Number($("#smoothRange").value) / 100;
      channel.values[index] = value;
      if (smooth > .1) { if (index > 0) channel.values[index - 1] = studio.clamp(channel.values[index - 1] * (1 - smooth * .25) + value * smooth * .25); if (index < studio.FRAME_COUNT - 1) channel.values[index + 1] = studio.clamp(channel.values[index + 1] * (1 - smooth * .25) + value * smooth * .25); }
      state.frame = index; studio.renderAll();
    };
    canvas.addEventListener("pointerdown", event => { dragging = true; canvas.setPointerCapture(event.pointerId); update(event); });
    canvas.addEventListener("pointermove", event => { if (dragging) update(event); });
    canvas.addEventListener("pointerup", () => { dragging = false; }); canvas.addEventListener("pointercancel", () => { dragging = false; });
  }

  $("#applyPresetButton").addEventListener("click", applyCurrentPreset);
  $("#loadDemoButton").addEventListener("click", studio.resetDemo);
  $("#mirrorButton").addEventListener("click", () => { studio.selectedChannel().values.reverse(); studio.renderAll(); });
  $("#normalizeButton").addEventListener("click", () => { const values = studio.selectedChannel().values, max = Math.max(...values); if (max) studio.selectedChannel().values = values.map(value => studio.clamp(value / max * 255)); studio.renderAll(); });
  $("#invertButton").addEventListener("click", () => { studio.selectedChannel().values = studio.selectedChannel().values.map(value => 255 - value); studio.renderAll(); });
  $("#addChannelButton").addEventListener("click", () => { if (state.channels.length >= 24) return; const index = state.channels.length; state.channels.push({ id: `ch-${Date.now()}`, name: `Channel ${String(index + 1).padStart(2, "0")}`, color: `hsl(${index * 47 % 360} 85% 65%)`, values: Array(studio.FRAME_COUNT).fill(0) }); state.selected = index; studio.renderAll(); });
  $("#channelNameInput").addEventListener("input", event => { studio.selectedChannel().name = event.target.value || `Channel ${state.selected + 1}`; studio.renderAll(); });
  $("#hexInput").addEventListener("input", validateHex);
  $("#applyHexButton").addEventListener("click", () => { const bytes = validateHex(); if (bytes) { studio.selectedChannel().values = bytes; studio.renderAll(); } });
  $("#copyHexButton").addEventListener("click", () => studio.copy($("#hexInput").value));
  $("#copyCombinedButton").addEventListener("click", () => studio.copy($("#combinedHexOutput").textContent));
  $("#playButton").addEventListener("click", () => state.playing ? stopPlayback() : startPlayback());
  $("#speedSelect").addEventListener("change", () => { if (state.playing) startPlayback(); else studio.renderPreview(); });
  $("#timelineRange").addEventListener("input", event => { state.frame = Number(event.target.value); studio.renderPreview(); });
  $$("[data-view]").forEach(button => button.addEventListener("click", () => { $$("[data-view]").forEach(item => item.classList.toggle("active", item === button)); $("#previewStage").classList.toggle("road-view", button.dataset.view === "road"); }));
  $("#exportProjectButton").addEventListener("click", () => studio.download(`bmw-light-project-${Date.now()}.json`, JSON.stringify(projectPayload(), null, 2), "application/json"));
  $("#projectFileInput").addEventListener("change", async event => { if (event.target.files[0]) try { await importProject(event.target.files[0]); } catch (error) { alert(error.message); } event.target.value = ""; });

  $("#backupFileInput").addEventListener("change", event => { if (event.target.files[0]) loadBackup(event.target.files[0]); event.target.value = ""; });
  const dropZone = $("#dropZone");
  ["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove("dragover"); }));
  dropZone.addEventListener("drop", event => { const file = event.dataTransfer.files[0]; if (file) loadBackup(file); });
  ["#blockSelect", "#offsetInput", "#writeModeSelect", "#byteOrderSelect"].forEach(selector => $(selector).addEventListener("input", studio.renderMapping));
  $("#riskCheckbox").addEventListener("change", studio.renderMapping);
  $("#exportBackupButton").addEventListener("click", exportBackup);
  $("#saveMappingButton").addEventListener("click", () => studio.download(`channel-mapping-${Date.now()}.json`, JSON.stringify(studio.mappingSnapshot(), null, 2), "application/json"));
  $("#mappingFileInput").addEventListener("change", async event => { const file = event.target.files[0]; if (file) try { const mapping = await readJsonFile(file); if (mapping.format !== "bmw-light-channel-mapping") throw new Error("不是 Channel 映射文件"); setMapping(mapping); studio.renderMapping(); } catch (error) { alert(error.message); } event.target.value = ""; });
  window.addEventListener("resize", () => studio.renderPreview());
  bindCurve(); studio.renderAll();
})();
