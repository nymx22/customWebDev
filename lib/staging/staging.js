(function () {
  var STAGING_QUERY = "staging";
  var STORAGE_KEY = "customdev_staging";

  function isStagingEnabled() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get(STAGING_QUERY) === "1" || params.get(STAGING_QUERY) === "true") {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  if (!isStagingEnabled()) {
    return;
  }

  document.documentElement.classList.add("staging");

  function addLabel() {
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addLabel);
  } else {
    addLabel();
  }
})();
