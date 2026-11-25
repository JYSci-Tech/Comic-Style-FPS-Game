import { copyFile, cp, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const project = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const output = join(project, "pages-dist");
const existing = await lstat(output).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
if (existing) {
  const actual = await realpath(output);
  if (!existing.isDirectory() || existing.isSymbolicLink() || actual !== output || dirname(actual) !== project) {
    throw new Error("The Pages output directory must be a real folder inside the project.");
  }
  await rm(output, { recursive: true });
}
await mkdir(join(output, "vendor"), { recursive: true });

const html = await readFile(join(project, "index.html"), "utf8");
const sourceThree = "./node_modules/three/build/three.module.js";
if (!html.includes(sourceThree) || !html.includes('<html lang="zh-CN">')) {
  throw new Error("The game entry point changed. Update the Pages build paths.");
}
const builtHtml = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-hosting="pages">')
  .replace(sourceThree, "./vendor/three.module.js");
await writeFile(join(output, "index.html"), builtHtml);
for (const file of ["style.css", "mobile.css", "manifest.webmanifest"]) {
  await copyFile(join(project, file), join(output, file));
}
for (const folder of ["js", "assets"]) {
  await cp(join(project, folder), join(output, folder), { recursive: true });
}
await copyFile(join(project, "node_modules/three/build/three.module.min.js"), join(output, "vendor/three.module.js"));
await copyFile(join(project, "node_modules/three/LICENSE"), join(output, "vendor/THREE-LICENSE.txt"));
console.log("GitHub Pages site built at " + output);
