// Copies the Chart.js browser bundle into public/vendor so it is served as a static file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
fs.mkdirSync(path.join(root, 'public', 'vendor'), { recursive: true });
fs.copyFileSync(src, path.join(root, 'public', 'vendor', 'chart.umd.js'));
console.log('Copied chart.umd.js -> public/vendor/');
