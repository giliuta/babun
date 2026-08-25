// Tailwind CSS v4 via PostCSS. NativeWind v5's Metro transformer runs the
// Expo web-CSS pipeline (PostCSS) on global.css FIRST — expanding
// @import "tailwindcss" / @theme / @source — then compiles the result to
// RN styles. Without this config those at-rules reach lightningcss raw and
// fail to parse. Mirrors apps/web/postcss.config.mjs.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
