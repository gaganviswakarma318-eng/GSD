// Apply the saved appearance before the interface paints (also allowed by GSD's CSP).
(function () {
  var theme = "light";
  try {
    if (window.localStorage.getItem("gsd-theme") === "dark") theme = "dark";
  } catch (_) {
    // Storage may be disabled; the switch still works for this visit.
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  var color = document.querySelector('meta[name="theme-color"]');
  if (color)
    color.setAttribute("content", theme === "dark" ? "#1d221e" : "#f3f2ec");
})();
