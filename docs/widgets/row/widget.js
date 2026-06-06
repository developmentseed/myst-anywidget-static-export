// Row container: render each child anywidget side by side.
//
// In a static export, args.host.renderChild(ref, el) mounts a referenced child
// anywidget into our own DOM (kernel-free) and returns its cleanup. The child
// refs arrive as the synced `children` trait (an array of "IPY_MODEL_<id>").

function render({ model, el, host }) {
    el.innerHTML = "";

    const row = document.createElement("div");
    row.className = "myst-row";
    row.style.display = "flex";
    row.style.gap = model.get("gap") || "16px";
    row.style.alignItems = "flex-start";
    row.style.flexWrap = "wrap";
    el.appendChild(row);

    const refs = model.get("children") || [];
    const cleanups = [];

    (async () => {
        for (const ref of refs) {
            const cell = document.createElement("div");
            cell.className = "myst-row__cell";
            row.appendChild(cell);
            if (host && typeof host.renderChild === "function") {
                try {
                    cleanups.push(await host.renderChild(ref, cell));
                } catch (err) {
                    cell.textContent = "[child failed: " + (err && err.message) + "]";
                }
            } else {
                cell.textContent = "[no static host: live kernel path not wired in this demo]";
            }
        }
    })();

    return () => {
        for (const dispose of cleanups) {
            try {
                dispose();
            } catch (err) {
                /* ignore */
            }
        }
    };
}

export default { render };
