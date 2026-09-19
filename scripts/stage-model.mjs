import { access, copyFile, link, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelName = 'whisper-large-v3-turbo-4bit';
const destination = path.join(root, '.model-bundle', modelName);
const candidates = [
  process.env.GLEAN_BUNDLED_MODEL_DIR,
  path.join(root, '.glean', 'models', modelName),
  path.join(os.homedir(), 'Library', 'Application Support', 'glean', 'data', 'models', modelName),
].filter(Boolean).map(value => path.resolve(value));
const required = ['config.json', 'weights.safetensors', 'multilingual.tiktoken'];

async function valid(directory) {
  try {
    await Promise.all(required.map(file => access(path.join(directory, file))));
    const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
    return config.quantization?.bits === 4;
  } catch {
    return false;
  }
}

const source = await (async () => {
  for (const candidate of candidates) {
    if (candidate !== destination && await valid(candidate)) return candidate;
  }
  return null;
})();

if (!source) {
  throw new Error(`没有找到完整的 ${modelName} 模型。请设置 GLEAN_BUNDLED_MODEL_DIR，或把模型放入以下任一路径：\n${candidates.join('\n')}`);
}

await mkdir(destination, { recursive: true });
let bytes = 0;
for (const file of required) {
  const from = path.join(source, file);
  const to = path.join(destination, file);
  try { await unlink(to); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    await link(from, to);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    await copyFile(from, to);
  }
  bytes += (await stat(to)).size;
}

console.log(`已暂存内置模型：${source}`);
console.log(`打包资源：${destination}（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
