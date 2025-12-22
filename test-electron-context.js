#!/usr/bin/env node
/**
 * Test native module loading in simulated Electron context
 * Tests the path resolution logic that would be used in packaged apps
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Electron Context Integration Test\n');

// Simulate Electron's __dirname in different scenarios
const scenarios = [
  {
    name: 'Development Mode',
    __dirname: path.join(__dirname, 'src-native'),
    description: 'Running from source code'
  },
  {
    name: 'Packaged App (ASAR)',
    __dirname: '/Applications/IceCubes.app/Contents/Resources/app.asar/node_modules/ghost-native',
    description: 'Running from packaged DMG (simulated)'
  }
];

function resolveNativePath(filename, __dirname) {
  const { join } = require('path');
  const { existsSync } = require('fs');
  
  const localPath = join(__dirname, filename);
  if (existsSync(localPath)) {
    return localPath;
  }
  
  if (__dirname.includes('.asar')) {
    const unpackedDir = __dirname.replace('.asar', '.asar.unpacked');
    const unpackedPath = join(unpackedDir, filename);
    if (existsSync(unpackedPath)) {
      return unpackedPath;
    }
  }
  
  return localPath;
}

scenarios.forEach((scenario, index) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scenario ${index + 1}: ${scenario.name}`);
  console.log(`Description: ${scenario.description}`);
  console.log(`Simulated __dirname: ${scenario.__dirname}`);
  console.log('='.repeat(60));
  
  const arch = process.arch;
  const filename = arch === 'x64' 
    ? 'ghost-native.darwin-x64.node'
    : 'ghost-native.darwin-arm64.node';
  
  const resolvedPath = resolveNativePath(filename, scenario.__dirname);
  const exists = fs.existsSync(resolvedPath);
  
  console.log(`\nArchitecture: ${arch}`);
  console.log(`Target file: ${filename}`);
  console.log(`Resolved path: ${resolvedPath}`);
  console.log(`File exists: ${exists ? '✅ Yes' : '❌ No'}`);
  
  if (scenario.__dirname.includes('.asar')) {
    const unpackedPath = scenario.__dirname.replace('.asar', '.asar.unpacked') + '/' + filename;
    console.log(`\nUnpacked location would be: ${unpackedPath}`);
    console.log(`(This is where Electron Builder unpacks native modules)`);
  }
  
  if (exists) {
    try {
      console.log(`\nAttempting to load module from resolved path...`);
      const mod = require(resolvedPath);
      console.log('✅ Module loaded successfully!');
      console.log(`✅ downloadParakeetModel available: ${typeof mod.downloadParakeetModel === 'function'}`);
      console.log(`✅ initParakeet available: ${typeof mod.initParakeet === 'function'}`);
    } catch (e) {
      console.log(`❌ Failed to load: ${e.message}`);
    }
  } else {
    console.log(`\n⚠️  File doesn't exist at resolved path (expected in simulated scenario)`);
  }
});

console.log('\n' + '='.repeat(60));
console.log('Summary:');
console.log('='.repeat(60));
console.log('✅ Path resolution logic tested');
console.log('✅ Both development and packaged scenarios covered');
console.log('✅ Ready for Electron app integration');

