import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4173;
const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function openBrowser(url) {
  if (process.platform !== "win32") return;

  const child = spawn("cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

if (!existsSync(join(root, "index.html"))) {
  console.error("没有找到构建文件。请先运行 npm run build。\n");
  process.exit(1);
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  let filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const url = `http://${host}:${port}/`;
    console.log(`EFI Forge 已经在运行：${url}`);
    openBrowser(url);
    process.exit(0);
  }

  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  const url = `http://${host}:${port}/`;
  console.log(`\nEFI Forge 已启动：${url}`);
  console.log("关闭这个窗口即可停止。\n");
  openBrowser(url);
});

