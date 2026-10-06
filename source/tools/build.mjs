// Builds two single-file versions of the game into dist/:
//   battle-arena.html   a complete page you can double-click to play offline (fonts need internet)
//   artifact.html       the same page without the html/head/body shell, for publishing as an Artifact
// Usage (from this folder):  npm i --no-save esbuild three@0.180.0 && node tools/build.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2020',
  alias: { three: join(root, 'vendor/three.module.min.js') },
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'css/style.css'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
let body = html.split('<!--BODY-START-->')[1].split('<!--BODY-END-->')[0];
// images referenced from the page are inlined so the build stays one self-contained file
body = body.replace(/src="(assets\/[\w.-]+\.(webp|png|jpe?g))"/g, (_, file, ext) =>
  `src="data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(join(root, file)).toString('base64')}"`);
// (the vendor script tag sits outside the BODY markers, so only the inlined copy ships)
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&family=Grenze+Gotisch:wght@500&display=swap">';
// link-preview tags (Facebook, Messenger, texts) only matter on the hosted page, not the Artifact copy
const og = html.split('<!--OG-START-->')[1].split('<!--OG-END-->')[0].trim();
const head = `<title>José Madrid Salsa Battle Arena</title>\n${fonts}\n<style>\n${css}\n</style>`;
// PeerJS (MIT, see vendor/peerjs-LICENSE) is a classic script that defines window.peerjs for src/net/transport.js
const peerjs = readFileSync(join(root, 'vendor/peerjs.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const script = `<script>\n${peerjs}\n</script>\n<script type="module">\n${js}\n</script>`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/battle-arena.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="data:,">\n${og}\n${head}\n</head>\n<body>\n${body}\n${script}\n</body>\n</html>\n`);
writeFileSync(join(root, 'dist/artifact.html'), `${head}\n${body}\n${script}\n`);
console.log(`built: ${(js.length / 1024).toFixed(0)} KB of script`);
