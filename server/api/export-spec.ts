import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const source = path.resolve("server/api/openapi.yaml");
const target = path.resolve("server/api/openapi.json");
const spec = parseYaml(fs.readFileSync(source, "utf8"));
fs.writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Wrote ${target}`);
