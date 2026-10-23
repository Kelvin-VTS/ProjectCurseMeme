import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPatch } from '../packages/dsh-cursememe-admin/lib/edit.mjs';
import {
  assertDate,
  assertMonth,
  isAllowedExtension,
  isInside,
  makeBatchId,
  normalizeTags,
  safeName,
} from '../packages/dsh-cursememe-admin/lib/util.mjs';

/** @returns {any} */
function baseEntry() {
  return {
    id: 'a1b2c3d4e5f6',
    kind: 'image',
    date: '2026-10-18',
    media: 'media/2026-10/a1b2c3d4e5f6.jpg',
    poster: 'media/2026-10/a1b2c3d4e5f6.poster.webp',
    thumb: 'media/2026-10/a1b2c3d4e5f6.thumb.webp',
    width: 100,
    height: 100,
    size: 1024,
    mime: 'image/jpeg',
    hash: 'a1b2c3d4e5f6',
    likes: 3,
    tags: ['抽象'],
    contributor: { login: 'friend-01' },
    via: 'web',
    visible: true,
  };
}

test('safeName: 保留扩展名、去掉危险字符', () => {
  assert.equal(safeName(0, 'a b.jpg'), '001-a-b.jpg');
  assert.equal(safeName(1, '中文 图.PNG'), '002-中文-图.png');
  const traversal = safeName(2, '../../id_rsa');
  assert.ok(!traversal.includes('/'));
  assert.ok(!traversal.includes('..'));
});

test('normalizeTags: 中英文逗号、去重、去空', () => {
  assert.deepEqual(normalizeTags('抽象, 搞笑，抽象 ,'), ['抽象', '搞笑']);
  assert.deepEqual(normalizeTags(['a', 'a', ' b ']), ['a', 'b']);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.throws(() => normalizeTags(Array.from({ length: 9 }, (_, i) => `t${i}`)));
});

test('assertDate / assertMonth：拒绝不存在的日期', () => {
  assert.equal(assertDate('2026-10-23'), '2026-10-23');
  assert.throws(() => assertDate('2026-02-30'));
  assert.throws(() => assertDate('2026/10/23'));
  assert.equal(assertMonth('2026-10'), '2026-10');
  assert.throws(() => assertMonth('2026-13'));
});

test('makeBatchId 形状', () => {
  assert.match(makeBatchId(), /^\d{8}-\d{6}-[a-z0-9]{4}$/);
});

test('applyPatch：点赞取整并夹紧', () => {
  const { next, changedKeys } = applyPatch(baseEntry(), { likes: 12.6 });
  assert.equal(next.likes, 13);
  assert.deepEqual(changedKeys, ['likes']);

  const low = applyPatch(baseEntry(), { likes: -5 });
  assert.equal(low.next.likes, 0);
});

test('applyPatch：空标题删除字段', () => {
  const entry = { ...baseEntry(), title: '旧标题' };
  const { next, changedKeys } = applyPatch(entry, { title: '   ' });
  assert.equal('title' in next, false);
  assert.deepEqual(changedKeys, ['title']);
});

test('applyPatch：标签归一化', () => {
  const { next, changedKeys } = applyPatch(baseEntry(), { tags: '抽象，新标签, 抽象' });
  assert.deepEqual(next.tags, ['抽象', '新标签']);
  assert.deepEqual(changedKeys, ['tags']);
});

test('applyPatch：同值不产生改动', () => {
  const { changedKeys } = applyPatch(baseEntry(), {
    likes: 3,
    tags: ['抽象'],
    visible: true,
    login: 'friend-01',
  });
  assert.deepEqual(changedKeys, []);
});

test('applyPatch：非法输入抛错', () => {
  assert.throws(() => applyPatch(baseEntry(), { likes: 'abc' }));
  assert.throws(() => applyPatch(baseEntry(), { visible: 'false' }));
  assert.throws(() => applyPatch(baseEntry(), { unknown: 1 }));
  assert.throws(() => applyPatch(baseEntry(), { login: '   ' }));
});

test('isInside：前缀相同但不是子目录要拒绝', () => {
  const root = path.join(os.tmpdir(), 'cursememe-root');
  assert.equal(isInside(root, path.join(root, 'a', 'b')), true);
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(root, `${root}-evil`), false);
});

test('isAllowedExtension：大小写与未知扩展名', () => {
  assert.equal(isAllowedExtension('A.JPG', ['.jpg']), true);
  assert.equal(isAllowedExtension('a.heic', ['.jpg', '.png']), false);
});

test('临时目录里的真实路径校验', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cursememe-'));
  const child = path.join(root, 'x.png');
  fs.writeFileSync(child, 'x');
  assert.equal(isInside(fs.realpathSync(root), fs.realpathSync(child)), true);
  fs.rmSync(root, { recursive: true, force: true });
});
