import test from 'node:test';
import assert from 'node:assert/strict';
import { tourPlacement } from '../lib/tutorial/placement.ts';

test('tour pointer stays between the module edge and card at either side', () => {
  for (const left of [16, 950]) {
    const anchor = { left, top: 610, width: 180, height: 40 };
    const { card, pointer } = tourPlacement(anchor, { width: 1200, height: 760 }, 400);
    assert.ok(card.top + 400 <= 744);
    if (pointer.direction === 'left') {
      assert.equal(pointer.left, left + 184);
      assert.ok(pointer.left + 28 < card.left);
    } else {
      assert.equal(pointer.left + 28, left - 4);
      assert.ok(card.left + card.width < pointer.left);
    }
  }
});

test('narrow tours put the card above or below the target without hiding the pointer', () => {
  for (const top of [100, 620]) {
    const { card, pointer } = tourPlacement({ left: 16, top, width: 190, height: 40 }, { width: 390, height: 760 }, 300);
    assert.ok(card.left >= 16 && card.left + card.width <= 374);
    assert.ok(card.maxHeight !== undefined && card.maxHeight > 0);
    if (pointer.direction === 'up') assert.ok(pointer.top + 28 < card.top);
    else assert.ok(card.top + Math.min(300, card.maxHeight) < pointer.top);
  }
});
