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

  function checkLayoutApiReachable(base) {
    return fetch(String(base || "").replace(/\/$/, "") + "/api/registry", { mode: "cors" })
      .then(function (r) {
        return r.ok;
      })
      .catch(function () {
        return false;
      });
  }

  function flushSiteStateToApi() {
    var chain = Promise.resolve();
    if (typeof window.__customdevPublishFlushFrames === "function") {
      chain = chain.then(function () {
        return window.__customdevPublishFlushFrames();
      });
    }
    if (typeof window.__customdevPublishFlushGalleries === "function") {
      chain = chain.then(function () {
        return window.__customdevPublishFlushGalleries();
      });
    }
    return chain;
  }

  /**
   * Save dirty frame/gallery SQLite, publish gallery interaction prefs, reload without staging.
   * @returns {Promise<{ ok: boolean, error?: string, prefs?: object }>}
   */
  function publishSiteToLive() {
    var api = getLayoutApiBase();
    return checkLayoutApiReachable(api)
      .then(function (reachable) {
        if (!reachable) {
          return { ok: false, error: "api_unreachable" };
        }
        try {
          window.dispatchEvent(new CustomEvent(GALLERY_SYNC_SESSION_PREFS_EVENT));
        } catch (eSync) {
          /* ignore */
        }
        return flushSiteStateToApi().then(function () {
          var r = publishAllDraggableGalleryPrefsToLive();
          if (r.err) {
            return { ok: false, error: "localStorage", prefs: r };
          }
          navigateToLiveUrl();
          return { ok: true, prefs: r };
        });
      })
      .catch(function () {
        return { ok: false, error: "api_save" };
      });
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

  /** Fixed bar to the right of “Staging”: save SQLite + publish gallery prefs, then reload live. */
  function addStagingPublishControl() {
    if (document.getElementById("staging-publish")) {
      return;
    }
    var wrap = document.createElement("div");
    wrap.id = "staging-publish";
    wrap.className = "staging-publish";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "staging-publish__btn";
    btn.textContent = "Publish";
    btn.setAttribute(
      "aria-label",
      "Save staging edits to SQLite, publish gallery interaction prefs, and open the live preview",
    );
    btn.setAttribute(
      "title",
      "Saves frame and gallery layout to the local API, copies gallery session prefs to published localStorage, then reloads without ?staging=1.",
    );
    var feedback = document.createElement("p");
    feedback.className = "staging-publish__feedback";
    feedback.setAttribute("aria-live", "polite");
    wrap.appendChild(btn);
    wrap.appendChild(feedback);
    getStagingStatusBar().appendChild(wrap);

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (btn.disabled) {
        return;
      }
      feedback.textContent = "";
      btn.disabled = true;
      feedback.textContent = "Publishing…";
      publishSiteToLive().then(function (result) {
        if (result && result.ok) {
          return;
        }
        btn.disabled = false;
        if (!result || result.error === "api_unreachable") {
          feedback.textContent =
            "Layout API unreachable. Run npm run dev:api, then try Publish again.";
          return;
        }
        if (result.error === "api_save") {
          feedback.textContent =
            "Could not save frame or gallery layout to SQLite. Check dev API logs, then try again.";
          return;
        }
        if (result.error === "localStorage") {
          feedback.textContent =
            "Saved to SQLite, but localStorage blocked (quota or privacy). Gallery gestures may not persist on live.";
          return;
        }
        feedback.textContent = "Publish failed. Try again.";
      });
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

  /** @type {{ pages: Array, galleries: Array, frames: Array } | null} */
  var registryCache = null;

  function dispatchSiteStructureChanged() {
    try {
      window.dispatchEvent(
        new CustomEvent(SITE_STRUCTURE_EVENT, {
          detail: {
            pages: registryCache ? registryCache.pages : [],
            galleries: registryCache ? registryCache.galleries : [],
            frames: registryCache ? registryCache.frames : [],
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
          frames: Array.isArray(data.frames) ? data.frames : [],
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

  function getFrames() {
    return registryCache && Array.isArray(registryCache.frames) ? registryCache.frames : [];
  }

  function addStagingSiteStructureControls() {
    if (document.getElementById("staging-structure-toggle")) {
      return;
    }

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "staging-structure-toggle";
    toggle.className = "staging-structure-toggle";
    toggle.textContent = "Pages / frames / galleries";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "staging-site-structure-panel");
    toggle.setAttribute("title", "Add pages and galleries via local layout API (SQLite SSOT; run npm run dev:api)");

    var panel = document.createElement("div");
    panel.id = "staging-site-structure-panel";
    panel.className = "staging-site-structure-panel";
    panel.setAttribute("hidden", "");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pages, frames, and galleries registry");

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

    var framePageSel = document.createElement("select");
    framePageSel.className = "staging-site-structure-panel__select";
    var frameStructCol = document.createElement("input");
    frameStructCol.type = "number";
    frameStructCol.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
    frameStructCol.min = "1";
    frameStructCol.max = "24";
    frameStructCol.value = "4";
    var frameStructRow = document.createElement("input");
    frameStructRow.type = "number";
    frameStructRow.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
    frameStructRow.min = "1";
    frameStructRow.max = "24";
    frameStructRow.value = "2";
    var frameStructLabel = document.createElement("input");
    frameStructLabel.type = "text";
    frameStructLabel.className = "staging-site-structure-panel__input";
    frameStructLabel.placeholder = "frame label (optional)";
    frameStructLabel.setAttribute("autocomplete", "off");
    var addFrameBtn = el("button", "staging-site-structure-panel__primary", "Add frame");
    addFrameBtn.type = "button";
    var pagesList = el("ul", "staging-site-structure-panel__list");
    var framesList = el("ul", "staging-site-structure-panel__list");
    var galleriesList = el("ul", "staging-site-structure-panel__list");

    var detPage = document.createElement("details");
    detPage.className =
      "staging-site-structure-panel__section staging-site-structure-panel__details";
    var sumPage = document.createElement("summary");
    sumPage.className = "staging-site-structure-panel__summary";
    sumPage.textContent = "Add page";
    detPage.appendChild(sumPage);
    detPage.appendChild(
      labeledInput("staging-struct-page-name", "Name (unique)", pageNameInput),
    );
    detPage.appendChild(labH);
    detPage.appendChild(labF);
    detPage.appendChild(addPageBtn);

    var detGal = document.createElement("details");
    detGal.className =
      "staging-site-structure-panel__section staging-site-structure-panel__details";
    var sumGal = document.createElement("summary");
    sumGal.className = "staging-site-structure-panel__summary";
    sumGal.textContent = "Add gallery";
    detGal.appendChild(sumGal);
    detGal.appendChild(labeledInput("staging-struct-gal-page", "Page", galleryPageSel));
    detGal.appendChild(
      labeledInput("staging-struct-gal-key", "Gallery key (unique per page)", galleryKeyInput),
    );
    detGal.appendChild(labGT);
    detGal.appendChild(labGZ);
    detGal.appendChild(
      labeledInput("staging-struct-zoom-style", "Zoom style", galleryZoomStyleInput),
    );
    detGal.appendChild(labeledInput("staging-struct-cols", "Columns", galleryColInput));
    detGal.appendChild(labeledInput("staging-struct-rows", "Rows", galleryRowInput));
    detGal.appendChild(
      labeledInput("staging-struct-gal-style", "Gallery style", galleryStyleInput),
    );
    detGal.appendChild(
      labeledInput("staging-struct-thumb-style", "Thumbnail style", galleryThumbStyleInput),
    );
    detGal.appendChild(addGalleryBtn);

    var detFrame = document.createElement("details");
    detFrame.className =
      "staging-site-structure-panel__section staging-site-structure-panel__details";
    var sumFrame = document.createElement("summary");
    sumFrame.className = "staging-site-structure-panel__summary";
    sumFrame.textContent = "Add frame";
    detFrame.appendChild(sumFrame);
    detFrame.appendChild(labeledInput("staging-struct-frame-page", "Page", framePageSel));
    detFrame.appendChild(labeledInput("staging-struct-frame-cols", "Columns", frameStructCol));
    detFrame.appendChild(labeledInput("staging-struct-frame-rows", "Rows", frameStructRow));
    detFrame.appendChild(
      labeledInput("staging-struct-frame-label", "Label (staging chip)", frameStructLabel),
    );
    detFrame.appendChild(addFrameBtn);

    var secLists = el("section", "staging-site-structure-panel__section");
    secLists.appendChild(el("h2", "staging-site-structure-panel__h", "Pages"));
    secLists.appendChild(pagesList);
    secLists.appendChild(el("h2", "staging-site-structure-panel__h", "Frames"));
    secLists.appendChild(framesList);
    secLists.appendChild(el("h2", "staging-site-structure-panel__h", "Galleries"));
    secLists.appendChild(galleriesList);

    var closeBtn = el("button", "staging-site-structure-panel__close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");

    var head = el("div", "staging-site-structure-panel__header");
    head.appendChild(el("span", "staging-site-structure-panel__title", "Pages, frames & galleries"));
    head.appendChild(closeBtn);

    panel.appendChild(head);
    panel.appendChild(statusLine);
    panel.appendChild(exportBtn);
    panel.appendChild(detPage);
    panel.appendChild(detGal);
    panel.appendChild(detFrame);
    panel.appendChild(secLists);

    function refreshPageSelect() {
      function fill(sel) {
        while (sel.firstChild) {
          sel.removeChild(sel.firstChild);
        }
        var pages = getPages();
        if (!pages.length) {
          var opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = "— add a page first —";
          sel.appendChild(opt0);
          return;
        }
        for (var i = 0; i < pages.length; i++) {
          var p = pages[i];
          var opt = document.createElement("option");
          opt.value = String(p.id);
          opt.textContent = p.name + " (id " + p.id + ")";
          sel.appendChild(opt);
        }
      }
      fill(galleryPageSel);
      fill(framePageSel);
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
      framesList.innerHTML = "";
      galleriesList.innerHTML = "";
      var pages = getPages();
      var frames = getFrames();
      var galleries = getGalleries();
      var base = getLayoutApiBase();

      for (var i = 0; i < pages.length; i++) {
        (function (p) {
          var li = el("li", "staging-site-structure-panel__li");
          var view = el("div", "staging-site-structure-panel__li-view");
          var summary = el(
            "span",
            "staging-site-structure-panel__li-summary",
            p.name +
              " — header " +
              p.header +
              ", footer " +
              p.footer +
              " (id " +
              p.id +
              ")",
          );
          var editBtn = el("button", "staging-site-structure-panel__li-edit", "Edit");
          editBtn.type = "button";
          var del = el("button", "staging-site-structure-panel__del", "Remove");
          del.type = "button";
          view.appendChild(summary);
          view.appendChild(editBtn);
          view.appendChild(del);

          var form = el("div", "staging-site-structure-panel__li-form");
          form.setAttribute("hidden", "");

          var nameIn = document.createElement("input");
          nameIn.type = "text";
          nameIn.className = "staging-site-structure-panel__input";
          nameIn.value = p.name;
          form.appendChild(
            labeledInput("staging-edit-page-name-" + p.id, "Name", nameIn),
          );

          var cbH = document.createElement("input");
          cbH.type = "checkbox";
          cbH.id = "staging-edit-page-h-" + p.id;
          cbH.checked = Number(p.header) === 1;
          var labEH = el("label", "staging-site-structure-panel__check", "Header");
          labEH.setAttribute("for", cbH.id);
          labEH.insertBefore(cbH, labEH.firstChild);
          form.appendChild(labEH);

          var cbF = document.createElement("input");
          cbF.type = "checkbox";
          cbF.id = "staging-edit-page-f-" + p.id;
          cbF.checked = Number(p.footer) === 1;
          var labEF = el("label", "staging-site-structure-panel__check", "Footer");
          labEF.setAttribute("for", cbF.id);
          labEF.insertBefore(cbF, labEF.firstChild);
          form.appendChild(labEF);

          var saveBtn = el("button", "staging-site-structure-panel__primary", "Save");
          saveBtn.type = "button";
          var cancelBtn = el("button", "staging-site-structure-panel__li-cancel", "Cancel");
          cancelBtn.type = "button";
          var actions = el("div", "staging-site-structure-panel__li-form-actions");
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
              statusLine.textContent = "Page name cannot be empty.";
              return;
            }
            fetch(base + "/api/page", {
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
                return fetchRegistry();
              })
              .then(function () {
                statusLine.textContent = "Saved page id " + p.id + ".";
                renderLists();
                refreshPageSelect();
              })
              .catch(function () {
                statusLine.textContent =
                  "Could not save page (duplicate name or layout API unreachable).";
              });
          });

          del.addEventListener("click", function (ev) {
            ev.preventDefault();
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

          li.appendChild(view);
          li.appendChild(form);
          pagesList.appendChild(li);
        })(pages[i]);
      }

      for (var fi = 0; fi < frames.length; fi++) {
        (function (f) {
          var lab = f.label != null && String(f.label).trim() ? String(f.label).trim() : "—";
          var li = el("li", "staging-site-structure-panel__li");
          var summary = el(
            "span",
            "staging-site-structure-panel__li-summary",
            pageNameById(f.pageId) +
              " — label \"" +
              lab +
              "\" — " +
              f.columnCount +
              "×" +
              f.rowCount +
              " cells (frame id " +
              f.id +
              "). Edit on the page via the frame staging chip.",
          );
          li.appendChild(summary);
          framesList.appendChild(li);
        })(frames[fi]);
      }

      for (var j = 0; j < galleries.length; j++) {
        (function (g) {
          var li = el("li", "staging-site-structure-panel__li");
          var view = el("div", "staging-site-structure-panel__li-view");
          var summary = el(
            "span",
            "staging-site-structure-panel__li-summary",
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
              ")",
          );
          var editBtn = el("button", "staging-site-structure-panel__li-edit", "Edit");
          editBtn.type = "button";
          var del = el("button", "staging-site-structure-panel__del", "Remove");
          del.type = "button";
          view.appendChild(summary);
          view.appendChild(editBtn);
          view.appendChild(del);

          var form = el("div", "staging-site-structure-panel__li-form");
          form.setAttribute("hidden", "");

          var keyIn = document.createElement("input");
          keyIn.type = "text";
          keyIn.className = "staging-site-structure-panel__input";
          keyIn.value = g.galleryKey != null ? String(g.galleryKey) : "default";
          keyIn.setAttribute("spellcheck", "false");
          keyIn.autocomplete = "off";
          form.appendChild(labeledInput("staging-edit-g-key-" + g.id, "Gallery key", keyIn));
          var keyHint = el(
            "p",
            "staging-site-structure-panel__li-readonly",
            "After renaming, set data-gallery-key or createDraggableGallery({ galleryKey }) on the page to match, then reload.",
          );
          form.appendChild(keyHint);

          var cbT = document.createElement("input");
          cbT.type = "checkbox";
          cbT.id = "staging-edit-g-t-" + g.id;
          cbT.checked = Number(g.thumbnail) === 1;
          var labT = el("label", "staging-site-structure-panel__check", "Thumbnail strip");
          labT.setAttribute("for", cbT.id);
          labT.insertBefore(cbT, labT.firstChild);
          form.appendChild(labT);

          var cbZ = document.createElement("input");
          cbZ.type = "checkbox";
          cbZ.id = "staging-edit-g-z-" + g.id;
          cbZ.checked = Number(g.zoom) === 1;
          var labZ = el("label", "staging-site-structure-panel__check", "Zoom");
          labZ.setAttribute("for", cbZ.id);
          labZ.insertBefore(cbZ, labZ.firstChild);
          form.appendChild(labZ);

          var zs = document.createElement("input");
          zs.type = "text";
          zs.className = "staging-site-structure-panel__input";
          zs.value = g.zoomStyle != null ? String(g.zoomStyle) : "";
          form.appendChild(labeledInput("staging-edit-g-zs-" + g.id, "Zoom style", zs));

          var cols = document.createElement("input");
          cols.type = "number";
          cols.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
          cols.min = "1";
          cols.value = String(g.columnCount != null ? g.columnCount : 2);
          form.appendChild(labeledInput("staging-edit-g-cols-" + g.id, "Columns", cols));

          var rows = document.createElement("input");
          rows.type = "number";
          rows.className = "staging-site-structure-panel__input staging-site-structure-panel__input--num";
          rows.min = "1";
          rows.value = String(g.rowCount != null ? g.rowCount : 1);
          form.appendChild(labeledInput("staging-edit-g-rows-" + g.id, "Rows", rows));

          var gsty = document.createElement("input");
          gsty.type = "text";
          gsty.className = "staging-site-structure-panel__input";
          gsty.value = g.galleryStyle != null ? String(g.galleryStyle) : "";
          form.appendChild(labeledInput("staging-edit-g-gsty-" + g.id, "Gallery style", gsty));

          var tsty = document.createElement("input");
          tsty.type = "text";
          tsty.className = "staging-site-structure-panel__input";
          tsty.value = g.thumbnailStyle != null ? String(g.thumbnailStyle) : "";
          form.appendChild(labeledInput("staging-edit-g-tsty-" + g.id, "Thumbnail style", tsty));

          var saveBtn = el("button", "staging-site-structure-panel__primary", "Save");
          saveBtn.type = "button";
          var cancelBtn = el("button", "staging-site-structure-panel__li-cancel", "Cancel");
          cancelBtn.type = "button";
          var actions = el("div", "staging-site-structure-panel__li-form-actions");
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
            keyIn.value = g.galleryKey != null ? String(g.galleryKey) : "default";
            cbT.checked = Number(g.thumbnail) === 1;
            cbZ.checked = Number(g.zoom) === 1;
            zs.value = g.zoomStyle != null ? String(g.zoomStyle) : "";
            cols.value = String(g.columnCount != null ? g.columnCount : 2);
            rows.value = String(g.rowCount != null ? g.rowCount : 1);
            gsty.value = g.galleryStyle != null ? String(g.galleryStyle) : "";
            tsty.value = g.thumbnailStyle != null ? String(g.thumbnailStyle) : "";
            showView();
          });

          saveBtn.addEventListener("click", function (ev) {
            ev.preventDefault();
            fetch(base + "/api/gallery", {
              method: "PATCH",
              mode: "cors",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: g.id,
                galleryKey: (keyIn.value || "").trim() || "default",
                thumbnail: cbT.checked ? 1 : 0,
                zoom: cbZ.checked ? 1 : 0,
                zoomStyle: zs.value.trim(),
                columnCount: parseInt(cols.value, 10) || 2,
                rowCount: parseInt(rows.value, 10) || 1,
                galleryStyle: gsty.value.trim(),
                thumbnailStyle: tsty.value.trim(),
              }),
            })
              .then(function (r) {
                if (r.status === 409) {
                  statusLine.textContent =
                    "That gallery key already exists on this page. Choose a different key.";
                  return Promise.resolve(false);
                }
                if (!r.ok) {
                  return r.text().then(function (t) {
                    throw new Error(t || "HTTP " + r.status);
                  });
                }
                return fetchRegistry().then(function () {
                  return true;
                });
              })
              .then(function (savedOk) {
                if (!savedOk) {
                  return;
                }
                statusLine.textContent = "Saved gallery id " + g.id + ".";
                renderLists();
                refreshPageSelect();
              })
              .catch(function () {
                statusLine.textContent = "Could not save gallery (layout API unreachable).";
              });
          });

          del.addEventListener("click", function (ev) {
            ev.preventDefault();
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

          li.appendChild(view);
          li.appendChild(form);
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

    addFrameBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var pages = getPages();
      if (!pages.length) {
        statusLine.textContent = "Add a page before adding a frame.";
        return;
      }
      var pid = parseInt(framePageSel.value, 10);
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
      var existing = getFrames();
      for (var ei = 0; ei < existing.length; ei++) {
        if (existing[ei].pageId === pid) {
          statusLine.textContent =
            "That page already has a frame (one per page). Remove the page or edit the existing frame.";
          return;
        }
      }
      var base = getLayoutApiBase();
      fetch(base + "/api/frame", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageName: selPage.name,
          columnCount: parseInt(frameStructCol.value, 10) || 4,
          rowCount: parseInt(frameStructRow.value, 10) || 2,
          label: frameStructLabel.value.trim(),
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
          statusLine.textContent = "Added frame on page \"" + selPage.name + "\".";
          renderLists();
        })
        .catch(function () {
          statusLine.textContent =
            "Could not add frame (duplicate frame on page or layout API unreachable).";
        });
    });

    exportBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var payload = {
        pages: getPages(),
        galleries: getGalleries(),
        frames: getFrames(),
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

    window.addEventListener("customdev-request-registry-refresh", function () {
      fetchRegistry(
        function () {
          renderLists();
          refreshPageSelect();
        },
        function () {},
      );
    });

    getStagingStatusBar().appendChild(toggle);
    document.body.appendChild(panel);
  }

  /** Syncs `--staging-status-bar-height` so `html.staging body` padding clears the fixed bar (see `staging.css`). */
  function syncStagingToolbarHeightCssVar() {
    try {
      var bar = document.getElementById(STAGING_STATUS_BAR_ID);
      if (!bar) {
        return;
      }
      var h = bar.getBoundingClientRect().height;
      if (!h || h < 12) {
        h = 44;
      }
      document.documentElement.style.setProperty(
        "--staging-status-bar-height",
        Math.ceil(h) + "px",
      );
    } catch (e) {
      /* ignore */
    }
  }

  function onStagingDomReady() {
    addStagingModeLabel();
    addStagingPublishControl();
    addStagingSiteStructureControls();
    appendStagingToInternalLinks();
    function wireToolbarHeightSync() {
      syncStagingToolbarHeightCssVar();
      try {
        var bar = document.getElementById(STAGING_STATUS_BAR_ID);
        if (bar && typeof ResizeObserver !== "undefined") {
          new ResizeObserver(syncStagingToolbarHeightCssVar).observe(bar);
        }
      } catch (e1) {
        /* ignore */
      }
      window.addEventListener("resize", syncStagingToolbarHeightCssVar);
    }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(wireToolbarHeightSync);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onStagingDomReady);
  } else {
    onStagingDomReady();
  }
})();
