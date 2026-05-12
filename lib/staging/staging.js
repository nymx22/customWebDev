(function () {
  var STAGING_QUERY = "staging";
  /** Legacy key: cleared on live loads so staging is never inferred from storage. */
  var STORAGE_KEY = "customdev_staging";

  /**
   * Canonical / production deploy: no Live↔Staging affordances; `?staging=1` is ignored.
   * Set on `<html data-official-live="true">` or `data-official-live="1"` (see index.html), or `<meta name="customdev-official-live" content="true">` / `1`.
   */
  function isOfficialLiveSite() {
    try {
      var dl = document.documentElement.getAttribute("data-official-live");
      if (dl === "true" || dl === "1") {
        return true;
      }
      var m = document.querySelector('meta[name="customdev-official-live"]');
      var mc = m && String(m.getAttribute("content") || "").trim().toLowerCase();
      if (mc === "true" || mc === "1") {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  try {
    if (isOfficialLiveSite()) {
      document.documentElement.classList.add("official-live");
    }
  } catch (eClass) {
    /* ignore */
  }

  /** Must match `STAGING_GALLERY_SETTINGS_EVENT` in `js/web-dev-base/gallery-core/gallery-core.js`. */
  var GALLERY_SETTINGS_EVENT = "customdev-staging-gallery-settings";
  /** Must match `STAGING_GALLERY_SYNC_SESSION_PREFS_EVENT` in gallery-core (flush panel → session before publish). */
  var GALLERY_SYNC_SESSION_PREFS_EVENT = "customdev-staging-gallery-sync-session-prefs";

  function stagingGalleryPrefsStorageKey(id) {
    return "customdev_staging_gallery_prefs_" + id;
  }

  function publishedGalleryPrefsStorageKey(id) {
    return "customdev_gallery_prefs_published_" + id;
  }

  function galleryStorageIdFromRoot(root) {
    if (!root) return "";
    var id = root.id && String(root.id).trim();
    if (id) return id;
    var attr = root.getAttribute && root.getAttribute("data-staging-gallery-storage-id");
    return attr ? String(attr) : "";
  }

  function publishAllDraggableGalleryPrefsToLive() {
    var roots = document.querySelectorAll(".draggable-gallery");
    var n = 0;
    var err = false;
    for (var i = 0; i < roots.length; i++) {
      var gid = galleryStorageIdFromRoot(roots[i]);
      if (!gid) continue;
      var raw = null;
      try {
        raw = window.sessionStorage.getItem(stagingGalleryPrefsStorageKey(gid));
      } catch (e0) {
        raw = null;
      }
      if (!raw) continue;
      try {
        window.localStorage.setItem(publishedGalleryPrefsStorageKey(gid), raw);
        n++;
        try {
          window.dispatchEvent(
            new CustomEvent(GALLERY_SETTINGS_EVENT, { detail: { galleryStorageId: gid } }),
          );
        } catch (e1) {
          /* ignore */
        }
      } catch (e2) {
        err = true;
      }
    }
    return { count: n, err: err, roots: roots.length };
  }

  /** Fixed top-left bar: Staging badge + publish (see `staging-status-bar` in `staging.css`). */
  var STAGING_STATUS_BAR_ID = "staging-status-bar";

  function getStagingStatusBar() {
    var bar = document.getElementById(STAGING_STATUS_BAR_ID);
    if (bar) {
      return bar;
    }
    bar = document.createElement("div");
    bar.id = STAGING_STATUS_BAR_ID;
    bar.className = "staging-status-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Staging preview controls");
    document.body.appendChild(bar);
    return bar;
  }

  function readStagingFromSearch() {
    try {
      var params = new URLSearchParams(window.location.search);
      var v = params.get(STAGING_QUERY);
      if (v === "1") return "on";
      if (v === "0" || v === "false") return "off";
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /** Hash survives some redirects better than search (e.g. / → /index.html). */
  function readStagingFromHash() {
    try {
      var hash = window.location.hash;
      if (!hash || hash.length < 2) return null;
      var params = new URLSearchParams(hash.slice(1));
      var v = params.get(STAGING_QUERY);
      if (v === "1") return "on";
      if (v === "0" || v === "false") return "off";
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  var fromSearch = readStagingFromSearch();
  var fromHash = readStagingFromHash();
  var fromUrl = fromSearch || fromHash;

  if (fromUrl !== "on") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function isStagingEnabled() {
    if (isOfficialLiveSite()) {
      return false;
    }
    return fromUrl === "on";
  }

  /** Same path + query + hash, with `staging=1` (for live → staging preview). */
  function navigateToStagingUrl() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set(STAGING_QUERY, "1");
      var qs = u.searchParams.toString();
      u.search = qs ? "?" + qs : "";
      window.location.assign(u.pathname + u.search + u.hash);
    } catch (e) {
      try {
        window.location.href =
          window.location.pathname +
          (window.location.search
            ? window.location.search + "&staging=1"
            : "?staging=1") +
          window.location.hash;
      } catch (e2) {
        window.location.assign("?staging=1");
      }
    }
  }

  /** Live only: fixed control to open this page in staging (?staging=1). */
  function addStagingEnterButton() {
    if (document.getElementById("staging-enter-button")) {
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "staging-enter-button";
    btn.className = "staging-enter-button";
    btn.textContent = "Live";
    btn.setAttribute("aria-label", "Live site — switch to staging preview");
    btn.setAttribute("title", "Open staging preview (?staging=1)");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      navigateToStagingUrl();
    });
    document.body.appendChild(btn);
  }

  if (!isStagingEnabled()) {
    function onLiveDomReady() {
      if (!isOfficialLiveSite()) {
        addStagingEnterButton();
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", onLiveDomReady);
    } else {
      onLiveDomReady();
    }
    return;
  }

  document.documentElement.classList.add("staging");

  /** Reload this URL without staging (live). */
  function navigateToLiveUrl() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete("staging");
      var qs = u.searchParams.toString();
      u.search = qs ? "?" + qs : "";
      if (u.hash && u.hash.indexOf("=") > -1) {
        try {
          var hp = new URLSearchParams(u.hash.slice(1));
          if (hp.has("staging")) {
            hp.delete("staging");
            var hs = hp.toString();
            u.hash = hs ? "#" + hs : "";
          }
        } catch (e2) {
          /* ignore */
        }
      }
      window.location.assign(u.pathname + u.search + u.hash);
    } catch (e) {
      window.location.reload();
    }
  }

  /** Top-left status: “Staging” — click exits to live. */
  function addStagingModeLabel() {
    if (document.getElementById("staging-mode-label")) {
      return;
    }
    var el = document.createElement("button");
    el.type = "button";
    el.id = "staging-mode-label";
    el.className = "staging-mode-label";
    el.textContent = "Staging";
    el.setAttribute("aria-label", "Staging preview — switch to live site");
    el.setAttribute("title", "Live site — click to remove staging from the URL");
    el.addEventListener("click", function (e) {
      e.preventDefault();
      navigateToLiveUrl();
    });
    getStagingStatusBar().appendChild(el);
  }

  function shouldAnnotatePathname(pathname) {
    if (!pathname) return false;
    return !/\.(css|js|mjs|ttf|woff2?|jpe?g|png|gif|webp|svg|ico|pdf|map|json|xml|txt)$/i.test(pathname);
  }

  /** Same-origin navigation only; adds ?staging=1 so other HTML pages keep staging in the URL. */
  function appendStagingToInternalLinks() {
    if (!document.body) return;
    try {
      var origin = window.location.origin;
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var href = a.getAttribute("href");
        if (!href) continue;
        if (href.charAt(0) === "#") continue;
        if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
        var resolved;
        try {
          resolved = new URL(href, window.location.href);
        } catch (err) {
          continue;
        }
        if (resolved.origin !== origin) continue;
        if (!shouldAnnotatePathname(resolved.pathname)) continue;
        var existing = resolved.searchParams.get(STAGING_QUERY);
        if (existing === "1") continue;
        if (existing === "0" || existing === "false") continue;
        resolved.searchParams.set(STAGING_QUERY, "1");
        a.setAttribute("href", resolved.pathname + resolved.search + resolved.hash);
      }
    } catch (e) {
      /* ignore */
    }
  }

  /** Fixed bar to the right of “Staging”: copy every `.draggable-gallery` session prefs JSON to published `localStorage` keys (see gallery-core). */
  function addStagingGalleryPublishControl() {
    if (document.getElementById("staging-gallery-publish")) {
      return;
    }
    var wrap = document.createElement("div");
    wrap.id = "staging-gallery-publish";
    wrap.className = "staging-gallery-publish";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "staging-gallery-publish__btn";
    btn.textContent = "Publish galleries to live";
    btn.setAttribute(
      "aria-label",
      "Copy gallery testing session preferences to live storage for this browser",
    );
    btn.setAttribute("title", "Writes customdev_gallery_prefs_published_* from session; reload without staging to use on live.");
    var feedback = document.createElement("p");
    feedback.className = "staging-gallery-publish__feedback";
    feedback.setAttribute("aria-live", "polite");
    wrap.appendChild(btn);
    wrap.appendChild(feedback);
    getStagingStatusBar().appendChild(wrap);

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      feedback.textContent = "";
      try {
        window.dispatchEvent(new CustomEvent(GALLERY_SYNC_SESSION_PREFS_EVENT));
      } catch (err) {
        /* ignore */
      }
      var r = publishAllDraggableGalleryPrefsToLive();
      if (r.err) {
        feedback.textContent =
          "Could not write localStorage (quota or blocked). Some galleries may not have been saved.";
        return;
      }
      if (r.count > 0) {
        feedback.textContent =
          "Published " +
          r.count +
          " gallery snapshot(s). Reload without staging in the URL to use them on live.";
        return;
      }
      if (r.roots === 0) {
        feedback.textContent = "No draggable galleries on this page.";
        return;
      }
      feedback.textContent =
        "No saved gallery prefs in session yet. Open each gallery’s “Gallery testing” panel and change an option (or reload after adjusting).";
    });
  }

  var SITE_STRUCTURE_EVENT = "customdev-staging-site-structure-changed";

  function getLayoutApiBase() {
    if (typeof window.__CUSTOMDEV_LAYOUT_API__ === "string" && window.__CUSTOMDEV_LAYOUT_API__.trim()) {
      return window.__CUSTOMDEV_LAYOUT_API__.trim().replace(/\/$/, "");
    }
    var m = document.querySelector('meta[name="customdev-layout-api"]');
    if (m && m.getAttribute("content") && String(m.getAttribute("content")).trim()) {
      return String(m.getAttribute("content")).trim().replace(/\/$/, "");
    }
    return "http://127.0.0.1:8787";
  }

  /** @type {{ pages: Array, galleries: Array } | null} */
  var registryCache = null;

  function dispatchSiteStructureChanged() {
    try {
      window.dispatchEvent(
        new CustomEvent(SITE_STRUCTURE_EVENT, {
          detail: {
            pages: registryCache ? registryCache.pages : [],
            galleries: registryCache ? registryCache.galleries : [],
          },
        }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  function fetchRegistry(done, err) {
    var base = getLayoutApiBase();
    return fetch(base + "/api/registry", { mode: "cors" })
      .then(function (r) {
        if (!r.ok) {
          throw new Error("HTTP " + r.status);
        }
        return r.json();
      })
      .then(function (data) {
        registryCache = {
          pages: Array.isArray(data.pages) ? data.pages : [],
          galleries: Array.isArray(data.galleries) ? data.galleries : [],
        };
        dispatchSiteStructureChanged();
        if (typeof done === "function") {
          done(registryCache);
        }
        return registryCache;
      })
      .catch(function (e) {
        registryCache = null;
        if (typeof err === "function") {
          err(e);
        }
        throw e;
      });
  }

  function getPages() {
    return registryCache && Array.isArray(registryCache.pages) ? registryCache.pages : [];
  }

  function getGalleries() {
    return registryCache && Array.isArray(registryCache.galleries) ? registryCache.galleries : [];
  }

  function addStagingSiteStructureControls() {
    if (document.getElementById("staging-structure-toggle")) {
      return;
    }

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "staging-structure-toggle";
    toggle.className = "staging-structure-toggle";
    toggle.textContent = "Pages / galleries";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "staging-site-structure-panel");
    toggle.setAttribute("title", "Add pages and galleries via local layout API (SQLite SSOT; run npm run dev:api)");

    var panel = document.createElement("div");
    panel.id = "staging-site-structure-panel";
    panel.className = "staging-site-structure-panel";
    panel.setAttribute("hidden", "");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pages and galleries registry");

    var statusLine = document.createElement("p");
    statusLine.className = "staging-site-structure-panel__status";
    statusLine.setAttribute("aria-live", "polite");

    var exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "staging-site-structure-panel__export";
    exportBtn.textContent = "Download registry JSON";

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) {
        n.className = cls;
      }
      if (text != null && text !== "") {
        n.textContent = text;
      }
      return n;
    }

    function labeledInput(id, labelText, inputEl) {
      var wrap = el("div", "staging-site-structure-panel__field");
      var lab = el("label", "staging-site-structure-panel__label", labelText);
      lab.setAttribute("for", id);
      inputEl.id = id;
      wrap.appendChild(lab);
      wrap.appendChild(inputEl);
      return wrap;
    }

    var pageNameInput = document.createElement("input");
    pageNameInput.type = "text";
    pageNameInput.className = "staging-site-structure-panel__input";
    pageNameInput.setAttribute("autocomplete", "off");
    pageNameInput.placeholder = "e.g. my-project";

    var cbPageHeader = document.createElement("input");
    cbPageHeader.type = "checkbox";
    cbPageHeader.checked = true;
    var labH = el("label", "staging-site-structure-panel__check", "Header");
    labH.insertBefore(cbPageHeader, labH.firstChild);

    var cbPageFooter = document.createElement("input");
    cbPageFooter.type = "checkbox";
    cbPageFooter.checked = true;
    var labF = el("label", "staging-site-structure-panel__check", "Footer");
    labF.insertBefore(cbPageFooter, labF.firstChild);

    var addPageBtn = el("button", "staging-site-structure-panel__primary", "Add page");
    addPageBtn.type = "button";

    var galleryPageSel = document.createElement("select");
    galleryPageSel.className = "staging-site-structure-panel__select";

    var galleryKeyInput = document.createElement("input");
    galleryKeyInput.type = "text";
    galleryKeyInput.className = "staging-site-structure-panel__input";
    galleryKeyInput.placeholder = "default";
    galleryKeyInput.value = "default";

    var cbGThumb = document.createElement("input");
    cbGThumb.type = "checkbox";
    cbGThumb.checked = true;
    var labGT = el("label", "staging-site-structure-panel__check", "Thumbnail strip");
    labGT.insertBefore(cbGThumb, labGT.firstChild);

    var cbGZoom = document.createElement("input");
    cbGZoom.type = "checkbox";
    cbGZoom.checked = true;
    var labGZ = el("label", "staging-site-structure-panel__check", "Zoom");
    labGZ.insertBefore(cbGZoom, labGZ.firstChild);

    var galleryZoomStyleInput = document.createElement("input");
    galleryZoomStyleInput.type = "text";
    galleryZoomStyleInput.className = "staging-site-structure-panel__input";
    galleryZoomStyleInput.placeholder = "e.g. bookflip";

    var galleryColInput = document.createElement("input");
    galleryColInput.type = "number";
    galleryColInput.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
    galleryColInput.min = "1";
    galleryColInput.value = "2";

    var galleryRowInput = document.createElement("input");
    galleryRowInput.type = "number";
    galleryRowInput.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
    galleryRowInput.min = "1";
    galleryRowInput.value = "1";

    var galleryStyleInput = document.createElement("input");
    galleryStyleInput.type = "text";
    galleryStyleInput.className = "staging-site-structure-panel__input";
    galleryStyleInput.placeholder = "gallery_style";

    var galleryThumbStyleInput = document.createElement("input");
    galleryThumbStyleInput.type = "text";
    galleryThumbStyleInput.className = "staging-site-structure-panel__input";
    galleryThumbStyleInput.placeholder = "thumbnail_style";

    var addGalleryBtn = el("button", "staging-site-structure-panel__primary", "Add gallery");
    addGalleryBtn.type = "button";

    var pagesList = el("ul", "staging-site-structure-panel__list");
    var galleriesList = el("ul", "staging-site-structure-panel__list");

    var secPage = el("section", "staging-site-structure-panel__section");
    secPage.appendChild(el("h2", "staging-site-structure-panel__h", "Add page"));
    secPage.appendChild(
      labeledInput("staging-struct-page-name", "Name (unique)", pageNameInput),
    );
    secPage.appendChild(labH);
    secPage.appendChild(labF);
    secPage.appendChild(addPageBtn);

    var secGal = el("section", "staging-site-structure-panel__section");
    secGal.appendChild(el("h2", "staging-site-structure-panel__h", "Add gallery"));
    secGal.appendChild(labeledInput("staging-struct-gal-page", "Page", galleryPageSel));
    secGal.appendChild(
      labeledInput("staging-struct-gal-key", "Gallery key (unique per page)", galleryKeyInput),
    );
    secGal.appendChild(labGT);
    secGal.appendChild(labGZ);
    secGal.appendChild(
      labeledInput("staging-struct-zoom-style", "Zoom style", galleryZoomStyleInput),
    );
    secGal.appendChild(labeledInput("staging-struct-cols", "Columns", galleryColInput));
    secGal.appendChild(labeledInput("staging-struct-rows", "Rows", galleryRowInput));
    secGal.appendChild(
      labeledInput("staging-struct-gal-style", "Gallery style", galleryStyleInput),
    );
    secGal.appendChild(
      labeledInput("staging-struct-thumb-style", "Thumbnail style", galleryThumbStyleInput),
    );
    secGal.appendChild(addGalleryBtn);

    var secLists = el("section", "staging-site-structure-panel__section");
    secLists.appendChild(el("h2", "staging-site-structure-panel__h", "Pages"));
    secLists.appendChild(pagesList);
    secLists.appendChild(el("h2", "staging-site-structure-panel__h", "Galleries"));
    secLists.appendChild(galleriesList);

    var closeBtn = el("button", "staging-site-structure-panel__close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");

    var head = el("div", "staging-site-structure-panel__header");
    head.appendChild(el("span", "staging-site-structure-panel__title", "Pages & galleries"));
    head.appendChild(closeBtn);

    panel.appendChild(head);
    panel.appendChild(statusLine);
    panel.appendChild(exportBtn);
    panel.appendChild(secPage);
    panel.appendChild(secGal);
    panel.appendChild(secLists);

    function refreshPageSelect() {
      while (galleryPageSel.firstChild) {
        galleryPageSel.removeChild(galleryPageSel.firstChild);
      }
      var pages = getPages();
      if (!pages.length) {
        var opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "— add a page first —";
        galleryPageSel.appendChild(opt0);
        return;
      }
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        var opt = document.createElement("option");
        opt.value = String(p.id);
        opt.textContent = p.name + " (id " + p.id + ")";
        galleryPageSel.appendChild(opt);
      }
    }

    function pageNameById(pid) {
      var pages = getPages();
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].id === pid) {
          return pages[i].name;
        }
      }
      return "#" + pid;
    }

    function renderLists() {
      pagesList.innerHTML = "";
      galleriesList.innerHTML = "";
      var pages = getPages();
      var galleries = getGalleries();
      for (var i = 0; i < pages.length; i++) {
        (function (p) {
          var li = el("li", "staging-site-structure-panel__li");
          li.textContent =
            p.name +
            " — header " +
            p.header +
            ", footer " +
            p.footer +
            " (id " +
            p.id +
            ")";
          var del = el("button", "staging-site-structure-panel__del", "Remove");
          del.type = "button";
          del.addEventListener("click", function (ev) {
            ev.preventDefault();
            var base = getLayoutApiBase();
            fetch(base + "/api/page?id=" + encodeURIComponent(p.id), { method: "DELETE", mode: "cors" })
              .then(function (r) {
                if (!r.ok) {
                  throw new Error("HTTP " + r.status);
                }
                return fetchRegistry();
              })
              .then(function () {
                statusLine.textContent = "Removed page \"" + p.name + "\" and its galleries.";
                renderLists();
                refreshPageSelect();
              })
              .catch(function () {
                statusLine.textContent = "Could not remove page (is npm run dev:api running?)";
              });
          });
          li.appendChild(del);
          pagesList.appendChild(li);
        })(pages[i]);
      }
      for (var j = 0; j < galleries.length; j++) {
        (function (g) {
          var li = el("li", "staging-site-structure-panel__li");
          li.textContent =
            pageNameById(g.pageId) +
            " / " +
            g.galleryKey +
            " — thumb " +
            g.thumbnail +
            ", zoom " +
            g.zoom +
            ", cols " +
            g.columnCount +
            ", rows " +
            g.rowCount +
            " (id " +
            g.id +
            ")";
          var del = el("button", "staging-site-structure-panel__del", "Remove");
          del.type = "button";
          del.addEventListener("click", function (ev) {
            ev.preventDefault();
            var base = getLayoutApiBase();
            fetch(base + "/api/gallery?id=" + encodeURIComponent(g.id), { method: "DELETE", mode: "cors" })
              .then(function (r) {
                if (!r.ok) {
                  throw new Error("HTTP " + r.status);
                }
                return fetchRegistry();
              })
              .then(function () {
                statusLine.textContent = "Removed gallery id " + g.id + ".";
                renderLists();
              })
              .catch(function () {
                statusLine.textContent = "Could not remove gallery (is the layout API running?)";
              });
          });
          li.appendChild(del);
          galleriesList.appendChild(li);
        })(galleries[j]);
      }
    }

    addPageBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var name = (pageNameInput.value || "").trim();
      if (!name) {
        statusLine.textContent = "Enter a page name.";
        return;
      }
      var pages = getPages();
      var lower = name.toLowerCase();
      for (var i = 0; i < pages.length; i++) {
        if (String(pages[i].name).toLowerCase() === lower) {
          statusLine.textContent = "That page name already exists.";
          return;
        }
      }
      var base = getLayoutApiBase();
      fetch(base + "/api/page", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          header: cbPageHeader.checked,
          footer: cbPageFooter.checked,
        }),
      })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error(t || "HTTP " + r.status);
            });
          }
          return fetchRegistry();
        })
        .then(function () {
          pageNameInput.value = "";
          statusLine.textContent = "Added page \"" + name + "\".";
          renderLists();
          refreshPageSelect();
        })
        .catch(function () {
          statusLine.textContent = "Could not add page (duplicate name or layout API unreachable).";
        });
    });

    addGalleryBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var pages = getPages();
      if (!pages.length) {
        statusLine.textContent = "Add a page before adding a gallery.";
        return;
      }
      var pid = parseInt(galleryPageSel.value, 10);
      if (!pid) {
        statusLine.textContent = "Choose a page.";
        return;
      }
      var selPage = null;
      for (var pi = 0; pi < pages.length; pi++) {
        if (pages[pi].id === pid) {
          selPage = pages[pi];
          break;
        }
      }
      if (!selPage) {
        statusLine.textContent = "Choose a page.";
        return;
      }
      var gkey = (galleryKeyInput.value || "").trim() || "default";
      var galleries = getGalleries();
      var lowerK = gkey.toLowerCase();
      for (var j = 0; j < galleries.length; j++) {
        if (galleries[j].pageId === pid && String(galleries[j].galleryKey).toLowerCase() === lowerK) {
          statusLine.textContent = "That gallery key already exists on this page.";
          return;
        }
      }
      var base = getLayoutApiBase();
      fetch(base + "/api/gallery", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageName: selPage.name,
          galleryKey: gkey,
          thumbnail: cbGThumb.checked,
          zoom: cbGZoom.checked,
          zoomStyle: galleryZoomStyleInput.value.trim(),
          columnCount: parseInt(galleryColInput.value, 10) || 2,
          rowCount: parseInt(galleryRowInput.value, 10) || 1,
          galleryStyle: galleryStyleInput.value.trim(),
          thumbnailStyle: galleryThumbStyleInput.value.trim(),
        }),
      })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error(t || "HTTP " + r.status);
            });
          }
          return fetchRegistry();
        })
        .then(function () {
          statusLine.textContent = "Added gallery \"" + gkey + "\" on page \"" + selPage.name + "\".";
          renderLists();
        })
        .catch(function () {
          statusLine.textContent = "Could not add gallery (duplicate key or layout API unreachable).";
        });
    });

    exportBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var payload = {
        pages: getPages(),
        galleries: getGalleries(),
        exportedAt: new Date().toISOString(),
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "staging-registry.json";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
      statusLine.textContent = "Downloaded staging-registry.json";
    });

    function setPanelOpen(open) {
      if (open) {
        panel.removeAttribute("hidden");
        toggle.setAttribute("aria-expanded", "true");
      } else {
        panel.setAttribute("hidden", "");
        toggle.setAttribute("aria-expanded", "false");
      }
    }

    toggle.addEventListener("click", function (e) {
      e.preventDefault();
      setPanelOpen(panel.hasAttribute("hidden"));
      if (!panel.hasAttribute("hidden")) {
        statusLine.textContent = "Loading…";
        fetchRegistry(
          function () {
            statusLine.textContent = "";
            renderLists();
            refreshPageSelect();
          },
          function () {
            statusLine.textContent =
              "Layout API unreachable. Run npm run dev:api (see lib/staging/staging.txt).";
            renderLists();
            refreshPageSelect();
          },
        );
      }
    });

    closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      setPanelOpen(false);
    });

    getStagingStatusBar().appendChild(toggle);
    document.body.appendChild(panel);
  }

  function onStagingDomReady() {
    addStagingModeLabel();
    addStagingGalleryPublishControl();
    addStagingSiteStructureControls();
    appendStagingToInternalLinks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onStagingDomReady);
  } else {
    onStagingDomReady();
  }
})();
