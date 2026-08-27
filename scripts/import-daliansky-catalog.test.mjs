import assert from "node:assert/strict";
import test from "node:test";
import { parseDalianskyCatalog } from "./import-daliansky-catalog.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const markdown = `
更新日期：2026年8月27日

### Lenovo 联想
| 机型名称 | 发布地址 | 教程 | 备注 |
| --- | --- | --- | --- |
| ThinkPad T480 | [EFI](https://github.com/example/t480-efi/tree/main/EFI?download=1#top) | [README](https://github.com/example/t480-efi/blob/main/README.md?plain=1#usage) | i5-8350U；请运行 setup.exe；UHD 620 |

## 台式机
## AMD Ryzen
| 机型名称 | 发布地址 | 教程 | 备注 |
| --- | --- | --- | --- |
| ASUS B450M | [EFI](https://github.com/example/b450-efi) | 购买：https://shop.example.com | Ryzen 5 3600 / RX 580 |
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
});

test("catalog import rejects a non-commit revision", () => {
  assert.throws(() => parseDalianskyCatalog(markdown, "main"), /40 位 Git commit/);
});
