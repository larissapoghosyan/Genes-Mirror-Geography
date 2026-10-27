/* Adapted from d3-ease/src/sin.js (D3 3.x): only the module wrapper/export names change.
 * https://github.com/d3/d3-ease/blob/main/src/sin.js
 * Copyright 2010-2021 Mike Bostock; Copyright 2001 Robert Penner.
 * BSD-3-Clause; see d3-ease-LICENSE.txt. */
(function (global) {
  var pi = Math.PI, halfPi = pi / 2;
  function sinIn(t) { return (+t === 1) ? 1 : 1 - Math.cos(t * halfPi); }
  function sinOut(t) { return Math.sin(t * halfPi); }
  function sinInOut(t) { return (1 - Math.cos(pi * t)) / 2; }
  global.d3Ease = Object.freeze({sinIn, sinOut, sinInOut});
})(window);
