// Apply the saved appearance before the interface paints (also allowed by GSD's CSP).
(function () {
  var themes = ["light", "dark", "black"];
  var theme = "light";
  try {
    var saved = window.localStorage.getItem("gsd-theme");
    if (themes.indexOf(saved) !== -1) theme = saved;
  } catch (_) {
    // Storage may be disabled; the selector still works for this visit.
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme =
    theme === "light" ? "light" : "dark";
  var color = document.querySelector('meta[name="theme-color"]');
  if (color)
    color.setAttribute(
      "content",
      theme === "light"
        ? "#f3f2ec"
        : theme === "dark"
          ? "#1d221e"
          : "#000000",
    );
})();
