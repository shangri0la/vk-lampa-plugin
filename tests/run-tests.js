// Автотесты чистых функций плагина. Запуск: node tests/run-tests.js
const assert = require('assert');
const VKU = require('../src-utils.js');

let passed = 0, failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✓ ' + name);
    } catch (e) {
        failed++;
        console.log('  ✗ ' + name + '\n    ' + e.message);
    }
}

console.log('parseVkVideoLink:');

test('vk.com/video123_456', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vk.com/video123_456'), { owner_id: 123, id: 456, access_key: '' });
});

test('отрицательный owner (сообщество): vk.com/video-777_99', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vk.com/video-777_99'), { owner_id: -777, id: 99, access_key: '' });
});

test('vkvideo.ru/video-1_2_abc с access_key', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vkvideo.ru/video-1_2_abc'), { owner_id: -1, id: 2, access_key: 'abc' });
});

test('vk.com/video?z=video-1_2%2Fплейлист', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vk.com/video?z=video-1_2%2Flist'), { owner_id: -1, id: 2, access_key: '' });
});

test('video_ext.php?oid=-5&id=6&hash=hh', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vk.com/video_ext.php?oid=-5&id=6&hash=hh'), { owner_id: -5, id: 6, access_key: 'hh' });
});

test('m.vk.com допустим', () => {
    assert.ok(VKU.parseVkVideoLink('https://m.vk.com/video1_2'));
});

test('чужой домен vk.com.evil.example отклоняется', () => {
    assert.strictEqual(VKU.parseVkVideoLink('https://vk.com.evil.example/video1_2'), null);
});

test('совсем чужой домен отклоняется', () => {
    assert.strictEqual(VKU.parseVkVideoLink('https://youtube.com/watch?v=x'), null);
});

test('без id отклоняется', () => {
    assert.strictEqual(VKU.parseVkVideoLink('https://vk.com/video'), null);
});

test('пустая строка отклоняется', () => {
    assert.strictEqual(VKU.parseVkVideoLink(''), null);
});

test('clip-10_20 распознаётся', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vk.com/clip-10_20'), { owner_id: -10, id: 20, access_key: '' });
});

test('vkvideo.ru/video-123_456 с query не ломается', () => {
    assert.deepStrictEqual(VKU.parseVkVideoLink('https://vkvideo.ru/video-123_456?list=zzz&t=1s'), { owner_id: -123, id: 456, access_key: '' });
});

console.log('qualityMap / best / reserve:');

test('все качества в карту', () => {
    const files = { mp4_240: 'a', mp4_480: 'b', mp4_720: 'c', mp4_1080: 'd' };
    const m = VKU.qualityMap(files, 9999);
    assert.deepStrictEqual(Object.keys(m), ['1080p', '720p', '480p', '240p']);
    assert.strictEqual(VKU.bestInMap(m), 'd');
    assert.strictEqual(VKU.reserveInMap(m), 'c');
});

test('лимит 720 отсекает 1080', () => {
    const files = { mp4_240: 'a', mp4_480: 'b', mp4_720: 'c', mp4_1080: 'd' };
    const m = VKU.qualityMap(files, 720);
    assert.strictEqual(m['1080p'], undefined);
    assert.strictEqual(VKU.bestInMap(m), 'c');
});

test('без файлов — пустая карта', () => {
    assert.deepStrictEqual(VKU.qualityMap(undefined, 9999), {});
    assert.strictEqual(VKU.bestInMap({}), null);
    assert.strictEqual(VKU.reserveInMap({ mp4_480: 'x' }), null);
});

console.log('fmtDuration:');

test('65 → 1:05', () => {
    assert.strictEqual(VKU.fmtDuration(65), '1:05');
});

test('3661 → 1:01:01', () => {
    assert.strictEqual(VKU.fmtDuration(3661), '1:01:01');
});

test('0 → 0:00', () => {
    assert.strictEqual(VKU.fmtDuration(0), '0:00');
});

console.log('versionNewer:');

test('1.3.0 новее 1.2.9', () => {
    assert.strictEqual(VKU.versionNewer('1.2.9', '1.3.0'), true);
});

test('1.3.0 не новее 1.3.0', () => {
    assert.strictEqual(VKU.versionNewer('1.3.0', '1.3.0'), false);
});

test('2.0.0 новее 1.9.9', () => {
    assert.strictEqual(VKU.versionNewer('1.9.9', '2.0.0'), true);
});

console.log('pickImage/videoKey/pageUrl:');

test('image[] берётся старший', () => {
    assert.strictEqual(VKU.pickImage({ image: [{ url: 's' }, { url: 'big' }] }), 'big');
});

test('__img из избранного работает', () => {
    assert.strictEqual(VKU.pickImage({ __img: 'fav.jpg' }), 'fav.jpg');
});

test('ключ и страница', () => {
    assert.strictEqual(VKU.videoKey({ owner_id: -7, id: 8 }), 'vk:-7_8');
    assert.strictEqual(VKU.pageUrl({ owner_id: -7, id: 8 }), 'https://vkvideo.ru/video-7_8');
});

console.log('\nИтог: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
