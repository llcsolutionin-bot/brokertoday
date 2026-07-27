/** @type {import('tailwindcss').Config} */
// Build the site's prebuilt CSS (replaces the Tailwind Play CDN):
//   npx -y tailwindcss@3.4.17 -c tailwind.config.js -i input.css -o bt.css --minify
// The safelist covers the ONLY dynamic classes — the homepage project-card theme
// colors built as `from-${theme.from}` etc. (index.html themeColors: indigo/amber/
// green/purple/red). Everything else is literal in the HTML/JS and picked up by content scan.
module.exports = {
  content: ['./*.html', './*.js'],
  safelist: [
    { pattern: /(from|to|bg|text|border)-(indigo|amber|green|purple|red)-(50|100|600|700)/, variants: ['hover', 'group-hover'] },
    { pattern: /to-(blue|orange|emerald|pink|rose)-50/ },
  ],
  theme: { extend: {} },
  plugins: [],
};
