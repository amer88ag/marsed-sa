// Generates the synthetic tiles listed in tiles/manifest.json (not committed).
const fs = require("fs"), path = require("path"), png = require("./png.js");
const images = {
  "textured.png": png(256, 256, (x, y) => [(x * 7 + y * 3) % 256, (x * 2 + y * 9) % 256, (x * y) % 256, 255]),
  "halfblack.png": png(256, 256, (x, y) => x < 128 ? [0, 0, 0, 255] : [(x * 7 + y * 3) % 256, (y * 5) % 256, 120, 255]),
  "black.png": png(256, 256, () => [0, 0, 0, 255])
};
for (const [name, data] of Object.entries(images)) fs.writeFileSync(path.join(__dirname, "tiles", name), data);
console.log("tiles:", Object.keys(images).join(", "));
