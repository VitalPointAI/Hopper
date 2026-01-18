const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // External modules that cannot be bundled:
  // - vscode: provided by VS Code at runtime
  // - jiti: ESLint v9 flat config loader
  // - eslint*, @typescript-eslint/*: ESLint and plugins - must be loaded at runtime
  //   to avoid initialization issues when bundled
  external: [
    'vscode',
    'jiti',
    'eslint',
    'eslint-plugin-security',
    'eslint-plugin-no-unsanitized',
    '@typescript-eslint/parser',
  ],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: false,
  target: 'node18'
};

async function build() {
  try {
    if (watch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);

      // Copy package.json to dist/ to fix runtime resolution issues
      // Some bundled dependencies use __dirname to find package.json
      const srcPkg = path.join(__dirname, 'package.json');
      const distPkg = path.join(__dirname, 'dist', 'package.json');
      fs.copyFileSync(srcPkg, distPkg);

      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
