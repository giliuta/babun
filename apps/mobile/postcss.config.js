// Tailwind CSS v4 via PostCSS. NativeWind v5's Metro transformer runs the
// Expo web-CSS pipeline (PostCSS) on global.css FIRST — expanding
// @import "tailwindcss" / @theme / @source — then compiles the result to
// RN styles. Without this config those at-rules reach lightningcss raw and
// fail to parse. This is the only PostCSS config in the repo — apps/mobile is
// the only app, and it builds iOS, Android and web from this one pipeline.
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
