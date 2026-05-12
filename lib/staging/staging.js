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
      addStagingEnterButton();
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
