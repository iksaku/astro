import type { ViteDevServer } from 'vite';
import type { LogOptions } from '../logger';

import path from 'path';
import { fileURLToPath } from 'url';
import loadCollection from './collections.js';
import { canonicalURL, URLMap } from './util.js';

interface SSROptions {
  isDev?: boolean;
  logging: LogOptions;
  origin: string;
  projectRoot: URL;
  reqURL: string;
  urlMap: URLMap;
  viteServer: ViteDevServer;
}

/** Transform code for Vite */
function resolveIDs(code: string): string {
  return code.replace(/\/?astro_core:([^\/]+)/g, '/@id/astro_core:$1');
}

/** Use Vite to SSR URL */
export default async function ssr({ isDev = true, logging, reqURL, urlMap, origin, projectRoot, viteServer }: SSROptions): Promise<{ html: string; css?: string }> {
  // locate file on disk
  const tmpDir = new URL('./.astro-ssr/', projectRoot);
  const fullURL = new URL(reqURL, origin);
  const modURL = urlMap.staticPages.get(reqURL) as URL;
  const mod = await viteServer.ssrLoadModule(fileURLToPath(modURL));

  let pageProps = {} as Record<string, any>;

  // load collection, if applicable
  if (mod.collection) {
    const collectionResult = await loadCollection(mod, { logging, reqURL, filePath: modURL });
    pageProps = collectionResult.pageProps;
  }

  const modMeta = await viteServer.moduleGraph.getModuleByUrl(fileURLToPath(modURL));
  const deepImports = new Set<string>();
  async function collectDeepImports(modUrl: string) {
    if (deepImports.has(modUrl)) {
      return;
    }
    deepImports.add(modUrl);
    const depMeta = await viteServer.moduleGraph.getModuleByUrl(modUrl);
    depMeta?.ssrTransformResult?.deps?.forEach(collectDeepImports);
  }
  await Promise.all(modMeta?.ssrTransformResult?.deps?.map(collectDeepImports) || []);
  const deepCssImports = [...deepImports].filter((d) => d.endsWith('.css'));

  // SSR HTML
  let html: string = await mod.__renderPage({
    request: {
      // params should go here when implemented
      url: fullURL,
      canonicalURL: canonicalURL(fullURL.pathname, fullURL.origin),
    },
    children: [],
    props: pageProps,
    css: mod.css || [],
  });

  // prepare template with Vite
  html = await viteServer.transformIndexHtml(reqURL, html);

  html = html.replace(
    '</head>',
    `  ${deepCssImports
      .map((projectURL) => {
        const filePath = new URL(`.${projectURL}`, projectRoot);
        const reqLoc = new URL(`.${path.posix.dirname(reqURL).replace(/\/?$/, '/')}`, tmpDir);
        let relPath = path.relative(fileURLToPath(reqLoc), fileURLToPath(filePath));
        if (relPath[0] !== '.') relPath = `./${relPath}`; // Vite relies on module-style syntax
        return `<link rel="stylesheet" type="text/css" href="${relPath}" />`;
      })
      .join('\n  ')}</head>`
  );

  // update URLs for production build
  if (!isDev) {
    html = html.replace(/\/@id\//g, '');
  }

  // finish
  return { html, css: mod.css };
}
