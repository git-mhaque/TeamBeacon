import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../mcp-build/", import.meta.url);
const target = new URL("../../services/mcp/ui/", import.meta.url);
const script = (await readFile(new URL("dashboard.js", source), "utf8")).replaceAll("</script", "<\\/script");
const styles = await Promise.all((await readdir(source)).filter((name) => name.endsWith(".css"))
  .map((name) => readFile(new URL(name, source), "utf8")));
await mkdir(target, { recursive: true });
await writeFile(new URL("dashboard.html", target), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TeamBeacon dashboard</title><style>${styles.join("\n")}</style></head>
<body><div id="root"></div><script>${script}</script></body></html>`);
process.stdout.write(`Built ${fileURLToPath(new URL("dashboard.html", target))}\n`);
