import * as esbuild from 'esbuild'
import process from 'process'

const banner = `/*
Obsidian MindMap Plugin - Ported from MindMD
*/`

const prod = process.argv[2] !== '--watch'

// CSS loader: return empty string (styles go in styles.css)
// This allows `import '@xyflow/react/dist/style.css'` to not break the build
const cssLoaderPlugin = {
  name: 'css-loader',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      return { contents: '', loader: 'js' }
    })
  },
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  jsx: 'automatic',
  jsxImportSource: 'react',
  plugins: [cssLoaderPlugin],
})

if (prod) {
  await context.rebuild()
  process.exit(0)
} else {
  await context.watch()
}
