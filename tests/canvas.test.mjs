import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../client/canvas.js', import.meta.url), 'utf8');
const load = value => vm.runInNewContext(`${source}\n({ canvasSlot, canvasFit, readCanvasPositions, clampZoom })`, { localStorage: { getItem: () => value } });
test('restoring a damaged or unavailable preference cannot break the homepage', () => {
  for (const data of ['null', 'broken', '[]']) assert.equal(Object.keys(load(data).readCanvasPositions()).length, 0);
  const data = JSON.stringify({ ok: {x:10,y:20,r:3}, bad: {x:'100',y:20}, far: {x:1e9,y:0}, turn: {x:0,y:0,r:'bad'} });
  assert.deepEqual(Object.keys(load(data).readCanvasPositions()), ['ok']);
});
test('overview contains the hero and all four initial cards at desktop and narrow widths', () => {
  const api = load('{}');
  for (const [width,height] of [[1160,804],[600,550]]) {
    const points = Array.from({length:4}, (_,i)=>api.canvasSlot(i));
    const c = api.canvasFit(width,height,points);
    for (const p of [...points,{x:0,y:0}]) {
      assert.ok(Math.abs(c.x + p.x * c.z) + 155 * c.z <= width/2);
      assert.ok(Math.abs(c.y + p.y * c.z) + 168 * c.z <= height/2);
    }
  }
  assert.ok(Number.isFinite(api.canvasFit(600,550,[]).z));
});
test('zoom remains bounded and slot placement does not depend on filtering', () => {
  const api = load('{}');
  assert.equal(api.clampZoom(.001),.25);
  assert.equal(api.clampZoom(30),1.6);
  const original = Array.from({length:8}, (_,i)=>api.canvasSlot(i));
  for (const index of [1,3,7]) assert.deepEqual(api.canvasSlot(index),original[index]);
});
