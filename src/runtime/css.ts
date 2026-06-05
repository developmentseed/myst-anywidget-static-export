// React's createRoot() wipes el's children when mounting, so a CSS <link> the
// renderer appended into el gets blown away (visible with lonboard.Map, where
// Tailwind's .h-full / .flex / .w-full stop applying and deck.gl's container
// expands unbounded). Workaround: inject our own <style> as a sibling of el
// (directly into the shadow root). The CSS text was inlined into the model by
// the static-export plugin so the runtime URL doesn't matter.

export function ensureShadowCss(
  el: Element | null | undefined,
  cssText: string | null | undefined,
  cacheKey?: string,
): void {
  if (!el || !cssText) return;
  const root = el.getRootNode && el.getRootNode();
  if (!root || root === document) return;
  const key = cacheKey || cssText.length.toString();
  if ((root as ParentNode).querySelector('style[data-myst-css="' + key + '"]')) return;
  const style = document.createElement("style");
  style.setAttribute("data-myst-css", key);
  style.textContent = cssText;
  (root as Node).appendChild(style);
}
