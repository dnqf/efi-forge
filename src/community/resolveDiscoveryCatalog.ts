import type {
  CommunityDiscoveryCatalog,
  CommunityDiscoveryMatch,
  HardwareReport,
} from "../domain/types";

const STOP_WORDS = new Set([
  "ACPI",
  "AMD",
  "APPLE",
  "BOOT",
  "CLOVER",
  "COMPUTER",
  "DESKTOP",
  "EFI",
  "GEN",
  "GENERATION",
  "HACKINTOSH",
  "INTEL",
  "LAPTOP",
  "LENOVO",
  "MACOS",
  "MODEL",
  "NOTEBOOK",
  "OPENCORE",
  "PC",
  "SERIES",
  "THINKPAD",
  "系列",
]);

const VENDOR_ALIASES: Record<string, string[]> = {
  ACER: ["ACER", "宏碁"],
  ASUS: ["ASUS", "ASUSTEK", "华硕"],
  ASROCK: ["ASROCK", "华擎"],
  DELL: ["DELL", "戴尔"],
  GIGABYTE: ["GIGABYTE", "技嘉"],
  HP: ["HEWLETT", "HP", "惠普"],
  HUAWEI: ["HUAWEI", "华为"],
  LENOVO: ["LENOVO", "THINKPAD", "联想"],
  MSI: ["MICRO-STAR", "MSI", "微星"],
  INTEL: ["INTEL"],
  SAMSUNG: ["SAMSUNG", "三星"],
  XIAOMI: ["MI NOTEBOOK", "XIAOMI", "小米"],
};

function normalized(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function tokens(value: string): string[] {
  return [...new Set(normalized(value).split(/\s+/).filter((token) => {
    if (!token || STOP_WORDS.has(token)) return false;
    return /\d/.test(token) || token.length >= 4;
  }))];
}

function vendorKeys(value: string): string[] {
  const source = normalized(value);
  return Object.entries(VENDOR_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => source.includes(normalized(alias))))
    .map(([key]) => key);
}

function distinctiveOverlap(hardwareTokens: string[], entryTokens: string[]): string[] {
  const hardwareSet = new Set(hardwareTokens);
  return entryTokens.filter((token) => hardwareSet.has(token));
}

function modelSignature(value: string): string {
  const vendorWords = new Set(Object.values(VENDOR_ALIASES).flat().map(normalized));
  return normalized(value)
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token) && !vendorWords.has(token))
    .join("");
}

export function resolveDiscoveryCatalog(
  hardware: HardwareReport,
  catalog: CommunityDiscoveryCatalog,
  limit = 5,
): CommunityDiscoveryMatch[] {
  const primaryModel = hardware.system.productName || hardware.board.model;
  const identity = [
    hardware.system.productName,
    hardware.system.machineType,
    hardware.board.model,
  ].filter(Boolean).join(" ");
  const hardwareTokens = tokens(identity);
  if (hardwareTokens.length === 0 || limit <= 0) return [];

  const hardwareVendors = vendorKeys([
    hardware.system.manufacturer,
    hardware.board.vendor,
    hardware.system.productName,
  ].filter(Boolean).join(" "));

  return catalog.entries
    .flatMap((entry): CommunityDiscoveryMatch[] => {
      if (entry.formFactor !== hardware.system.kind) return [];

      const entryTokens = tokens(`${entry.model} ${entry.note}`);
      const overlap = distinctiveOverlap(hardwareTokens, entryTokens);
      if (!overlap.some((token) => /\d/.test(token))) return [];

      const entryVendors = vendorKeys(`${entry.section} ${entry.model}`);
      const vendorMatched = hardwareVendors.length > 0
        && entryVendors.some((vendor) => hardwareVendors.includes(vendor));
      const vendorConflict = hardwareVendors.length > 0
        && entryVendors.length > 0
        && !vendorMatched;
      if (vendorConflict) return [];

      const exactModel = modelSignature(primaryModel) !== ""
        && modelSignature(primaryModel) === modelSignature(entry.model);
      const score = 20 + overlap.length * 24 + (vendorMatched ? 24 : 0) + (exactModel ? 40 : 0);
      const confidence = vendorMatched && exactModel
        ? "strong-clue"
        : "possible-clue";
      const reasons = [
        `机型关键词命中：${overlap.slice(0, 3).join(" / ")}`,
        vendorMatched ? "厂商线索一致" : "上游条目未提供可确认的厂商线索",
        "来源未经 EFI Forge 实机审计，仅供人工研究",
      ];

      return [{ entry, confidence, score, reasons }];
    })
    .sort((left, right) => right.score - left.score || left.entry.model.localeCompare(right.entry.model, "zh-CN"))
    .slice(0, limit);
}
