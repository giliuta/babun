// Автоматический JSX (react/jsx-runtime) поверх window.React.createElement:
// key — третьим аргументом, статические дети jsxs — разворачиваются.
var R = window.React;
function np(p, k) { var o = {}; for (var x in p) if (x !== "children") o[x] = p[x]; if (k !== void 0) o.key = k; return o; }
function jsx(t, p, k) { var c = p && p.children; return c === void 0 ? R.createElement(t, np(p, k)) : R.createElement(t, np(p, k), c); }
function jsxs(t, p, k) { return R.createElement.apply(R, [t, np(p, k)].concat(p.children)); }
exports.jsx = jsx;
exports.jsxs = jsxs;
exports.jsxDEV = function (t, p, k, s) { return (s ? jsxs : jsx)(t, p, k); };
exports.Fragment = R.Fragment;
