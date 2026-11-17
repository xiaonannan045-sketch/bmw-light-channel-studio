(function (root) {
  "use strict";

  class BPlistData {
    constructor(bytes, offset, objectIndex) {
      this.bytes = bytes;
      this.offset = offset;
      this.length = bytes.length;
      this.objectIndex = objectIndex;
    }
  }

  class BPlistUID {
    constructor(value) { this.value = value; }
  }

  class BinaryPlist {
    constructor(input) {
      this.raw = input instanceof Uint8Array ? input : new Uint8Array(input);
      this.view = new DataView(this.raw.buffer, this.raw.byteOffset, this.raw.byteLength);
      this.cache = new Map();
      this.offsets = [];
      this.readTrailer();
    }

    readTrailer() {
      if (this.raw.length < 40 || this.ascii(0, 8) !== "bplist00") throw new Error("不是有效的 Apple binary plist 文件");
      const base = this.raw.length - 32;
      this.offsetSize = this.raw[base + 6];
      this.refSize = this.raw[base + 7];
      this.objectCount = this.safeNumber(this.uint(base + 8, 8), "对象数量");
      this.topObject = this.safeNumber(this.uint(base + 16, 8), "根对象索引");
      this.offsetTableOffset = this.safeNumber(this.uint(base + 24, 8), "偏移表位置");
      if (!this.offsetSize || !this.refSize || this.objectCount > 200000) throw new Error("binary plist trailer 参数异常");
      for (let index = 0; index < this.objectCount; index += 1) {
        const offset = this.safeNumber(this.uint(this.offsetTableOffset + index * this.offsetSize, this.offsetSize), "对象偏移");
        if (offset >= this.raw.length) throw new Error(`对象 ${index} 偏移越界`);
        this.offsets.push(offset);
      }
    }

    uint(offset, length) {
      if (offset < 0 || offset + length > this.raw.length) throw new Error("读取越界");
      let value = 0n;
      for (let index = 0; index < length; index += 1) value = (value << 8n) | BigInt(this.raw[offset + index]);
      return value;
    }

    safeNumber(value, label) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} 超出 JavaScript 安全范围`);
      return Number(value);
    }

    ascii(offset, length) {
      let value = "";
      for (let index = 0; index < length; index += 1) value += String.fromCharCode(this.raw[offset + index]);
      return value;
    }

    lengthInfo(offset, low) {
      if (low !== 0x0f) return { length: low, dataOffset: offset + 1 };
      const marker = this.raw[offset + 1];
      if ((marker >> 4) !== 0x1) throw new Error("扩展长度没有使用整数对象");
      const bytes = 1 << (marker & 0x0f);
      return { length: this.safeNumber(this.uint(offset + 2, bytes), "对象长度"), dataOffset: offset + 2 + bytes };
    }

    reference(offset) { return this.safeNumber(this.uint(offset, this.refSize), "对象引用"); }

    parse() { return this.object(this.topObject); }

    object(index) {
      if (index < 0 || index >= this.objectCount) throw new Error(`对象引用 ${index} 越界`);
      if (this.cache.has(index)) return this.cache.get(index);
      const offset = this.offsets[index];
      const marker = this.raw[offset];
      const type = marker >> 4;
      const low = marker & 0x0f;
      let value;

      if (type === 0x0) {
        if (low === 0x0 || low === 0x0f) value = null;
        else if (low === 0x8) value = false;
        else if (low === 0x9) value = true;
        else throw new Error(`不支持的 simple marker 0x${marker.toString(16)}`);
      } else if (type === 0x1) {
        const bytes = 1 << low;
        const unsigned = this.uint(offset + 1, bytes);
        value = unsigned <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(unsigned) : unsigned;
      } else if (type === 0x2) {
        const bytes = 1 << low;
        if (bytes === 4) value = this.view.getFloat32(offset + 1, false);
        else if (bytes === 8) value = this.view.getFloat64(offset + 1, false);
        else throw new Error(`不支持 ${bytes} 字节浮点数`);
      } else if (type === 0x3) {
        if (low !== 0x3) throw new Error("日期对象格式异常");
        value = new Date((this.view.getFloat64(offset + 1, false) + 978307200) * 1000);
      } else if (type === 0x4) {
        const info = this.lengthInfo(offset, low);
        value = new BPlistData(this.raw.slice(info.dataOffset, info.dataOffset + info.length), info.dataOffset, index);
      } else if (type === 0x5) {
        const info = this.lengthInfo(offset, low);
        value = this.ascii(info.dataOffset, info.length);
      } else if (type === 0x6) {
        const info = this.lengthInfo(offset, low);
        const units = new Uint16Array(info.length);
        for (let unit = 0; unit < info.length; unit += 1) units[unit] = Number(this.uint(info.dataOffset + unit * 2, 2));
        value = String.fromCharCode(...units);
      } else if (type === 0x8) {
        value = new BPlistUID(this.safeNumber(this.uint(offset + 1, low + 1), "UID"));
      } else if (type === 0xa || type === 0xb || type === 0xc) {
        const info = this.lengthInfo(offset, low);
        value = [];
        this.cache.set(index, value);
        for (let item = 0; item < info.length; item += 1) value.push(this.object(this.reference(info.dataOffset + item * this.refSize)));
      } else if (type === 0xd) {
        const info = this.lengthInfo(offset, low);
        value = {};
        this.cache.set(index, value);
        const valuesOffset = info.dataOffset + info.length * this.refSize;
        for (let item = 0; item < info.length; item += 1) {
          const key = this.object(this.reference(info.dataOffset + item * this.refSize));
          value[String(key)] = this.object(this.reference(valuesOffset + item * this.refSize));
        }
      } else {
        throw new Error(`不支持的 binary plist marker 0x${marker.toString(16).padStart(2, "0")}`);
      }

      this.cache.set(index, value);
      return value;
    }
  }

  function uidValue(value) {
    if (value instanceof BPlistUID) return value.value;
    if (value && typeof value === "object" && Number.isInteger(value.value)) return value.value;
    throw new Error("NSKeyedArchiver UID 格式异常");
  }

  function parseBimmerCode(input, filename) {
    const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
    const parser = new BinaryPlist(raw);
    const archive = parser.parse();
    if (!archive || !Array.isArray(archive.$objects) || !archive.$top) throw new Error("不是 NSKeyedArchiver 备份");
    const objects = archive.$objects;
    const deref = value => value instanceof BPlistUID ? objects[uidValue(value)] : value;
    const text = value => {
      const result = deref(value);
      return result === null || result === undefined ? "" : String(result);
    };
    const rootObject = deref(archive.$top.root);
    if (!rootObject || !rootObject.codingECU || !rootObject.codingData) throw new Error("未找到 BimmerCode CodingSession");
    const ecu = deref(rootObject.codingECU);
    const codingData = deref(rootObject.codingData);
    const identifier = text(codingData.CAFDIdentifier).toUpperCase();
    const blocksObject = deref(codingData.mutableCodingDataBlocks);
    const blockRefs = blocksObject && Array.isArray(blocksObject["NS.objects"]) ? blocksObject["NS.objects"] : [];
    const blocks = new Map();

    for (const blockRef of blockRefs) {
      const block = deref(blockRef);
      if (!block || block.blockAddress === undefined || !block.data) continue;
      const data = deref(block.data);
      if (!(data instanceof BPlistData)) continue;
      const numericAddress = typeof block.blockAddress === "bigint" ? Number(block.blockAddress) : Number(block.blockAddress);
      const address = numericAddress.toString(16).toUpperCase().padStart(4, "0");
      blocks.set(address, { address, objectIndex: data.objectIndex, fileOffset: data.offset, length: data.length, bytes: data.bytes.slice() });
    }
    if (!blocks.size) throw new Error("备份中没有找到 mutableCodingDataBlocks");

    const cafd = identifier.slice(0, 8) || "UNKNOWN";
    const versions = identifier.length >= 14 ? [identifier.slice(8, 10), identifier.slice(10, 12), identifier.slice(12, 14)].map(part => parseInt(part, 16)) : [];
    const version = versions.length === 3 && versions.every(Number.isFinite) ? versions.map(value => String(value).padStart(3, "0")).join("_") : "未知";
    return {
      raw,
      filename: filename || "backup.cod",
      archive,
      vin: text(rootObject.VIN) || "未知",
      ecuId: text(ecu.identifier) || "未知",
      diagnosticAddress: Number(ecu.address || 0),
      cafd,
      version,
      identifier,
      blocks
    };
  }

  function patchBimmerCode(cod, address, blockOffset, replacement) {
    if (!cod || !cod.blocks) throw new Error("请先载入备份");
    const key = String(address || "").toUpperCase().padStart(4, "0");
    const block = cod.blocks.get(key);
    if (!block) throw new Error(`备份中不存在数据块 ${key}`);
    const offset = Number(blockOffset);
    const bytes = replacement instanceof Uint8Array ? replacement : new Uint8Array(replacement);
    if (!Number.isInteger(offset) || offset < 0 || offset + bytes.length > block.length) throw new Error(`写入范围 0x${offset.toString(16)} + ${bytes.length} B 超出块 ${key} (${block.length} B)`);

    const output = cod.raw.slice();
    output.set(bytes, block.fileOffset + offset);
    const reparsed = parseBimmerCode(output, cod.filename);
    const verified = reparsed.blocks.get(key);
    if (!verified) throw new Error("导出校验失败：新备份缺少目标块");
    for (let index = 0; index < bytes.length; index += 1) {
      if (verified.bytes[offset + index] !== bytes[index]) throw new Error(`导出校验失败：第 ${index} 个字节不一致`);
    }
    for (let index = 0; index < output.length; index += 1) {
      const inPatch = index >= block.fileOffset + offset && index < block.fileOffset + offset + bytes.length;
      if (!inPatch && output[index] !== cod.raw[index]) throw new Error("导出校验失败：目标范围以外的数据发生变化");
    }
    return output;
  }

  function outputFilename(cod) {
    const now = Math.floor(Date.now() / 1000);
    const safe = value => String(value || "").replace(/[^0-9A-Z_-]/gi, "");
    if (safe(cod.ecuId) && /^[A-Z0-9]{17}$/i.test(cod.vin)) return `${safe(cod.ecuId)}-${safe(cod.vin)}-${now}.cod`;
    return String(cod.filename || "backup.cod").replace(/\.cod$/i, "") + `-lightstudio-${now}.cod`;
  }

  const api = { BinaryPlist, BPlistData, BPlistUID, parseBimmerCode, patchBimmerCode, outputFilename };
  root.BMWBPlist = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
