import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/daliansky/Hackintosh";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

function plainText(value) {
  return value
    .replace(/<br\s*\/?\s*>/gi, " / ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function githubUrls(value) {
  const matches = value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.%+-]+(?:\/[^\s)<]*)?/g) ?? [];
  return [...new Set(matches.map((url) => {
    const parsed = new URL(url.replace(/[.,;]+$/, ""));
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  }))];
}

function repositoryRoot(url) {
  const parsed = new URL(url);
  const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repository) return null;
  const cleanRepository = decodeURIComponent(repository).replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.+-]+$/.test(cleanRepository)) {
    return null;
  }
  return `https://github.com/${owner}/${cleanRepository}`;
}

function hasExplicitRejectionSignal(value) {
  return /(?:DONT|DO[\s_-]*NOT)[\s_-]*USE(?:[\s_-]*THIS)?/i.test(value);
}

function isUsableRepository(url) {
  const parsed = new URL(url);
  const [owner = "", repository = ""] = parsed.pathname.split("/").filter(Boolean);
  return owner.toLowerCase() !== "suggested-username"
    && repository !== "-"
    && !hasExplicitRejectionSignal(`${owner}/${repository}`);
}

function bootloaderHint(text) {
  const hasOpenCore = /open\s*core|\boc\b/i.test(text);
  const hasClover = /clover/i.test(text);
  if (hasOpenCore && hasClover) return "mixed";
  if (hasOpenCore) return "opencore";
  if (hasClover) return "clover";
  return "unknown";
}

function factualNote(value) {
  const text = plainText(value);
  const patterns = [
    /\b(?:Intel\s+)?Core\s+i[3579][\s-]?\d{4,5}[A-Z]{0,3}\b/gi,
    /\bi[3579]-\d{4,5}[A-Z]{0,3}\b/gi,
    /\bRyzen\s+[3579]\s+\d{4}[A-Z]{0,3}\b/gi,
    /\bXeon\s+[A-Z0-9-]{3,}\b/gi,
    /\b(?:Radeon\s+)?RX\s*\d{3,4}\s*(?:XT)?\b/gi,
    /\b(?:GTX|RTX)\s*\d{3,4}(?:\s*(?:Ti|Super))?\b/gi,
    /\b(?:UHD|HD|Iris)\s*(?:Graphics\s*)?\d{3,4}\b/gi,
    /\b(?:ALC|DW|BCM)[-_]?[A-Z0-9]{3,}\b/gi,
  ];
  const facts = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const fact = match[0].replace(/\s+/g, " ").trim();
      const key = fact.toUpperCase();
      if (!seen.has(key)) {
        seen.add(key);
        facts.push(fact);
      }
    }
  }
  return facts.join(" / ").slice(0, 120);
}

function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54) || "model";
}

function isTableSeparator(value) {
  return /^:?-{3,}:?$/.test(value.replace(/\s+/g, ""));
}

export function parseDalianskyCatalog(markdown, revision) {
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("revision 必须是 40 位 Git commit 哈希。");
  }

  let formFactor = "laptop";
  let section = "未分类";
  let upstreamUpdated = "unknown";
  const rawEntries = [];

  for (const line of markdown.split(/\r?\n/)) {
    const updated = line.match(/更新日期[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (updated) {
      upstreamUpdated = `${updated[1]}-${updated[2].padStart(2, "0")}-${updated[3].padStart(2, "0")}`;
    }

    if (/^##\s+台式机\s*$/.test(line)) {
      formFactor = "desktop";
      section = "AMD Ryzen";
      continue;
    }
    const sectionMatch = line.match(/^###\s+(.+?)\s*$/);
    if (sectionMatch) {
      section = plainText(sectionMatch[1]);
      continue;
    }
    if (formFactor === "desktop") {
      const desktopGroup = line.match(/^##\s+(AMD Ryzen)\s*$/);
      if (desktopGroup) section = desktopGroup[1];
    }

    if (!line.trim().startsWith("|") || !line.trim().endsWith("|")) continue;
    const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 2 || cells.every(isTableSeparator)) continue;

    const model = plainText(cells[0]);
    if (!model || /机型名称|笔记本|台式|发布地址|^-+$/.test(model)) continue;
    if (hasExplicitRejectionSignal(model)) continue;

    const releaseCell = cells[1] ?? "";
    const guideCell = cells[2] ?? "";
    const remaining = cells.slice(3).join(" / ");
    const repositories = githubUrls(releaseCell)
      .map(repositoryRoot)
      .filter((url) => url !== null && isUsableRepository(url));
    if (repositories.length === 0) continue;

    const guides = githubUrls(guideCell).filter((url) => repositoryRoot(url) !== url);
    const combined = `${model} ${releaseCell} ${guideCell} ${remaining}`;
    rawEntries.push({
      formFactor,
      section,
      model,
      repositories: [...new Set(repositories)],
      guides: [...new Set(guides)],
      // Upstream does not declare a repository license. Extract a small set of
      // factual hardware tokens instead of copying compatibility prose.
      note: factualNote(remaining),
      bootloaderHint: bootloaderHint(combined),
    });
  }

  const merged = new Map();
  for (const entry of rawEntries) {
    const key = `${entry.formFactor}|${entry.section.toLowerCase()}|${entry.model.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }
    existing.repositories = [...new Set([...existing.repositories, ...entry.repositories])];
    existing.guides = [...new Set([...existing.guides, ...entry.guides])];
    if (!existing.note && entry.note) existing.note = entry.note;
    if (existing.bootloaderHint !== entry.bootloaderHint) existing.bootloaderHint = "mixed";
  }

  const sorted = [...merged.values()].sort(
    (left, right) =>
      left.formFactor.localeCompare(right.formFactor) ||
      left.section.localeCompare(right.section, "zh-CN") ||
      left.model.localeCompare(right.model, "zh-CN"),
  );
  const slugCounts = new Map();
  const entries = sorted.map((entry) => {
    const base = `${entry.formFactor}-${slug(entry.section)}-${slug(entry.model)}`;
    const count = (slugCounts.get(base) ?? 0) + 1;
    slugCounts.set(base, count);
    return {
      id: count === 1 ? base : `${base}-${count}`,
      ...entry,
      repositories: [...entry.repositories].sort(),
      guides: [...entry.guides].sort(),
    };
  });

  return {
    schemaVersion: 1,
    source: {
      repository: SOURCE_REPOSITORY,
      revision: revision.toLowerCase(),
      sourceFile: "README.md",
      upstreamUpdated,
      licenseStatus: "not-declared",
      trust: "discovery-only",
    },
    stats: {
      entries: entries.length,
      laptopEntries: entries.filter((entry) => entry.formFactor === "laptop").length,
      desktopEntries: entries.filter((entry) => entry.formFactor === "desktop").length,
      repositories: new Set(entries.flatMap((entry) => entry.repositories)).size,
    },
    entries,
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourcePath = resolve(requireArgument("--source"));
  const outputPath = resolve(requireArgument("--output"));
  const revision = requireArgument("--revision");
  const catalog = parseDalianskyCatalog(readFileSync(sourcePath, "utf8"), revision);
  const serialized = serialize(catalog);

  if (process.argv.includes("--check")) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== serialized) throw new Error("目录快照与指定来源不一致，请重新生成。 ");
    process.stdout.write(`${JSON.stringify(catalog.stats)}\n`);
  } else {
    writeFileSync(outputPath, serialized, "utf8");
    process.stdout.write(`${JSON.stringify(catalog.stats)}\n`);
  }
}
