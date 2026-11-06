const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist', 'easy-columns');
fs.mkdirSync(output, { recursive: true });
const readSource = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const css = readSource('styles.css');
const model = readSource('src/model.cjs');
const js = readSource('src/main.js')
  .replace("require('./model.cjs')", () => `(() => { const module = { exports: {} };\n${model}\nreturn module.exports; })()`)
  .replace('__PLUGIN_CSS__', () => JSON.stringify(css));
fs.writeFileSync(path.join(output, 'main.js'), js);
fs.writeFileSync(path.join(output, 'styles.css'), css);
fs.writeFileSync(path.join(output, 'manifest.json'), readSource('manifest.json'));
console.log('Built dist/easy-columns (no dependencies)');
