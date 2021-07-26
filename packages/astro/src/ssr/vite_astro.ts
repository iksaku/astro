import type { Plugin } from 'vite';
import type { CompileOptions } from '../@types/compiler';

import fs from 'fs';
import path from 'path';
import slash from 'slash';
import { fileURLToPath } from 'url';
import { compileComponent } from '../compiler/index.js';

const ASTRO_RENDERERS = 'astro_core:renderers';

/** Allow Vite to load .astro files */
export default function astro(compileOptions: CompileOptions): Plugin {
  const tmpDir = new URL('./.astro-ssr/', compileOptions.astroConfig.projectRoot);
  const cssDir = new URL('./css/', tmpDir);

  return {
    name: '@astrojs/plugin-vite',
    resolveId(id) {
      if (id === ASTRO_RENDERERS) return id;
      return null;
    },
    async load(id) {
      if (id === ASTRO_RENDERERS) {
        let code: string[] = [];
        let renderers = compileOptions.astroConfig.renderers || [];

        await Promise.all(
          renderers.map(async (name, n) => {
            const { default: raw } = await import(name);
            code.push(`import __renderer_${n} from '${name}${raw.server.replace(/^\./, '')}';`); // note: even if import statements are written out-of-order, "n" will still be in array order
          })
        );
        code.push(`const renderers = [`);
        renderers.forEach((moduleName, n) => {
          code.push(`  { source: '${moduleName}', renderer: __renderer_${n}, polyfills: [], hydrationPolyfills: [] },`);
        });
        code.push(`];`);
        code.push(`export default renderers;`);
        return code.join('\n') + '\n';
      }

      return null;
    },
    async transform(src, id) {
      if (id.endsWith('.astro') || id.endsWith('.md')) {
        const result = await compileComponent(src, {
          compileOptions,
          filename: id,
          projectRoot: fileURLToPath(compileOptions.astroConfig.projectRoot),
        });
        let code = result.contents;
        if (result.css && result.css.code) {
          const projectLoc = slash(id).replace(compileOptions.astroConfig.projectRoot.pathname, '');
          const cssID = `${projectLoc}.css`;
          const filePath = new URL(cssID, cssDir);
          if (!fs.existsSync(new URL('./', filePath))) await fs.promises.mkdir(new URL('./', filePath), { recursive: true });
          await fs.promises.writeFile(filePath, result.css.code);
          if (result.css.map) await fs.promises.writeFile(fileURLToPath(filePath) + '.map', result.css.map.toString(), 'utf8');
          code = `import '${path.relative(path.dirname(id), fileURLToPath(cssDir))}/${cssID}';\n` + code;
        }
        return {
          code,
          map: undefined, // TODO: add sourcemap
        };
      }
      if (id.endsWith('__astro_component.js')) {
        const code = `import rendererInstances from '${ASTRO_RENDERERS}';
${src}`;
        return {
          code,
          map: undefined, // TODO
        };
      }
    },
    transformIndexHtml(html) {
      console.log({ html });
      return html;
    },
  };
}
