/**
 * Grouped, draggable Pages list for the staging site-structure panel.
 * Loaded after staging.js; exposes `window.customdevRenderPagesTree`.
 */
(function () {
  "use strict";

  function pageFileSlug(pageName) {
    return String(pageName || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "page";
  }

  function normalizePathname(path) {
    return String(path || "")
      .toLowerCase()
      .replace(/\\/g, "/");
  }

  /** True when the current URL is under `pages/` (not site-root `index.html`). */
  function isInPagesFolder() {
    return /\/pages\//i.test(normalizePathname(window.location.pathname));
  }

  /**
   * Relative href from the current document to a site page.
   * Homepage: `index.html` at repo root; other pages: `pages/{slug}.html`.
   */
  function siteRelativePageHref(pageName) {
    var name = String(pageName || "")
      .trim()
      .replace(/\.html$/i, "");
    var slug = name || "index";
    if (slug === "index") {
      return isInPagesFolder() ? "../index.html" : "index.html";
    }
    var file = pageFileSlug(slug) + ".html";
    return isInPagesFolder() ? file : "pages/" + file;
  }

  /** Resolved same-origin URL for a page (honours staging query when active). */
  function resolveSitePageUrl(pageName) {
    var u = new URL(siteRelativePageHref(pageName), window.location.href);
    if (document.documentElement.classList.contains("staging")) {
      u.searchParams.set("staging", "1");
    }
    return u;
  }

  /** `href` for page links in the panel (relative under `pages/`, root-absolute from `index.html`). */
  function stagingHrefForPage(pageName) {
    var u = resolveSitePageUrl(pageName);
    if (isInPagesFolder()) {
      return siteRelativePageHref(pageName) + u.search + (u.hash || "");
    }
    return u.pathname + u.search + (u.hash || "");
  }

  /** Navigate after delete or other actions — always resolves `../index.html` vs `index.html` correctly. */
  function navigateToSitePage(pageName) {
    window.location.assign(resolveSitePageUrl(pageName).href);
  }

  /** True when this browser tab is showing the given registry page. */
  function isViewingPage(pageName) {
    var name = String(pageName || "")
      .trim()
      .toLowerCase();
    if (!name) {
      return false;
    }
    var frameEl = document.querySelector("[data-site-frame-page]");
    if (frameEl) {
      var framePage = String(frameEl.getAttribute("data-site-frame-page") || "")
        .trim()
        .toLowerCase();
      if (framePage && framePage === name) {
        return true;
      }
    }
    var path = normalizePathname(window.location.pathname);
    var slug = pageFileSlug(pageName);
    if (name === "index") {
      return /(?:^|\/)index\.html$/.test(path);
    }
    return path.endsWith("/pages/" + slug + ".html");
  }

  /**
   * @param {HTMLUListElement} list
   * @param {HTMLElement} dragged
   * @param {number} clientY
   */
  function insertPageAtPointer(list, dragged, clientY) {
    var items = [];
    var nodes = list.children;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node instanceof HTMLElement && node.hasAttribute("data-page-id") && node !== dragged) {
        items.push(node);
      }
    }
    var before = null;
    for (i = 0; i < items.length; i++) {
      var box = items[i].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) {
        before = items[i];
        break;
      }
    }
    if (before) {
      list.insertBefore(dragged, before);
    } else {
      list.appendChild(dragged);
    }
  }

  /**
   * @param {HTMLElement} host
   * @param {{
   *   el: (tag: string, className?: string, text?: string) => HTMLElement,
   *   labeledInput: (id: string, label: string, input: HTMLElement) => HTMLElement,
   *   base: string,
   *   statusLine: HTMLElement,
   *   getPages: () => Array<object>,
   *   getGroups: () => Array<object>,
   *   fetchRegistry: () => Promise<unknown>,
   *   mergeRegistryPage?: (page: object) => void,
   *   renderLists: () => void,
   *   refreshPageSelect: () => void,
   * }} ctx
   */
  function renderPagesTree(host, ctx) {
    host.innerHTML = "";
    host.className = "staging-site-structure-panel__pages-tree";

    var toolbar = ctx.el("div", "staging-pages-tree__toolbar");
    toolbar.className = "staging-pages-tree__toolbar";
    var addGroupBtn = ctx.el("button", "staging-site-structure-panel__primary", "+ Add group");
    addGroupBtn.type = "button";
    toolbar.appendChild(addGroupBtn);
    host.appendChild(toolbar);

    var groups = ctx.getGroups();
    var pages = ctx.getPages();
    var pagesByGroup = {};
    var ungrouped = [];
    var gi;
    for (gi = 0; gi < pages.length; gi++) {
      var p = pages[gi];
      var gid = p.groupId != null ? p.groupId : null;
      if (gid == null) {
        ungrouped.push(p);
      } else {
        if (!pagesByGroup[gid]) {
          pagesByGroup[gid] = [];
        }
        pagesByGroup[gid].push(p);
      }
    }

    function collectOrderPayload() {
      /** @type {Array<{ id: number, sortOrder: number }>} */
      var groupPayload = [];
      /** @type {Array<{ id: number, groupId: number | null, sortOrder: number }>} */
      var pagePayload = [];
      var gOrder = 0;
      host.querySelectorAll("[data-page-group-id]").forEach(function (groupEl) {
        var gId = parseInt(groupEl.getAttribute("data-page-group-id") || "", 10);
        if (!gId) {
          return;
        }
        groupPayload.push({ id: gId, sortOrder: gOrder * 10 });
        gOrder += 1;
        var pOrder = 0;
        groupEl.querySelectorAll("[data-page-id]").forEach(function (pageEl) {
          var pId = parseInt(pageEl.getAttribute("data-page-id") || "", 10);
          if (!pId) {
            return;
          }
          pagePayload.push({ id: pId, groupId: gId, sortOrder: pOrder * 10 });
          pOrder += 1;
        });
      });
      var uHost = host.querySelector("[data-page-group-ungrouped]");
      if (uHost) {
        var uOrder = 0;
        uHost.querySelectorAll("[data-page-id]").forEach(function (pageEl) {
          var pId = parseInt(pageEl.getAttribute("data-page-id") || "", 10);
          if (!pId) {
            return;
          }
          pagePayload.push({ id: pId, groupId: null, sortOrder: uOrder * 10 });
          uOrder += 1;
        });
      }
      return { groups: groupPayload, pages: pagePayload };
    }

    function saveOrder() {
      var payload = collectOrderPayload();
      return fetch(ctx.base + "/api/pages/order", {
        method: "PATCH",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          if (!r.ok) {
            throw new Error("HTTP " + r.status);
          }
          return ctx.fetchRegistry();
        })
        .then(function () {
          ctx.statusLine.textContent = "Saved page order.";
          ctx.renderLists();
          ctx.refreshPageSelect();
        })
        .catch(function () {
          ctx.statusLine.textContent = "Could not save page order.";
        });
    }

    function duplicateApiErrorMessage(err) {
      var detail = err && err.message ? String(err.message) : "";
      if (!detail) {
        return "unknown error";
      }
      try {
        var parsed = JSON.parse(detail);
        if (parsed && parsed.error) {
          return String(parsed.error);
        }
      } catch (parseErr) {
        /* use raw detail */
      }
      return detail;
    }

    function highlightPageRow(pageId) {
      if (pageId == null) {
        return;
      }
      requestAnimationFrame(function () {
        var row = host.querySelector('[data-page-id="' + String(pageId) + '"]');
        if (!row) {
          return;
        }
        row.classList.add("staging-pages-tree__page--highlight");
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        window.setTimeout(function () {
          row.classList.remove("staging-pages-tree__page--highlight");
        }, 2800);
      });
    }

    function duplicatePage(pageId, dupBtn) {
      var pid = Number(pageId);
      if (!Number.isFinite(pid) || pid < 1) {
        ctx.statusLine.textContent = "Could not duplicate page (invalid page id).";
        return Promise.resolve();
      }
      if (dupBtn) {
        dupBtn.disabled = true;
      }
      ctx.statusLine.textContent = "Duplicating…";
      return fetch(ctx.base + "/api/page/duplicate", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pid }),
      })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error(t || "HTTP " + r.status);
            });
          }
          return r.json();
        })
        .then(function (data) {
          if (
            data &&
            data.page &&
            typeof ctx.mergeRegistryPage === "function" &&
            ctx.getPages().length
          ) {
            ctx.mergeRegistryPage(data.page);
          }
          var nm =
            data && data.page && data.page.name ? String(data.page.name) : "copy";
          var msg = 'Duplicated page as "' + nm + '".';
          if (data && data.htmlPath) {
            msg += " Created " + data.htmlPath + ".";
          } else if (data && data.htmlWarning) {
            msg += " " + data.htmlWarning;
          }
          ctx.statusLine.textContent = msg;
          ctx.renderLists();
          ctx.refreshPageSelect();
          if (data && data.page && data.page.id != null) {
            highlightPageRow(data.page.id);
          }
          return ctx.fetchRegistry().then(
            function () {
              ctx.renderLists();
              ctx.refreshPageSelect();
              if (data && data.page && data.page.id != null) {
                highlightPageRow(data.page.id);
              }
            },
            function () {
              /* keep optimistic list */
            },
          );
        })
        .catch(function (err) {
          ctx.statusLine.textContent =
            "Could not duplicate page: " + duplicateApiErrorMessage(err);
        })
        .finally(function () {
          if (dupBtn) {
            dupBtn.disabled = false;
          }
        });
    }

    function activeDragPageId(ev) {
      var fromTransfer =
        ev.dataTransfer && ev.dataTransfer.getData("text/page-id");
      if (fromTransfer) {
        return fromTransfer;
      }
      return host.getAttribute("data-dragging-page-id") || "";
    }

    function wirePageList(list) {
      list.addEventListener("dragover", function (ev) {
        var pageId = activeDragPageId(ev);
        if (!pageId) {
          return;
        }
        ev.preventDefault();
        if (ev.dataTransfer) {
          ev.dataTransfer.dropEffect = "move";
        }
        var dragged = host.querySelector('[data-page-id="' + pageId + '"]');
        if (!dragged) {
          return;
        }
        insertPageAtPointer(list, dragged, ev.clientY);
      });
      list.addEventListener("drop", function (ev) {
        ev.preventDefault();
        var pageId = activeDragPageId(ev);
        if (!pageId) {
          return;
        }
        var dragged = host.querySelector('[data-page-id="' + pageId + '"]');
        if (!dragged) {
          return;
        }
        insertPageAtPointer(list, dragged, ev.clientY);
        host.removeAttribute("data-dragging-page-id");
        void saveOrder();
      });
    }

    function wireDropZone(zone) {
      var list = zone.querySelector(".staging-pages-tree__page-list");
      if (!list) {
        return;
      }
      wirePageList(list);
      zone.addEventListener("dragover", function (ev) {
        if (!ev.dataTransfer || !ev.dataTransfer.types.includes("text/page-id")) {
          return;
        }
        ev.preventDefault();
        zone.classList.add("staging-pages-tree__drop--over");
      });
      zone.addEventListener("dragleave", function (ev) {
        if (ev.target === zone || !zone.contains(ev.relatedTarget)) {
          zone.classList.remove("staging-pages-tree__drop--over");
        }
      });
      zone.addEventListener("drop", function (ev) {
        if (!ev.dataTransfer || !ev.dataTransfer.getData("text/page-id")) {
          return;
        }
        zone.classList.remove("staging-pages-tree__drop--over");
      });
    }

    function renderPageRow(p) {
      var li = ctx.el("li", "staging-site-structure-panel__li staging-pages-tree__page");
      li.setAttribute("data-page-id", String(p.id));

      var view = ctx.el("div", "staging-site-structure-panel__li-view");

      var handle = ctx.el("span", "staging-pages-tree__drag-handle", "⠿");
      handle.setAttribute("draggable", "true");
      handle.setAttribute("aria-label", "Drag to reorder");
      handle.setAttribute("title", "Drag to reorder");
      handle.addEventListener("dragstart", function (ev) {
        li.classList.add("staging-pages-tree__is-dragging");
        host.setAttribute("data-dragging-page-id", String(p.id));
        if (ev.dataTransfer) {
          ev.dataTransfer.setData("text/page-id", String(p.id));
          ev.dataTransfer.effectAllowed = "move";
        }
      });
      handle.addEventListener("dragend", function () {
        li.classList.remove("staging-pages-tree__is-dragging");
        host.removeAttribute("data-dragging-page-id");
      });

      var isHomepage = String(p.name || "")
        .trim()
        .toLowerCase() === "index";
      var summary = ctx.el("span", "staging-site-structure-panel__li-summary");
      if (isHomepage) {
        summary.classList.add("staging-pages-tree__summary--home");
        summary.appendChild(document.createTextNode("Homepage — "));
      }
      var pageLink = document.createElement("a");
      pageLink.className = "staging-pages-tree__page-link";
      pageLink.href = stagingHrefForPage(p.name);
      pageLink.textContent = p.name;
      pageLink.addEventListener("dragstart", function (ev) {
        ev.preventDefault();
      });
      summary.appendChild(pageLink);
      summary.appendChild(
        document.createTextNode(
          " — header " + p.header + ", footer " + p.footer + " (id " + p.id + ")",
        ),
      );

      var dupBtn = ctx.el(
        "button",
        "staging-site-structure-panel__li-edit staging-pages-tree__dup-btn",
        "Duplicate",
      );
      dupBtn.type = "button";
      dupBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        void duplicatePage(p.id, dupBtn);
      });

      var editBtn = ctx.el("button", "staging-site-structure-panel__li-edit", "Edit");
      editBtn.type = "button";
      var del = ctx.el("button", "staging-site-structure-panel__del", "Remove");
      del.type = "button";
      if (isHomepage) {
        del.disabled = true;
        del.title = "Homepage cannot be removed";
      }

      view.appendChild(handle);
      view.appendChild(summary);
      view.appendChild(dupBtn);
      view.appendChild(editBtn);
      if (!isHomepage) {
        view.appendChild(del);
      }

      var form = ctx.el("div", "staging-site-structure-panel__li-form");
      form.className = "staging-site-structure-panel__li-form";
      form.setAttribute("hidden", "");

      var nameIn = document.createElement("input");
      nameIn.type = "text";
      nameIn.className = "staging-site-structure-panel__input";
      nameIn.value = p.name;
      if (isHomepage) {
        nameIn.disabled = true;
        nameIn.title = "Homepage registry name is always index";
      }
      form.appendChild(ctx.labeledInput("staging-edit-page-name-" + p.id, "Name", nameIn));

      var cbH = document.createElement("input");
      cbH.type = "checkbox";
      cbH.id = "staging-edit-page-h-" + p.id;
      cbH.checked = Number(p.header) === 1;
      var labEH = ctx.el("label", "staging-site-structure-panel__check", "Header");
      labEH.setAttribute("for", cbH.id);
      labEH.insertBefore(cbH, labEH.firstChild);
      form.appendChild(labEH);

      var cbF = document.createElement("input");
      cbF.type = "checkbox";
      cbF.id = "staging-edit-page-f-" + p.id;
      cbF.checked = Number(p.footer) === 1;
      var labEF = ctx.el("label", "staging-site-structure-panel__check", "Footer");
      labEF.setAttribute("for", cbF.id);
      labEF.insertBefore(cbF, labEF.firstChild);
      form.appendChild(labEF);

      var saveBtn = ctx.el("button", "staging-site-structure-panel__primary", "Save");
      saveBtn.type = "button";
      var cancelBtn = ctx.el("button", "staging-site-structure-panel__li-cancel", "Cancel");
      cancelBtn.type = "button";
      var actions = ctx.el("div", "staging-site-structure-panel__li-form-actions");
      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      form.appendChild(actions);

      function showView() {
        form.setAttribute("hidden", "");
        view.removeAttribute("hidden");
      }
      function showForm() {
        form.removeAttribute("hidden");
        view.setAttribute("hidden", "");
      }

      editBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        showForm();
      });
      cancelBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        nameIn.value = p.name;
        cbH.checked = Number(p.header) === 1;
        cbF.checked = Number(p.footer) === 1;
        showView();
      });

      saveBtn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var nm = (nameIn.value || "").trim();
        if (!nm) {
          ctx.statusLine.textContent = "Page name cannot be empty.";
          return;
        }
        var nmLower = nm.toLowerCase();
        if (nmLower === "index" || nmLower === "home") {
          ctx.statusLine.textContent = 'Reserved name; homepage is always "index".';
          return;
        }
        fetch(ctx.base + "/api/page", {
          method: "PATCH",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: p.id,
            name: nm,
            header: cbH.checked,
            footer: cbF.checked,
          }),
        })
          .then(function (r) {
            if (!r.ok) {
              return r.text().then(function (t) {
                throw new Error(t || "HTTP " + r.status);
              });
            }
            return ctx.fetchRegistry();
          })
          .then(function () {
            ctx.statusLine.textContent = "Saved page id " + p.id + ".";
            ctx.renderLists();
            ctx.refreshPageSelect();
          })
          .catch(function () {
            ctx.statusLine.textContent =
              "Could not save page (duplicate name or layout API unreachable).";
          });
      });

      del.addEventListener("click", function (ev) {
        ev.preventDefault();
        var rel = "pages/" + pageFileSlug(p.name) + ".html";
        var msg =
          'Remove "' +
          p.name +
          '" from the site registry and delete ' +
          rel +
          "? This cannot be undone except via git.";
        if (!window.confirm(msg)) {
          return;
        }
        fetch(ctx.base + "/api/page?id=" + encodeURIComponent(p.id), {
          method: "DELETE",
          mode: "cors",
        })
          .then(function (r) {
            if (!r.ok) {
              return r.text().then(function (t) {
                throw new Error(t || "HTTP " + r.status);
              });
            }
            return ctx.fetchRegistry();
          })
          .then(function () {
            var removedName = String(p.name || "");
            if (isViewingPage(removedName)) {
              ctx.statusLine.textContent =
                'Removed "' + removedName + '". Opening homepage…';
              navigateToSitePage("index");
              return;
            }
            ctx.statusLine.textContent =
              'Removed page "' + removedName + '" and deleted ' + rel + ".";
            ctx.renderLists();
            ctx.refreshPageSelect();
          })
          .catch(function () {
            ctx.statusLine.textContent = "Could not remove page (is npm run dev:api running?)";
          });
      });

      li.appendChild(view);
      li.appendChild(form);
      return li;
    }

    function renderGroupBlock(g) {
      var section = ctx.el("section", "staging-pages-tree__group");
      section.setAttribute("data-page-group-id", String(g.id));
      section.draggable = true;

      section.addEventListener("dragstart", function (ev) {
        if (ev.dataTransfer) {
          ev.dataTransfer.setData("text/group-id", String(g.id));
          ev.dataTransfer.effectAllowed = "move";
        }
      });

      var head = ctx.el("div", "staging-pages-tree__group-head");
      head.className = "staging-pages-tree__group-head";

      var labelIn = document.createElement("input");
      labelIn.type = "text";
      labelIn.className = "staging-site-structure-panel__input staging-pages-tree__group-label";
      labelIn.value = g.label || "Group";
      labelIn.addEventListener("change", function () {
        fetch(ctx.base + "/api/page-group", {
          method: "PATCH",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: g.id, label: labelIn.value.trim() || "Group" }),
        })
          .then(function (r) {
            if (!r.ok) {
              throw new Error("HTTP " + r.status);
            }
            return ctx.fetchRegistry();
          })
          .then(function () {
            ctx.statusLine.textContent = "Renamed group.";
          })
          .catch(function () {
            ctx.statusLine.textContent = "Could not rename group.";
          });
      });

      var delGroup = ctx.el("button", "staging-site-structure-panel__del", "Delete group");
      delGroup.type = "button";
      delGroup.addEventListener("click", function (ev) {
        ev.preventDefault();
        fetch(ctx.base + "/api/page-group?id=" + encodeURIComponent(g.id), {
          method: "DELETE",
          mode: "cors",
        })
          .then(function (r) {
            if (!r.ok) {
              throw new Error("HTTP " + r.status);
            }
            return ctx.fetchRegistry();
          })
          .then(function () {
            ctx.statusLine.textContent = "Removed group.";
            ctx.renderLists();
            ctx.refreshPageSelect();
          })
          .catch(function () {
            ctx.statusLine.textContent = "Could not remove group.";
          });
      });

      head.appendChild(labelIn);
      head.appendChild(delGroup);
      section.appendChild(head);

      var list = ctx.el("ul", "staging-site-structure-panel__list staging-pages-tree__page-list");
      var gPages = pagesByGroup[g.id] || [];
      for (var pi = 0; pi < gPages.length; pi++) {
        list.appendChild(renderPageRow(gPages[pi]));
      }
      section.appendChild(list);
      wireDropZone(section);
      return section;
    }

    var groupsHost = ctx.el("div", "staging-pages-tree__groups");
    groupsHost.className = "staging-pages-tree__groups";
    groupsHost.addEventListener("dragover", function (ev) {
      ev.preventDefault();
    });
    groupsHost.addEventListener("drop", function (ev) {
      ev.preventDefault();
      var groupId = ev.dataTransfer && ev.dataTransfer.getData("text/group-id");
      if (!groupId) {
        return;
      }
      var dragged = host.querySelector('[data-page-group-id="' + groupId + '"]');
      if (!dragged) {
        return;
      }
      groupsHost.appendChild(dragged);
      void saveOrder();
    });

    for (var i = 0; i < groups.length; i++) {
      groupsHost.appendChild(renderGroupBlock(groups[i]));
    }
    host.appendChild(groupsHost);

    var unSection = ctx.el("section", "staging-pages-tree__group staging-pages-tree__ungrouped");
    unSection.setAttribute("data-page-group-ungrouped", "1");
    var unHead = ctx.el("h3", "staging-pages-tree__ungrouped-title", "Ungrouped");
    unSection.appendChild(unHead);
    var unList = ctx.el("ul", "staging-site-structure-panel__list staging-pages-tree__page-list");
    for (var ui = 0; ui < ungrouped.length; ui++) {
      unList.appendChild(renderPageRow(ungrouped[ui]));
    }
    unSection.appendChild(unList);
    wireDropZone(unSection);
    host.appendChild(unSection);

    addGroupBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      var label = window.prompt("Group name", "Group");
      if (label == null) {
        return;
      }
      fetch(ctx.base + "/api/page-group", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "Group" }),
      })
        .then(function (r) {
          if (!r.ok) {
            throw new Error("HTTP " + r.status);
          }
          return ctx.fetchRegistry();
        })
        .then(function () {
          ctx.statusLine.textContent = "Added group.";
          ctx.renderLists();
        })
        .catch(function () {
          ctx.statusLine.textContent = "Could not add group.";
        });
    });
  }

  window.customdevRenderPagesTree = renderPagesTree;
})();
