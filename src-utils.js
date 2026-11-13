/*
 * VK Video — чистые функции без зависимостей от Lampa.
 * Используются и в плагине, и в автотестах (tests/run-tests.js).
 */

var VKU = (function () {
    'use strict';

    var QUALITY_ORDER = ['mp4_2160', 'mp4_1440', 'mp4_1080', 'mp4_720', 'mp4_480', 'mp4_360', 'mp4_240'];
    var QUALITY_LABEL = { mp4_2160: '2160p', mp4_1440: '1440p', mp4_1080: '1080p', mp4_720: '720p', mp4_480: '480p', mp4_360: '360p', mp4_240: '240p' };

    function fmtDuration(sec) {
        sec = Math.max(0, sec | 0);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h ? h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2)
                 : m + ':' + ('0' + s).slice(-2);
    }

    function pickImage(video) {
        if (video && video.image && video.image.length) {
            return video.image[video.image.length - 1].url;
        }
        return (video && (video.__img || video.photo_640 || video.photo_320 || video.photo_130)) || '';
    }

    function videoKey(v) {
        return 'vk:' + v.owner_id + '_' + v.id;
    }

    function pageUrl(v) {
        return 'https://vkvideo.ru/video' + v.owner_id + '_' + v.id;
    }

    // Карта качеств для меню плеера: только mp4-качества не выше cap (число пикселей)
    function qualityMap(files, cap) {
        var map = {};
        cap = cap || 9999;
        QUALITY_ORDER.forEach(function (f) {
            var h = parseInt(f.replace('mp4_', ''), 10);
            if (files && files[f] && h <= cap) {
                map[QUALITY_LABEL[f]] = files[f];
            }
        });
        return map;
    }

    // Лучшее (максимальное по числу) качество из карты
    function bestInMap(map) {
        var best = null, bestH = -1;
        for (var label in map) {
            var h = parseInt(label, 10);
            if (h > bestH) { bestH = h; best = map[label]; }
        }
        return best;
    }

    // Второе по качеству — запасная ссылка для плеера
    function reserveInMap(map) {
        var bestLabel = null, bestH = -1;
        for (var label in map) {
            var h = parseInt(label, 10);
            if (h > bestH) { bestH = h; bestLabel = label; }
        }
        var second = null, secondH = -1;
        for (var l2 in map) {
            var h2 = parseInt(l2, 10);
            if (l2 !== bestLabel && h2 > secondH) { secondH = h2; second = map[l2]; }
        }
        return second;
    }

    // Разбор ссылок VK. Поддержка: vk.com, vk.ru, vkvideo.ru, vk.me;
    // форматы /video<oid>_<id>[_<key>], /clip..., ?z=video..., video_ext.php?oid=&id=&hash=
    function parseVkVideoLink(rawUrl) {
        var url = (rawUrl || '').trim();
        if (!url) return null;
        var host = (url.split('/')[2] || '').toLowerCase();
        if (!/(^|\.)(vk\.com|vk\.ru|vkvideo\.ru|vk\.me)$/.test(host)) return null;

        var m;

        // video_ext.php?oid=-123&id=456&hash=abc
        if (/video_ext\.php/i.test(url)) {
            var oid = (url.match(/oid=(-?\d+)/) || [])[1];
            var id = (url.match(/[^a-z]id=(\d+)/i) || [])[1];
            var hash = (url.match(/hash=([\w]+)/) || [])[1];
            if (oid && id) return { owner_id: +oid, id: +id, access_key: hash || '' };
            return null;
        }

        // vk.com/video?z=video-123_456%2F...
        m = url.match(/[?&]z=([^&]+)/);
        if (m) {
            var z = decodeURIComponent(m[1]);
            var mm = z.match(/(?:video|clip)(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
            if (mm) return { owner_id: +mm[1], id: +mm[2], access_key: mm[3] || '' };
        }

        // vkvideo.ru/video-123_456_abc / vk.com/video123_456 / clip-123_456
        m = url.match(/(?:video|clip)(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
        if (m) return { owner_id: +m[1], id: +m[2], access_key: m[3] || '' };

        return null;
    }

    // Сравнение версий вида '1.2.10' vs '1.3.0' → true если вторая новее
    function versionNewer(a, b) {
        var pa = String(a || '').split('.');
        var pb = String(b || '').split('.');
        for (var i = 0; i < 3; i++) {
            var x = parseInt(pa[i] || '0', 10);
            var y = parseInt(pb[i] || '0', 10);
            if (y > x) return true;
            if (y < x) return false;
        }
        return false;
    }

    return {
        QUALITY_ORDER: QUALITY_ORDER,
        QUALITY_LABEL: QUALITY_LABEL,
        fmtDuration: fmtDuration,
        pickImage: pickImage,
        videoKey: videoKey,
        pageUrl: pageUrl,
        qualityMap: qualityMap,
        bestInMap: bestInMap,
        reserveInMap: reserveInMap,
        parseVkVideoLink: parseVkVideoLink,
        versionNewer: versionNewer
    };
})();

// Автотесты в Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VKU;
}
