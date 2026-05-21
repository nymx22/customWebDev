/**
 * Stack (multi-layer) controls for the frame staging cell editor.
 */

import {
  createDefaultStackLayer,
  normalizeStackLayer,
  parseStackLayersFromCell,
  serializeStackLayersBody,
} from "./frame-cell-layers.js";

/**
 * @param {{
 *   buildLayerFromForm: () => object | null,
 *   fillFormFromLayer: (layer: object) => void,
 *   onChange: () => void,
 * }} hooks
 */
export function mountStackLayerControls(hooks) {
  const wrap = document.createElement("div");
  wrap.className = "staging-frame-panel__stack";
  wrap.hidden = true;

  const list = document.createElement("ul");
  list.className = "staging-frame-panel__stack-list";

  const actions = document.createElement("div");
  actions.className = "staging-frame-panel__stack-actions";

  /** @type {object[]} */
  let layers = [];
  let selected = 0;

  function renderList() {
    list.textContent = "";
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const li = document.createElement("li");
      li.className = "staging-frame-panel__stack-item";
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "staging-frame-panel__stack-pick";
      if (i === selected) {
        pick.classList.add("is-selected");
      }
      pick.textContent = `${i + 1}. ${layer.type || "layer"}`;
      pick.addEventListener("click", (e) => {
        e.preventDefault();
        saveSelected();
        selected = i;
        hooks.fillFormFromLayer(layers[selected]);
        renderList();
        hooks.onChange();
      });
      const up = document.createElement("button");
      up.type = "button";
      up.className = "staging-frame-panel__stack-move";
      up.textContent = "↑";
      up.title = "Move up";
      up.disabled = i === 0;
      up.addEventListener("click", (e) => {
        e.preventDefault();
        if (i === 0) return;
        saveSelected();
        const tmp = layers[i - 1];
        layers[i - 1] = layers[i];
        layers[i] = tmp;
        selected = i - 1;
        hooks.fillFormFromLayer(layers[selected]);
        renderList();
        hooks.onChange();
      });
      const down = document.createElement("button");
      down.type = "button";
      down.className = "staging-frame-panel__stack-move";
      down.textContent = "↓";
      down.title = "Move down";
      down.disabled = i === layers.length - 1;
      down.addEventListener("click", (e) => {
        e.preventDefault();
        if (i >= layers.length - 1) return;
        saveSelected();
        const tmp = layers[i + 1];
        layers[i + 1] = layers[i];
        layers[i] = tmp;
        selected = i + 1;
        hooks.fillFormFromLayer(layers[selected]);
        renderList();
        hooks.onChange();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "staging-frame-panel__stack-del";
      del.textContent = "×";
      del.title = "Remove layer";
      del.addEventListener("click", (e) => {
        e.preventDefault();
        saveSelected();
        layers.splice(i, 1);
        if (!layers.length) {
          layers.push(createDefaultStackLayer("text"));
        }
        selected = Math.min(selected, layers.length - 1);
        hooks.fillFormFromLayer(layers[selected]);
        renderList();
        hooks.onChange();
      });
      li.appendChild(pick);
      li.appendChild(up);
      li.appendChild(down);
      li.appendChild(del);
      list.appendChild(li);
    }
  }

  function saveSelected() {
    if (!layers.length) return;
    const built = hooks.buildLayerFromForm();
    if (built) {
      layers[selected] = built;
    }
  }

  function addLayer(type) {
    saveSelected();
    layers.push(createDefaultStackLayer(type));
    selected = layers.length - 1;
    hooks.fillFormFromLayer(layers[selected]);
    renderList();
    hooks.onChange();
  }

  [["text", "+ Text"], ["image", "+ Image"], ["shape", "+ Shape"]].forEach(([type, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "staging-frame-panel__inline-action";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      addLayer(type);
    });
    actions.appendChild(btn);
  });

  wrap.appendChild(list);
  wrap.appendChild(actions);

  return {
    element: wrap,
    isActive: false,
    setActive(active) {
      this.isActive = active;
      wrap.hidden = !active;
    },
    /** @param {object} cell */
    loadFromCell(cell) {
      layers = parseStackLayersFromCell(cell).map((l) => {
        const n = normalizeStackLayer(l);
        return n ? JSON.parse(JSON.stringify(n)) : null;
      }).filter(Boolean);
      if (!layers.length) {
        layers = [createDefaultStackLayer("text")];
      }
      selected = 0;
      hooks.fillFormFromLayer(layers[0]);
      renderList();
    },
    /** @param {object | null} singleLayer */
    seedFromSingleLayer(singleLayer) {
      const n = singleLayer ? normalizeStackLayer({ ...singleLayer, type: singleLayer.contentType || singleLayer.type }) : null;
      layers = n ? [JSON.parse(JSON.stringify(n))] : [createDefaultStackLayer("text")];
      selected = 0;
      hooks.fillFormFromLayer(layers[0]);
      renderList();
    },
    saveSelected,
    /** @returns {object[]} */
    getLayers() {
      saveSelected();
      return layers.map((l) => JSON.parse(JSON.stringify(l)));
    },
    getBody() {
      return serializeStackLayersBody(this.getLayers());
    },
    getActiveLayerType() {
      saveSelected();
      const layer = layers[selected];
      return layer && layer.type ? String(layer.type) : "text";
    },
  };
}
