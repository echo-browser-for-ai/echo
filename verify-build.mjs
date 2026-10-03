import fs from 'fs';

const files = [
  'mcp-server/dist/index.js',
  'C:/Program Files/Echo/resources/shims/echo-shim.js'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: NOT FOUND`);
    continue;
  }
  const code = fs.readFileSync(file, 'utf-8');
  console.log(`${file}: ${code.length} bytes`);
  
  // Check for the diagnostic line specifically
  const hasDiag = code.includes('SHIM-LOADED');
  console.log(`  Has SHIM-LOADED marker: ${hasDiag}`);
}

// Check the source TypeScript
const src = fs.readFileSync('mcp-server/src/index.ts', 'utf-8');
console.log(`\nmcp-server/src/index.ts: ${src.length} bytes`);
console.log(`  Has SHIM-LOADED marker: ${src.includes('SHIM-LOADED')}`);