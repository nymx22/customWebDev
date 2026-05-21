(function () {
  var STAGING_QUERY = "staging";
  /** Legacy key: cleared on live loads so staging is never inferred from storage. */
  var STORAGE_KEY = "customdev_staging";

  /** Site-wide dev override (set from staging toolbar); unset = use per-page HTML only. */
  var OFFICIAL_LIVE_STORAGE_KEY = "customdev_official_live";

  /** Staging panel chrome: `dark` (default) | `light` (inverted B&W). */
  var CHROME_THEME_STORAGE_KEY = "customdev_staging_chrome_theme";

  /**
   * @param {string | null | undefined} raw
   * @returns {boolean | null}
   */
  function parseOfficialLiveFlag(raw) {
    if (raw == null) {
      return null;
    }
    var s = String(raw).trim().toLowerCase();
    if (!s) {
      return true;
    }
    if (s === "true" || s === "1" || s === "yes" || s === "on") {
      return true;
    }
    if (s === "false" || s === "0" || s === "no" || s === "off") {
      return false;
    }
    return null;
  }

  function readOfficialLiveStorageOverride() {
    try {
      if (!document.documentElement.classList.contains("staging")) {
        return null;
      }
      return parseOfficialLiveFlag(window.localStorage.getItem(OFFICIAL_LIVE_STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  /**
   * Canonical / production deploy: no Live↔Staging affordances; `?staging=1` is ignored.
   * Per-page: `<html data-official-live="true|false">` or `<meta name="customdev-official-live">`.
   * Site-wide (local dev): `localStorage.customdev_official_live` = `1` | `0` overrides HTML.
   */
  function isOfficialLiveSite() {
    var fromStorage = readOfficialLiveStorageOverride();
    if (fromStorage !== null) {
      return fromStorage;
    }
    try {
      var el = document.documentElement;
      if (el.hasAttribute("data-official-live")) {
        var fromAttr = parseOfficialLiveFlag(el.getAttribute("data-official-live"));
        if (fromAttr !== null) {
          return fromAttr;
        }
        return true;
      }
      var m = document.querySelector('meta[name="customdev-official-live"]');
      if (m) {
        var fromMeta = parseOfficialLiveFlag(m.getAttribute("content"));
        if (fromMeta !== null) {
          return fromMeta;
        }
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function syncOfficialLiveDocumentClass() {
    try {
      /* ?staging=1 keeps full editing chrome even when the page is marked official-live. */
      if (document.documentElement.classList.contains("staging")) {
        document.documentElement.classList.remove("official-live");
        return;
      }
      if (isOfficialLiveSite()) {
        document.documentElement.classList.add("official-live");
      } else {
        document.documentElement.classList.remove("official-live");
      }
    } catch (eClass) {
      /* ignore */
    }
  }

  function removeStagingEnterButton() {
    var btn = document.getElementById("staging-enter-button");
    if (btn && btn.parentNode) {
      btn.parentNode.removeChild(btn);
    }
  }

  syncOfficialLiveDocumentClass();

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

  function exportLayoutBaked(api) {
    return fetch(api + "/api/export-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: "{}",
    })
      .then(function (r) {
        if (!r.ok) {
          return { ok: false, error: "export_http_" + r.status };
        }
        return r.json().then(function (data) {
          return { ok: true, data: data };
        });
      })
      .catch(function () {
        return { ok: false, error: "export_unreachable" };
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
          return exportLayoutBaked(api).then(function (bake) {
            var r = publishAllDraggableGalleryPrefsToLive();
            if (r.err) {
              return { ok: false, error: "localStorage", prefs: r, bake: bake };
            }
            navigateToLiveUrl();
            return { ok: true, prefs: r, bake: bake };
          });
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
    if (fromUrl === "on") {
      return true;
    }
    if (isOfficialLiveSite()) {
      return false;
    }
    return false;
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
      syncOfficialLiveDocumentClass();
      removeStagingEnterButton();
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
  syncOfficialLiveDocumentClass();

  function syncStagingChromeThemeClass() {
    try {
      var theme = window.localStorage.getItem(CHROME_THEME_STORAGE_KEY);
      document.documentElement.classList.toggle(
        "staging-chrome-light",
        theme === "light",
      );
    } catch (eTheme) {
      document.documentElement.classList.remove("staging-chrome-light");
    }
  }

  syncStagingChromeThemeClass();

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

  /**
   * Same-origin HTML navigation href with ?staging=1, or null when unchanged / skipped.
   * @param {string} href
   * @returns {string | null}
   */
  function resolveStagingNavHref(href) {
    if (!href || href.charAt(0) === "#") return null;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return null;
    var resolved;
    try {
      resolved = new URL(href, window.location.href);
    } catch (err) {
      return null;
    }
    if (resolved.origin !== window.location.origin) return null;
    if (!shouldAnnotatePathname(resolved.pathname)) return null;
    var existing = resolved.searchParams.get(STAGING_QUERY);
    if (existing === "0" || existing === "false") return null;
    if (existing !== "1") {
      resolved.searchParams.set(STAGING_QUERY, "1");
    }
    return resolved.pathname + resolved.search + resolved.hash;
  }

  /** @param {HTMLAnchorElement} a */
  function annotateStagingAnchor(a) {
    var href = a.getAttribute("href");
    if (!href) return;
    var next = resolveStagingNavHref(href);
    if (next && a.getAttribute("href") !== next) {
      a.setAttribute("href", next);
    }
  }

  /** Same-origin navigation only; adds ?staging=1 so other HTML pages keep staging in the URL. */
  function appendStagingToInternalLinks() {
    if (!document.body) return;
    try {
      var links = document.querySelectorAll("a[href]");
      for (var i = 0; i < links.length; i++) {
        annotateStagingAnchor(links[i]);
      }
    } catch (e) {
      /* ignore */
    }
  }

  var stagingLinkScanTimer = 0;

  function scheduleStagingLinkScan() {
    if (stagingLinkScanTimer) {
      window.clearTimeout(stagingLinkScanTimer);
    }
    stagingLinkScanTimer = window.setTimeout(function () {
      stagingLinkScanTimer = 0;
      appendStagingToInternalLinks();
    }, 50);
  }

  /** Clicks + late DOM (frame cells, project nav) must not drop ?staging=1. */
  function installStagingLinkNavigationGuard() {
    document.addEventListener(
      "click",
      function (e) {
        if (!document.documentElement.classList.contains("staging")) return;
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var a = t.closest("a[href]");
        if (!a || a.hasAttribute("download")) return;
        var raw = a.getAttribute("href");
        if (!raw) return;
        var next = resolveStagingNavHref(raw);
        if (!next) return;
        annotateStagingAnchor(a);
        if (a.target === "_blank") return;
        var resolved;
        try {
          resolved = new URL(raw, window.location.href);
        } catch (err) {
          return;
        }
        if (resolved.searchParams.get(STAGING_QUERY) === "1") return;
        e.preventDefault();
        window.location.assign(next);
      },
      true,
    );

    if (typeof MutationObserver === "undefined") {
      return;
    }
    function observe() {
      if (!document.body) return;
      var obs = new MutationObserver(scheduleStagingLinkScan);
      obs.observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) {
      observe();
    } else {
      document.addEventListener("DOMContentLoaded", observe);
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
      "Save to SQLite, bake data/layout JSON for deploy, publish gallery prefs, reload live",
    );
    btn.setAttribute(
      "title",
      "Saves this page and any other pages you edited in staging (session) to SQLite, runs POST /api/export-layout (data/layout/*.json), copies gallery session prefs to published localStorage, then reloads without ?staging=1.",
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

  /** @type {{ pages: Array, groups: Array, galleries: Array, frames: Array, homePageId: number | null, homePageName: string | null } | null} */
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
          groups: Array.isArray(data.groups) ? data.groups : [],
          galleries: Array.isArray(data.galleries) ? data.galleries : [],
          frames: Array.isArray(data.frames) ? data.frames : [],
          homePageId:
            data.homePageId != null && Number.isFinite(Number(data.homePageId))
              ? Number(data.homePageId)
              : null,
          homePageName:
            typeof data.homePageName === "string" ? String(data.homePageName) : null,
        };
        dispatchSiteStructureChanged();
        if (typeof done === "function") {
          done(registryCache);
        }
        return registryCache;
      })
      .catch(function (e) {
        if (typeof err === "function") {
          err(e);
        }
        throw e;
      });
  }

  /** Insert or replace a page row in the in-memory registry (e.g. right after duplicate). */
  function mergeRegistryPage(page) {
    if (!page || page.id == null) {
      return;
    }
    if (!registryCache) {
      registryCache = {
        pages: [],
        groups: [],
        galleries: [],
        frames: [],
        homePageId: null,
        homePageName: null,
      };
    }
    var pages = registryCache.pages.slice();
    var id = Number(page.id);
    var replaced = false;
    for (var i = 0; i < pages.length; i++) {
      if (Number(pages[i].id) === id) {
        pages[i] = page;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      pages.push(page);
    }
    registryCache.pages = pages;
    dispatchSiteStructureChanged();
  }

  function getPages() {
    return registryCache && Array.isArray(registryCache.pages) ? registryCache.pages : [];
  }

  function getGroups() {
    return registryCache && Array.isArray(registryCache.groups) ? registryCache.groups : [];
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

    var panelBody = el("div", "staging-site-structure-panel__body");

    panel.appendChild(head);
    panel.appendChild(statusLine);
    panel.appendChild(exportBtn);
    panelBody.appendChild(secLists);
    panelBody.appendChild(detPage);
    panelBody.appendChild(detGal);
    panelBody.appendChild(detFrame);
    panel.appendChild(panelBody);

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

      if (typeof window.customdevRenderPagesTree === "function") {
        window.customdevRenderPagesTree(pagesList, {
          el: el,
          labeledInput: labeledInput,
          base: base,
          statusLine: statusLine,
          getPages: getPages,
          getGroups: getGroups,
          fetchRegistry: fetchRegistry,
          mergeRegistryPage: mergeRegistryPage,
          renderLists: renderLists,
          refreshPageSelect: refreshPageSelect,
        });
      } else {
        statusLine.textContent =
          "Pages tree script missing (load lib/staging/site-structure-pages.js).";
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
      if (lower === "index" || lower === "home") {
        statusLine.textContent =
          'The site home is index.html (page name "index"). Use another name for new pages.';
        return;
      }
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
          return r.json().then(function (data) {
            return fetchRegistry().then(function () {
              return data;
            });
          });
        })
        .then(function (data) {
          pageNameInput.value = "";
          var msg = "Added page \"" + name + "\".";
          if (data && data.htmlCreated && data.htmlPath) {
            msg += " Created " + data.htmlPath + ".";
          } else if (data && data.htmlPath) {
            msg += " Using existing " + data.htmlPath + ".";
          } else if (data && data.htmlWarning) {
            msg += " " + data.htmlWarning;
          }
          statusLine.textContent = msg;
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

  function addStagingChromeThemeToggle() {
    if (document.getElementById("staging-chrome-theme-toggle")) {
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "staging-chrome-theme-toggle";
    btn.className = "staging-chrome-theme-toggle";
    function updateChromeThemeLabel() {
      var light = document.documentElement.classList.contains("staging-chrome-light");
      btn.textContent = light ? "Dark UI" : "Light UI";
      btn.setAttribute(
        "title",
        light
          ? "Switch staging panels to black background / white text"
          : "Switch staging panels to white background / black text",
      );
      btn.setAttribute(
        "aria-label",
        light ? "Use dark staging panel theme" : "Use light staging panel theme",
      );
    }
    updateChromeThemeLabel();
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var nextLight = !document.documentElement.classList.contains("staging-chrome-light");
      document.documentElement.classList.toggle("staging-chrome-light", nextLight);
      try {
        window.localStorage.setItem(CHROME_THEME_STORAGE_KEY, nextLight ? "light" : "dark");
      } catch (eStore) {
        /* ignore */
      }
      updateChromeThemeLabel();
    });
    getStagingStatusBar().appendChild(btn);
  }

  function addOfficialLiveSiteToggle() {
    if (document.getElementById("staging-official-live-toggle")) {
      return;
    }
    var lab = document.createElement("label");
    lab.id = "staging-official-live-toggle";
    lab.className = "staging-official-live-toggle";
    lab.title =
      "Site-wide official mode (localStorage). When on: no Live badge on any page, ?staging=1 ignored. Reloads after change.";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isOfficialLiveSite();
    cb.setAttribute("aria-label", "Official site mode (all pages)");
    cb.addEventListener("change", function () {
      try {
        window.localStorage.setItem(OFFICIAL_LIVE_STORAGE_KEY, cb.checked ? "1" : "0");
      } catch (eSet) {
        /* ignore */
      }
      syncOfficialLiveDocumentClass();
      window.location.reload();
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(" Official site"));
    getStagingStatusBar().appendChild(lab);
  }

  function onStagingDomReady() {
    addStagingModeLabel();
    addStagingChromeThemeToggle();
    addOfficialLiveSiteToggle();
    addStagingPublishControl();
    addStagingSiteStructureControls();
    appendStagingToInternalLinks();
    installStagingLinkNavigationGuard();
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
