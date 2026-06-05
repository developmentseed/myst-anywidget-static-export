// Local typings for the MyST AST subset and Jupyter widget-state we touch.
// The source plugin imports no MyST runtime types; we keep these deliberately
// light so the package has zero non-dev dependencies.

/** A MyST AST node. We only care about a handful of fields; the rest pass through. */
export interface MystNode {
  type?: string;
  children?: MystNode[];
  // Output nodes carry a `jupyter_data` payload with mimebundle-style `data`.
  jupyter_data?: { data?: Record<string, MimeValue> } | null;
  // anywidget nodes (post-rewrite) carry these:
  esm?: string;
  model?: InitialModel;
  id?: string;
  key?: string;
  css?: string;
  // Allow arbitrary additional properties (AST nodes are open-ended).
  [key: string]: unknown;
}

/** mystmd wraps each mimebundle entry as `{ content: <value> }`. */
export interface MimeValue {
  content?: unknown;
}

/** A node paired with its parent, for in-place removal. */
export interface NodeWithParent {
  node: MystNode;
  parent: MystNode | null;
}

/** A single binary buffer descriptor from a widget's state. */
export interface BufferEntry {
  encoding?: string;
  data: string;
  path: (string | number)[];
}

/** One entry in the notebook's widget-state map. */
export interface WidgetStateEntry {
  state?: Record<string, unknown>;
  buffers?: BufferEntry[];
  model_module?: string;
  model_name?: string;
}

/** The full `metadata.widgets[...].state` map, keyed by model id. */
export type WidgetState = Record<string, WidgetStateEntry>;

/** A jslink/jsdlink binding lifted from LinkModel/DirectionalLinkModel state. */
export interface JsLink {
  id: string;
  bidirectional: boolean;
  sourceId: string;
  sourceAttr: string;
  targetId: string;
  targetAttr: string;
}

/** A bundled sub-model: state + buffers + module/name identity. */
export interface SubModelEntry {
  state: Record<string, unknown>;
  buffers: BufferEntry[];
  model_module?: string;
  model_name?: string;
}

export type SubModelBundle = Record<string, SubModelEntry>;

/** The `node.model` payload, with our private `_myst_*` keys. */
export interface InitialModel {
  _myst_buffers?: BufferEntry[];
  _myst_submodels?: SubModelBundle;
  _myst_links?: JsLink[];
  _myst_root_id?: string;
  _myst_anywidget_id?: string;
  _myst_css_text?: string;
  _myst_css_key?: string;
  [key: string]: unknown;
}

/** Relative asset paths emitted for one widget. */
export interface EmittedAssets {
  module: string;
  sourceModule: string;
  runtime: string;
  state: string;
  css?: string;
}

/** The vfile-like object mystmd passes to a transform. */
export interface VFile {
  path?: string;
  history?: string[];
}

/** A mystmd transform spec. */
export interface TransformSpec {
  name: string;
  stage: string;
  plugin: () => (tree: MystNode, file: VFile) => void | Promise<void>;
}

/** The plugin default-export shape. */
export interface MystPlugin {
  name: string;
  transforms: TransformSpec[];
}
