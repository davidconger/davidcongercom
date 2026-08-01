// Scrolls past the masthead so the collapsed top bar and the pinned year bar
// can be photographed. Resolves once the images at the new scroll position
// have had a chance to load -- layout-probe awaits the completion value.
window.scrollTo(0, 900);
new Promise(function (resolve) { setTimeout(resolve, 1600); });
