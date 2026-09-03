import { describe, expect, it } from "vitest";
import { sha256Text } from "./sha256";

describe("sha256Text", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
  ])("hashes the standard vector %j", (source, digest) => {
    expect(sha256Text(source)).toBe(digest);
  });

  it("hashes UTF-8 input deterministically", () => {
    expect(sha256Text("EFI Forge 硬件指纹")).toBe(
      "6b9e50ff6e0ab00454c8d4a1ea9b22924a9b59143051a6524af4ccc8e769d6db",
    );
  });
});
