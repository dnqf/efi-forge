import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDalianskyCatalog } from "./import-daliansky-catalog.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const markdown = `
更新日期：2026年8月27日

### Lenovo 联想
| 机型名称 | 发布地址 | 教程 | 备注 |
| --- | --- | --- | --- |
| ThinkPad T480 | [EFI](https://github.com/example/t480-efi/tree/main/EFI?download=1#top) | [README](https://github.com/example/t480-efi/blob/main/README.md?plain=1#usage) | i5-8350U；请运行 setup.exe；UHD 620 |
| ThinkPad Unsafe | [EFI](https://github.com/example/ThinkPad-DONT-USE-THIS) | | |

## 台式机
## AMD Ryzen
| 机型名称 | 发布地址 | 教程 | 备注 |
| --- | --- | --- | --- |
| ASUS B450M | [EFI](https://github.com/example/b450-efi) | 购买：https://shop.example.com | Ryzen 5 3600 / RX 580 |
| Gigabyte H110M-H | [EFI](https://github.com/suggested-username/EFI-H110M) | | |
| RedmiBook Placeholder | [EFI](https://github.com/example/-) | | |
`;

test("catalog import is deterministic and keeps only normalized discovery facts", () => {
  const first = parseDalianskyCatalog(markdown, revision);
  const second = parseDalianskyCatalog(markdown, revision);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.source.licenseStatus, "not-declared");
  assert.equal(first.source.trust, "discovery-only");
  assert.deepEqual(first.entries[0].repositories, ["https://github.com/example/b450-efi"]);
  assert.deepEqual(first.entries[1].repositories, ["https://github.com/example/t480-efi"]);
  assert.deepEqual(first.entries[1].guides, ["https://github.com/example/t480-efi/blob/main/README.md"]);
  assert.match(first.entries[1].note, /i5-8350U/i);
  assert.match(first.entries[1].note, /UHD 620/i);
  assert.doesNotMatch(first.entries[1].note, /setup|\.exe/i);
  assert.equal(first.stats.laptopEntries, 1);
  assert.equal(first.stats.desktopEntries, 1);
  assert.equal(first.entries.some((entry) => /DONT.?USE/i.test(entry.model)), false);
  assert.equal(first.entries.flatMap((entry) => entry.repositories).some((url) => url.includes("suggested-username")), false);
  assert.equal(first.entries.flatMap((entry) => entry.repositories).some((url) => url.endsWith("/-")), false);
});

test("catalog import rejects a non-commit revision", () => {
  assert.throws(() => parseDalianskyCatalog(markdown, "main"), /40 位 Git commit/);
});

test("committed discovery snapshot contains only displayable repository roots", () => {
  const snapshot = JSON.parse(readFileSync(
    new URL("../src/data/dalianskyCatalog.snapshot.json", import.meta.url),
    "utf8",
  ));
  const ids = new Set();
  const repositories = new Set();

  for (const entry of snapshot.entries) {
    assert.equal(ids.has(entry.id), false, `duplicate id: ${entry.id}`);
    ids.add(entry.id);
    assert.doesNotMatch(`${entry.model} ${entry.note}`, /(?:DONT|DO[\s_-]*NOT)[\s_-]*USE/i);
    assert.ok(entry.repositories.length > 0, `entry without repository: ${entry.id}`);
    for (const repository of entry.repositories) {
      assert.match(repository, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.+-]+$/);
      assert.doesNotMatch(repository, /\/suggested-username\//i);
      assert.doesNotMatch(repository, /(?:DONT|DO[\s_-]*NOT)[\s_-]*USE/i);
      assert.equal(repository.endsWith("/-"), false);
      repositories.add(repository);
    }
  }

  assert.equal(snapshot.stats.entries, snapshot.entries.length);
  assert.equal(
    snapshot.stats.laptopEntries,
    snapshot.entries.filter((entry) => entry.formFactor === "laptop").length,
  );
  assert.equal(
    snapshot.stats.desktopEntries,
    snapshot.entries.filter((entry) => entry.formFactor === "desktop").length,
  );
  assert.equal(snapshot.stats.repositories, repositories.size);
});
