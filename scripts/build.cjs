const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'dist', 'easy-columns');
fs.mkdirSync(output, { recursive: true });
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const model = fs.readFileSync(path.join(root, 'src/model.cjs'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8')
  .replace("require('./model.cjs')", () => `(() => { const module = { exports: {} };\n${model}\nreturn module.exports; })()`)
  .replace('__PLUGIN_CSS__', () => JSON.stringify(css));
fs.writeFileSync(path.join(output, 'main.js'), js);
fs.writeFileSync(path.join(output, 'styles.css'), css);
fs.copyFileSync(path.join(root, 'manifest.json'), path.join(output, 'manifest.json'));
console.log('Built dist/easy-columns (no dependencies)');
