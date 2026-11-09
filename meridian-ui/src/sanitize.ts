const ALLOWED = new Set(["H2", "H3", "H4", "P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "STRONG", "EM", "BR"]);

/** Whitelist sanitizer for manifest HTML previews: keeps structural tags, drops every attribute and unknown element. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node: Element): void => {
    Array.from(node.children).forEach((child) => {
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(doc.createTextNode(child.textContent ?? ""));
        return;
      }
      Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
      walk(child);
    });
  };
  const root = doc.body.firstElementChild as Element;
  walk(root);
  return root.innerHTML;
}
