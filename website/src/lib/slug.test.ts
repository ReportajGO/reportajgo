import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, buildUniqueSlug } from "./slug";

test("slugifies an English headline (the motivating example)", () => {
  assert.equal(
    slugify("The Next Kubernetes Is Already Here. Nobody Is Talking About It."),
    "the-next-kubernetes-is-already-here-nobody-is-talking-about-it",
  );
});

test("transliterates Russian Cyrillic to Latin", () => {
  assert.equal(
    slugify("Страны Центральной Азии подписали единое водное соглашение"),
    "strany-tsentralnoy-azii-podpisali-edinoe-vodnoe-soglashenie",
  );
});

test("handles Uzbek-Latin apostrophe letters (oʻ, gʻ, ʼ)", () => {
  assert.equal(
    slugify("Oʻzbekistonda sunʼiy intellekt: gʻalaba"),
    "ozbekistonda-suniy-intellekt-galaba",
  );
});

test("strips diacritics from Latin text", () => {
  assert.equal(slugify("Erdoğan café naïve façade"), "erdogan-cafe-naive-facade");
});

test("drops leading flag/emoji and collapses punctuation", () => {
  assert.equal(slugify("🇩🇪 ТРАНСПОРТ: новости"), "transport-novosti");
  assert.equal(slugify("  Multiple   spaces & symbols!!!  "), "multiple-spaces-symbols");
});

test("falls back to 'post' when nothing survives", () => {
  assert.equal(slugify("🚀🚀🚀"), "post");
  assert.equal(slugify(""), "post");
});

test("caps length at a word boundary without a trailing hyphen", () => {
  const slug = slugify("word ".repeat(40));
  assert.ok(slug.length <= 80);
  assert.ok(!slug.endsWith("-"));
  assert.ok(!slug.startsWith("-"));
});

test("buildUniqueSlug returns the base when it is free", async () => {
  const slug = await buildUniqueSlug("hello", async () => false);
  assert.equal(slug, "hello");
});

test("buildUniqueSlug appends the first free numeric suffix", async () => {
  const taken = new Set(["dup", "dup-2"]);
  const slug = await buildUniqueSlug("dup", async (c) => taken.has(c));
  assert.equal(slug, "dup-3");
});
