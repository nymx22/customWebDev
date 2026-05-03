(function () {
  var STAGING_QUERY = "staging";
  /** Legacy key: cleared on live loads so staging is never inferred from storage. */
  var STORAGE_KEY = "customdev_staging";

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
    return fromUrl === "on";
  }

  if (!isStagingEnabled()) {
    return;
  }

  document.documentElement.classList.add("staging");

  /** Staging-only: fixed “Testing mode” label (URL must include ?staging=1). */
  function addStagingModeLabel() {
    if (document.getElementById("staging-mode-label")) {
      return;
    }
    var el = document.createElement("div");
    el.id = "staging-mode-label";
    el.className = "staging-mode-label";
    el.setAttribute("role", "status");
    el.textContent = "Testing mode";
    document.body.appendChild(el);
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

  function onStagingDomReady() {
    addStagingModeLabel();
    appendStagingToInternalLinks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onStagingDomReady);
  } else {
    onStagingDomReady();
  }
})();
