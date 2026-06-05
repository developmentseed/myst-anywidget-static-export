// I/O: asset emission, the per-widget wrapper module, and the page manifest.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { ASSET_DIR_NAME, MANIFEST_NAME, RUNTIME_MODULE_NAME } from "../constants.js";
import { RUNTIME_SOURCE } from "../generated/runtime-source.js";
import type { EmittedAssets, InitialModel, JsLink } from "../types.js";

export function shortHash(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function nanoidLike(): string {
  return crypto.randomBytes(10).toString("hex");
}

export function writeFileIfChanged(filePath: string, content: string): void {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) return;
  fs.writeFileSync(filePath, content);
}

// Wrap the user's ESM with the shared runtime + an initialize/render bootstrap.
// The user module is loaded via a Blob URL so its source stays byte-for-byte
// untouched.
export function buildWrapperModule(source: string): string {
  return `${RUNTIME_SOURCE}

const __mystUserModuleSource = ${JSON.stringify(source)};
const __mystUserModuleUrl = URL.createObjectURL(new Blob([__mystUserModuleSource], { type: 'text/javascript' }));
const __mystUserModulePromise = import(__mystUserModuleUrl);

async function __mystUserWidget() {
  const mod = await __mystUserModulePromise;
  return mod.default !== undefined ? mod.default : mod;
}

export default {
  async initialize(args) {
    return initializeStaticWidget(await __mystUserWidget(), args);
  },
  async render(args) {
    return renderStaticWidget(await __mystUserWidget(), args);
  },
};
`;
}

// Create the _widget_assets dir and write the shared host runtime to disk.
export function ensureStaticAssetDir(sourcePath: string): string {
  const sourceDir = path.dirname(sourcePath);
  const assetDir = path.join(sourceDir, ASSET_DIR_NAME);
  if (!fs.existsSync(assetDir)) fs.mkdirSync(assetDir, { recursive: true });
  writeFileIfChanged(path.join(assetDir, RUNTIME_MODULE_NAME), RUNTIME_SOURCE);
  return assetDir;
}

// Write the sidecar files (.source.mjs, .wrapper.mjs, .css, .state.json) and
// return the relative asset paths.
export function emitStaticWidgetAssets(
  assetDir: string,
  esm: string,
  css: string | undefined,
  model: InitialModel,
): EmittedAssets {
  const sourceEsmName = `${shortHash(esm)}.source.mjs`;
  writeFileIfChanged(path.join(assetDir, sourceEsmName), esm);

  const wrapperEsm = buildWrapperModule(esm);
  const wrapperEsmName = `${shortHash(wrapperEsm)}.wrapper.mjs`;
  writeFileIfChanged(path.join(assetDir, wrapperEsmName), wrapperEsm);

  let cssRel: string | undefined;
  if (css) {
    const cssName = `${shortHash(css)}.css`;
    writeFileIfChanged(path.join(assetDir, cssName), css);
    cssRel = `${ASSET_DIR_NAME}/${cssName}`;
  }

  const stateName = `${shortHash(JSON.stringify(model))}.state.json`;
  writeFileIfChanged(path.join(assetDir, stateName), `${JSON.stringify(model, null, 2)}\n`);

  return {
    module: `${ASSET_DIR_NAME}/${wrapperEsmName}`,
    sourceModule: `${ASSET_DIR_NAME}/${sourceEsmName}`,
    runtime: `${ASSET_DIR_NAME}/${RUNTIME_MODULE_NAME}`,
    state: `${ASSET_DIR_NAME}/${stateName}`,
    css: cssRel,
  };
}

export interface ManifestEntry {
  id: string;
  module: string;
  sourceModule: string;
  runtime: string;
  state: string;
  css?: string;
  buffers: number;
  submodels: number;
}

interface Manifest {
  runtime: string;
  pages: Record<string, { source: string; widgets: ManifestEntry[]; links: JsLink[] }>;
  widgets?: ManifestEntry[];
}

export function writeManifest(
  assetDir: string,
  sourcePath: string,
  manifestEntries: ManifestEntry[],
  links: JsLink[] = [],
): void {
  const manifestPath = path.join(assetDir, MANIFEST_NAME);
  let manifest: Manifest = { runtime: `${ASSET_DIR_NAME}/${RUNTIME_MODULE_NAME}`, pages: {} };
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (existing && typeof existing === "object") {
        manifest = {
          runtime: existing.runtime ?? manifest.runtime,
          pages: existing.pages ?? {},
        };
      }
    } catch {
      // Replace malformed manifests; generated artifacts should be deterministic.
    }
  }
  manifest.runtime = `${ASSET_DIR_NAME}/${RUNTIME_MODULE_NAME}`;
  manifest.pages[path.basename(sourcePath)] = {
    source: path.basename(sourcePath),
    widgets: manifestEntries,
    links,
  };
  manifest.widgets = Object.values(manifest.pages).flatMap((page) => page.widgets ?? []);
  writeFileIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
