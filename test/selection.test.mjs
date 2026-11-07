import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { SmartSelection } = await jiti.import("../selection.ts");

test("Unit counts, overlapping levels, and nested lists", () => {
  const sample = new SmartSelection(
    "One sentence. Two sentences.\n\nThird sentence.",
  );
  const expected = { word: 9, sentence: 3, block: 2, "whole agent message": 1 };
  for (const [kind, total] of Object.entries(expected)) {
    const ranges = sample.ranges
      .filter((r) => r.kind === kind)
      .sort((a, b) => a.start - b.start);
    assert.equal(ranges.length, total, kind);
    for (let i = 0; i < ranges.length; i++) {
      sample.current = ranges[i];
      assert.deepEqual(sample.unitPosition, { kind, index: i + 1, total });
    }
  }
  const single = new SmartSelection("Hello");
  assert.ok(single.ranges.some((r) => r.kind === "word"));
  assert.ok(single.ranges.some((r) => r.kind === "sentence"));
  assert.ok(single.ranges.some((r) => r.kind === "block"));
  for (const range of single.ranges) {
    single.current = range;
    assert.equal(single.unitPosition.total, 1);
    assert.equal(single.unitPosition.index, 1);
  }
  const nested = new SmartSelection(
    "- First item\n- Second item\n  - Nested item",
  );
  assert.equal(nested.ranges.filter((r) => r.kind === "list item").length, 3);
  for (const range of nested.ranges) {
    nested.current = range;
    assert.ok(
      nested.unitPosition.index >= 1 &&
        nested.unitPosition.index <= nested.unitPosition.total,
    );
  }
});

test("Mixed Markdown blocks, list items, code lines, and atomic tables", () => {
  const demo =
    'Try the six blocks below. This is the first paragraph.\n\n- Apples are crisp.\n- Bananas are sweet.\n- Cherries are small.\n\nThis paragraph has two sentences. Select either one.\n\n```js\nconst fruit = "apple";\nconsole.log(fruit);\n```\n\n> This is a blockquote. It has two sentences.\n\n| Fruit | Color |\n| --- | --- |\n| Apple | Red |\n| Banana | Yellow |';
  const blockModel = new SmartSelection(demo);
  blockModel.shrink();
  assert.deepEqual(blockModel.unitPosition, {
    kind: "block",
    index: 1,
    total: 6,
  });
  const expectedStarts = [
    "Try",
    "- Apples",
    "This paragraph",
    "```js",
    "> This",
    "| Fruit",
  ];
  for (let i = 0; i < 6; i++) {
    assert.equal(blockModel.unitPosition.index, i + 1);
    assert.ok(blockModel.text.startsWith(expectedStarts[i]));
    if (i < 5) blockModel.moveUnit(1);
  }
  blockModel.shrink();
  assert.equal(blockModel.current.kind, "block", "table stays atomic");
  for (let i = 0; i < 4; i++) blockModel.moveUnit(-1);
  blockModel.shrink();
  assert.equal(blockModel.current.kind, "list item");
  assert.equal(blockModel.unitPosition.total, 3);
  blockModel.moveUnit(1);
  assert.ok(blockModel.text.startsWith("- Bananas"));
  blockModel.expand();
  assert.deepEqual(blockModel.unitPosition, {
    kind: "block",
    index: 2,
    total: 6,
  });
  blockModel.moveUnit(1);
  blockModel.shrink();
  assert.equal(blockModel.current.kind, "sentence");
  assert.equal(blockModel.text, "This paragraph has two sentences.");
  blockModel.expand();
  blockModel.moveUnit(1);
  blockModel.shrink();
  assert.equal(blockModel.current.kind, "code line");
});

test("Horizontal navigation keeps its level and stops at boundaries", () => {
  for (const source of [
    "Hello",
    "First. Next.\n\nLast.",
    "- First item\n- Second item\n  - Nested item",
    "# Title\n\nFirst paragraph.\n\n## Subheading\n\nOther paragraph.",
  ]) {
    const model = new SmartSelection(source);
    for (const kind of new Set(model.ranges.map((r) => r.kind))) {
      const units = model.ranges
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.start - b.start || b.end - a.end);
      model.current = units[0];
      model.moveUnit(-1);
      assert.equal(model.current, units[0]);
      for (let i = 1; i < units.length; i++) {
        model.moveUnit(1);
        assert.equal(model.current, units[i]);
        assert.equal(model.current.kind, kind);
        assert.equal(model.unitPosition.index, i + 1);
      }
      model.moveUnit(1);
      assert.equal(model.current, units.at(-1));
      for (let i = units.length - 2; i >= 0; i--) {
        model.moveUnit(-1);
        assert.equal(model.current, units[i]);
      }
    }
  }
});
