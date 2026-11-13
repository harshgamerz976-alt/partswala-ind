import assert from "node:assert/strict";
import test from "node:test";
import { getResponsiveProductImage } from "./productImage.js";

test("Cloudinary catalogue images provide format and width transformed candidates", () => {
  const image = getResponsiveProductImage("https://res.cloudinary.com/demo/image/upload/v123/parts/brake.jpg");
  assert.ok(image);
  assert.match(image.src, /f_auto,q_auto,w_640,c_limit/);
  assert.deepEqual(
    image.srcSet.split(", ").map((candidate) => candidate.match(/(\d+)w$/)?.[1]),
    ["320", "640", "960"],
  );
  assert.match(image.sizes, /640px/);
});

test("Non-Cloudinary, signed, and malformed product image URLs keep their original URL", () => {
  const urls = [
    "https://images.example.test/brake.jpg",
    "https://res.cloudinary.com/demo/image/upload/s--signature--/v123/brake.jpg",
    "not-a-url",
  ];
  for (const url of urls) {
    assert.deepEqual(getResponsiveProductImage(url), { src: url, srcSet: "", sizes: "" });
  }
});

test("Missing product images use the existing icon fallback", () => {
  assert.equal(getResponsiveProductImage(""), null);
  assert.equal(getResponsiveProductImage(null), null);
});