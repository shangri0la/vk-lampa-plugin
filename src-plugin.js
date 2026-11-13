/*
 * VK Video — плагин для Lampa (lampa.cub.red)
 *
 * Подключает личный аккаунт ВКонтакте (access token, scope: video)
 * и позволяет смотреть свои видео прямо в Lampa: каталог, альбомы, поиск,
 * продолжение просмотра, выбор качества, авто-переход к следующему видео,
 * открытие по ссылке.
 *
 * Сборка: build.sh -> vk-video.js (этот исходник + vendor/qrcode-lib.js).
 * Установка: Настройки → Расширения → Добавить плагин → URL файла (HTTPS).
 */

(function () {
    'use strict';

    var GUARD = 'vk_video_plugin_loaded';
    var VERSION = '1.2.0';

    var API = 'https://api.vk.com/method/';
    var API_V = '5.199';
    var PAGE_SIZE = 50;
    var THROTTLE_MS = 360;   // user-token лимит VK ≈ 3 req/s
    var REQUEST_TIMEOUT = 20000;

    // Публичное standalone-приложение для implicit-flow (Kate Mobile).
    // VK отключил остальные публичные app_id (VK Me, VK Android и др.).
    var AUTH_APP_ID = '2685278';

    function buildAuthUrl() {
        return 'https://oauth.vk.com/authorize?client_id=' + AUTH_APP_ID +
            '&display=page&scope=video,offline&response_type=token&v=' + API_V;
    }

    // ------------------------------------------------------------------
    // Сеть: VK API с троттлингом, таймаутом и понятными ошибками
    // ------------------------------------------------------------------

    var lastCall = 0;
    var queue = [];
    var queueBusy = false;

    function vkErrorMessage(err) {
        var code = err && err.error_code;
        var msg = (err && err.error_msg) || 'Неизвестная ошибка VK API';
        if (code === 5) return 'Токен VK недействителен или истёк. Откройте раздел VK Video и подключите аккаунт заново.';
        if (code === 6) return 'Слишком много запросов к VK. Подождите пару секунд и повторите.';
        if (code === 7) return 'VK: недостаточно прав для этого действия.';
        if (code === 15) return 'VK: нет доступа к этому видео.';
        if (code === 100) return 'VK: неверные параметры запроса.';
        if (code === 600) return 'VK: нет доступа к видеозаписям.';
        return 'VK: ' + msg;
    }

    function apiCall(method, params, success, fail) {
        var token = getToken();
        if (!token) {
            fail('Токен VK не задан. Откройте раздел VK Video и подключите аккаунт.');
            return;
        }
        var qs = [];
        for (var k in params) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
                qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            }
        }
        qs.push('access_token=' + encodeURIComponent(token));
        qs.push('v=' + API_V);
        queue.push({ url: API + method + '?' + qs.join('&'), success: success, fail: fail, done: false });
        runQueue();
    }

    function finishTask(task, fn, arg) {
        if (task.done) return;
        task.done = true;
        fn(arg);
    }

    function runQueue() {
        if (queueBusy || !queue.length) return;
        queueBusy = true;
        var task = queue.shift();
        var wait = Math.max(0, THROTTLE_MS - (Date.now() - lastCall));
        setTimeout(function () {
            lastCall = Date.now();
            var killer = setTimeout(function () {
                finishTask(task, task.fail, 'VK не отвечает (превышено время ожидания).');
            }, REQUEST_TIMEOUT);
            Lampa.Network.silent(task.url, function (json) {
                clearTimeout(killer);
                queueBusy = false;
                runQueue();
                if (json && json.error) {
                    finishTask(task, task.fail, vkErrorMessage(json.error));
                    return;
                }
                finishTask(task, task.success, (json && json.response) || {});
            }, function () {
                clearTimeout(killer);
                queueBusy = false;
                runQueue();
                finishTask(task, task.fail, 'Нет соединения с api.vk.com.');
            });
        }, wait);
    }

    function getToken() {
        try {
            return (Lampa.Storage.field('vk_video_token') || '').trim();
        } catch (e) {
            return (Lampa.Storage.get('vk_video_token', '') || '').trim();
        }
    }

    // ------------------------------------------------------------------
    // Утилиты
    // ------------------------------------------------------------------

    function fmtDuration(sec) {
        sec = Math.max(0, sec | 0);
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h ? h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2)
                 : m + ':' + ('0' + s).slice(-2);
    }

    function pickImage(video) {
        if (video.image && video.image.length) {
            return video.image[video.image.length - 1].url;
        }
        return video.photo_640 || video.photo_320 || video.photo_130 || '';
    }

    function videoKey(v) {
        return 'vk:' + v.owner_id + '_' + v.id;
    }

    function pageUrl(v) {
        return 'https://vkvideo.ru/video' + v.owner_id + '_' + v.id;
    }

    // Локальная история просмотра (НЕ история VK — только для «Продолжить»)
    function historyList() {
        return Lampa.Storage.get('vk_video_history', []) || [];
    }

    function historyFind(key) {
        var list = historyList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return list[i];
        }
        return null;
    }

    function historySave(key, title, timeSec, durationSec) {
        if (!durationSec || durationSec < 30) return;
        var list = historyList().filter(function (h) { return h.key !== key; });
        list.unshift({ key: key, title: title, time: Math.floor(timeSec || 0), duration: Math.floor(durationSec), date: Date.now() });
        Lampa.Storage.set('vk_video_history', list.slice(0, 50));
    }

    // Кэш первых страниц каталога (мгновенное открытие раздела)
    function cacheGet(key) {
        return Lampa.Storage.get(key, null);
    }

    function cacheSet(key, val) {
        Lampa.Storage.set(key, val);
    }

    // ------------------------------------------------------------------
    // Качества и плеер
    // ------------------------------------------------------------------

    var QUALITY_ORDER = ['mp4_2160', 'mp4_1440', 'mp4_1080', 'mp4_720', 'mp4_480', 'mp4_360', 'mp4_240'];
    var QUALITY_LABEL = { mp4_2160: '2160p', mp4_1440: '1440p', mp4_1080: '1080p', mp4_720: '720p', mp4_480: '480p', mp4_360: '360p', mp4_240: '240p' };

    function maxQualitySetting() {
        try {
            var q = Lampa.Storage.field('vk_video_quality') || 'auto';
            return q === 'auto' ? 9999 : parseInt(q, 10);
        } catch (e) {
            return 9999;
        }
    }

    // Карта качеств для штатного меню плеера Lampa
    function qualityMap(files) {
        var map = {};
        var cap = maxQualitySetting();
        QUALITY_ORDER.forEach(function (f) {
            var h = parseInt(f.replace('mp4_', ''), 10);
            if (files && files[f] && h <= cap) {
                map[QUALITY_LABEL[f]] = files[f];
            }
        });
        return map;
    }

    function bestInMap(map) {
        var best = null, bestH = -1;
        for (var label in map) {
            var h = parseInt(label, 10);
            if (h > bestH) { bestH = h; best = map[label]; }
        }
        return best;
    }

    function autoNextEnabled() {
        try {
            var v = Lampa.Storage.field('vk_video_autonext');
            return v === undefined || v === null || v === true || v === '1' || v === 'true';
        } catch (e) {
            return true;
        }
    }

    // ------------------------------------------------------------------
    // Очередь просмотра (для «следующее видео»)
    // ------------------------------------------------------------------

    var playQueue = [];
    var playerHooked = false;

    function setPlayQueue(items, startIndex) {
        playQueue = items.slice(startIndex + 1).map(function (v) {
            return { owner_id: v.owner_id, id: v.id, access_key: v.access_key, title: v.title };
        });
    }

    function hookPlayer() {
        if (playerHooked) return;
        playerHooked = true;

        var onEnded = function () {
            if (!autoNextEnabled() || !playQueue.length) return;
            var next = playQueue.shift();
            Lampa.Noty.show('Далее: ' + (next.title || 'следующее видео'));
            setTimeout(function () { playVideo(next); }, 500);
        };

        var findVideoEl = function () {
            try {
                var root = Lampa.Player.render && Lampa.Player.render();
                return (root && root.find('video')[0]) || document.querySelector('video');
            } catch (e) {
                return document.querySelector('video');
            }
        };

        Lampa.Player.listener.follow('start', function () {
            setTimeout(function () {
                var el = findVideoEl();
                if (el && !el.__vk_next_hook) {
                    el.__vk_next_hook = true;
                    el.addEventListener('ended', onEnded);
                }
            }, 700);
        });

        Lampa.Player.listener.follow('destroy', function () {
            playQueue = [];
        });
    }

    // Мониторинг прогресса для «Продолжить просмотр»
    var progressTimer = null;

    function startProgressMonitor(key, title) {
        stopProgressMonitor();
        progressTimer = setInterval(function () {
            try {
                if (!(Lampa.Player.opened && Lampa.Player.opened())) { stopProgressMonitor(); return; }
                var el = document.querySelector('video');
                if (el && el.duration > 0) {
                    historySave(key, title, el.currentTime, el.duration);
                }
            } catch (e) {}
        }, 4000);
    }

    function stopProgressMonitor() {
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    }

    // ------------------------------------------------------------------
    // Разбор ссылок VK (только официальные домены)
    // ------------------------------------------------------------------

    function parseVkVideoLink(rawUrl) {
        var url = (rawUrl || '').trim();
        if (!url) return null;
        if (!/(^|\.)(vk\.com|vk\.ru|vkvideo\.ru|vk\.me)$/i.test((url.split('/')[2] || ''))) return null;

        var oid, id, hash, m;

        // video_ext.php?oid=-123&id=456&hash=abc
        if (/video_ext\.php/i.test(url)) {
            oid = (url.match(/oid=(-?\d+)/) || [])[1];
            id = (url.match(/[^a-z]id=(\d+)/i) || [])[1];
            hash = (url.match(/hash=([\w]+)/) || [])[1];
            if (oid && id) return { owner_id: +oid, id: +id, access_key: hash || '' };
            return null;
        }

        // vk.com/video?z=video-123_456%2F... 
        m = url.match(/[?&]z=([^&]+)/);
        if (m) {
            var z = decodeURIComponent(m[1]);
            var mm = z.match(/(?:video|clip)[-]?(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
            if (mm) return { owner_id: +mm[1], id: +mm[2], access_key: mm[3] || '' };
        }

        // vkvideo.ru/video-123_456_abc / vk.com/video123_456 / clip-123_456
        m = url.match(/(?:video|clip)[-]?(-?\d+)_(\d+)(?:_([A-Za-z0-9]+))?/);
        if (m) return { owner_id: +m[1], id: +m[2], access_key: m[3] || '' };

        return null;
    }

    // ------------------------------------------------------------------
    // Воспроизведение
    // ------------------------------------------------------------------

    function resumeTime(item) {
        var h = historyFind(videoKey(item));
        if (h && h.duration > 0) {
            var pct = h.time / h.duration;
            if (pct > 0.03 && pct < 0.95) return h.time;
        }
        return 0;
    }

    function playVideo(item, opts) {
        opts = opts || {};
        var key = videoKey(item);
        var videosParam = item.owner_id + '_' + item.id + (item.access_key ? '_' + item.access_key : '');
        hookPlayer();
        if (!opts.silent) Lampa.Noty.show('Получаем ссылку на видео…');

        apiCall('video.get', { videos: videosParam, extended: 1 }, function (res) {
            var video = res.items && res.items[0];
            if (!video) { Lampa.Noty.show('Видео недоступно.'); return; }
            var map = qualityMap(video.files);
            var url = bestInMap(map);

            var title = video.title || item.title || 'VK Video';
            var time = opts.startOver ? 0 : resumeTime(item);

            setPlayQueue(res.items, 0);

            if (url) {
                Lampa.Player.play({
                    title: title,
                    url: url,
                    quality: Object.keys(map).length > 1 ? map : undefined,
                    timeline: time > 0 ? { time: time } : undefined
                });
                startProgressMonitor(key, title);
            } else {
                stopProgressMonitor();
                playViaIframe(video);
            }
        }, function (msg) {
            Lampa.Noty.show(msg);
        });
    }

    function playViaIframe(video) {
        var player = (video && (video.player || (video.files && video.files.external))) || '';
        if (!player) {
            Lampa.Noty.show('У этого видео нет доступного источника для просмотра.');
            return;
        }
        player += (player.indexOf('?') > -1 ? '&' : '?') + 'autoplay=1&hd=2';
        var html =
            '<div style="position:relative;width:100%;height:100%;">' +
            '<iframe src="' + player + '" ' +
            'allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;" ' +
            'frameborder="0" allowfullscreen ' +
            'style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"></iframe>' +
            '</div>';
        Lampa.Modal.open({
            title: video.title || 'VK Video',
            html: $('<div style="width:64vw;height:36vw;"></div>').append(html),
            size: 'full',
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('content');
            }
        });
    }

    // Меню карточки (долгое нажатие)
    function openCardMenu(video) {
        Lampa.Select.show({
            title: video.title || 'VK Видео',
            items: [
                {
                    title: 'Смотреть',
                    subtitle: 'с места, где остановились',
                    onSelect: function () { playVideo(video); }
                },
                {
                    title: 'Смотреть сначала',
                    subtitle: 'с самого начала',
                    onSelect: function () { playVideo(video, { startOver: true }); }
                },
                {
                    title: 'Скопировать ссылку',
                    subtitle: 'ссылка на страницу видео VK',
                    onSelect: function () {
                        Lampa.Utils.copyTextToClipboard(pageUrl(video), function () {
                            Lampa.Noty.show('Ссылка скопирована.');
                        }, function () {
                            Lampa.Noty.show('Не удалось скопировать.');
                        });
                    }
                }
            ],
            onBack: function () {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ------------------------------------------------------------------
    // Владелец (автоопределение по токену)
    // ------------------------------------------------------------------

    var ownerCache = null;

    function resolveOwner(cb) {
        if (ownerCache) { cb(ownerCache); return; }
        var cached = Lampa.Storage.get('vk_video_owner', null);
        var token = getToken();
        if (cached && token && cached.token === token) {
            ownerCache = { id: cached.id, name: cached.name };
            cb(ownerCache);
            return;
        }
        apiCall('users.get', {}, function (res) {
            var user = res && res[0];
            if (!user || !user.id) { cb(null); return; }
            ownerCache = { id: user.id, name: user.first_name + ' ' + user.last_name };
            Lampa.Storage.set('vk_video_owner', { id: ownerCache.id, name: ownerCache.name, token: token });
            cb(ownerCache);
        }, function (msg) {
            Lampa.Noty.show(msg);
            cb(null);
        });
    }

    // ------------------------------------------------------------------
    // Экран подключения (авторизация внутри Lampa)
    // ------------------------------------------------------------------

    var AUTH_STEPS =
        '1. Нажмите «Войти через VK» или отсканируйте QR-код телефоном.\n' +
        '2. На странице VK войдите (можно по QR — без пароля) и нажмите «Разрешить».\n' +
        '3. Скопируйте access_token из адресной строки браузера (между access_token= и &expires_in).\n' +
        '4. Вернитесь сюда и нажмите «Ввести токен».\n' +
        'Есть ссылка на видео VK? Кнопка «Открыть по ссылке» её разберёт.';

    function verifyAndSaveToken(token, onOk, onFail) {
        token = (token || '').trim();
        if (!token) { onFail('Токен пустой.'); return; }
        Lampa.Storage.set('vk_video_token', token);
        ownerCache = null;
        apiCall('users.get', {}, function (res) {
            var user = res && res[0];
            if (!user || !user.id) {
                Lampa.Storage.set('vk_video_token', '');
                onFail('VK не принял токен. Проверьте, что скопировали его целиком.');
                return;
            }
            ownerCache = { id: user.id, name: user.first_name + ' ' + user.last_name };
            Lampa.Storage.set('vk_video_owner', { id: ownerCache.id, name: ownerCache.name, token: token });
            onOk(ownerCache);
        }, function (msg) {
            Lampa.Storage.set('vk_video_token', '');
            onFail(msg);
        });
    }

    function openTokenInput(onConnected) {
        var kbParams = {
            title: 'VK Access Token',
            value: getToken(),
            free: true,
            nosave: true,
            nomic: true,
            // режим simple: экранная клавиатура + настоящее текстовое поле,
            // в которое удобно вставить токен на десктопе
            keyboard: 'simple'
        };
        Lampa.Input.edit(kbParams, function (value) {
            verifyAndSaveToken(value, function (owner) {
                Lampa.Noty.show('Подключено: ' + owner.name);
                onConnected();
            }, function (msg) {
                Lampa.Noty.show(msg);
            });
        });
    }

    function openByLinkInput(onFound) {
        Lampa.Input.edit({
            title: 'Ссылка на видео VK',
            value: '',
            free: true,
            nosave: true,
            nomic: true,
            keyboard: 'simple'
        }, function (value) {
            var parsed = parseVkVideoLink(value);
            if (!parsed) {
                Lampa.Noty.show('Не распознали ссылку. Поддерживаются vk.com, vk.ru, vkvideo.ru.');
                return;
            }
            onFound(parsed);
        });
    }

    function buildAuthPanel(onConnected) {
        var url = buildAuthUrl();
        var panel = $(
            '<div class="vk-auth" style="max-width:640px;margin:0 auto;padding:2em 1.5em;">' +
            '<div style="font-size:1.4em;margin-bottom:.4em;">VK Видео — подключение аккаунта</div>' +
            '<div style="opacity:.7;white-space:pre-line;line-height:1.5;">' + AUTH_STEPS + '</div>' +
            '<div class="vk-auth__qr" style="margin:1.2em 0;text-align:center;"></div>' +
            '<div class="vk-auth__buttons" style="display:flex;flex-direction:column;gap:8px;">' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Войти через VK (открыть страницу)</div>' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Скопировать ссылку для входа</div>' +
            '<div class="vk-auth__btn selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.8em;text-align:center;">Открыть видео по ссылке</div>' +
            '<div class="vk-auth__btn selector" style="background:#0077FF;border-radius:8px;padding:.8em;text-align:center;">Ввести токен</div>' +
            '</div>' +
            '</div>'
        );

        try {
            if (typeof qrcode === 'function') {
                var qr = qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                panel.find('.vk-auth__qr').append(qr.createImgTag(4, 8));
            }
        } catch (e) {}

        var buttons = panel.find('.vk-auth__btn');
        buttons.eq(0).on('hover:enter', function () {
            var w = window.open(url, '_blank');
            if (!w) Lampa.Noty.show('Браузер заблокировал открытие. Используйте ссылку или QR-код.');
        });
        buttons.eq(1).on('hover:enter', function () {
            Lampa.Utils.copyTextToClipboard(url, function () {
                Lampa.Noty.show('Ссылка скопирована. Откройте её на любом устройстве.');
            }, function () {
                Lampa.Noty.show('Не удалось скопировать. Отсканируйте QR-код телефоном.');
            });
        });
        buttons.eq(2).on('hover:enter', function () {
            openByLinkInput(function (parsed) {
                if (!getToken()) {
                    Lampa.Noty.show('Сначала подключите аккаунт — для приватных видео нужен токен.');
                    return;
                }
                playVideo(parsed);
            });
        });
        buttons.eq(3).on('hover:enter', function () {
            openTokenInput(onConnected);
        });

        return panel;
    }

    // ------------------------------------------------------------------
    // Карточки
    // ------------------------------------------------------------------

    Lampa.Template.add('vk_video_card', [
        '<div class="video__card selector">',
        '<div class="video__imgbox">',
        '<img class="video__img" alt="">',
        '<div class="video__duration" style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:4px;font-size:.85em;">{duration}</div>',
        '{badge}',
        '</div>',
        '<div class="video__title" style="margin-top:6px;font-size:1em;line-height:1.3;overflow:hidden;">{title}</div>',
        '<div class="video__views" style="opacity:.6;font-size:.85em;">{views}</div>',
        '</div>'
    ].join(''));

    Lampa.Template.add('vk_video_album', [
        '<div class="video__card selector">',
        '<div class="video__imgbox" style="display:flex;align-items:center;justify-content:center;height:110px;background:rgba(255,255,255,.06);border-radius:8px;">',
        '<div style="font-size:2.2em;">📁</div>',
        '</div>',
        '<div class="video__title" style="margin-top:6px;">{title}</div>',
        '<div class="video__views">{count}</div>',
        '</div>'
    ].join(''));

    function resumeBadge(video) {
        var h = historyFind(videoKey(video));
        if (h && h.duration > 0) {
            var pct = Math.round(100 * h.time / h.duration);
            if (pct >= 3 && pct < 95) return '<div style="position:absolute;left:6px;top:6px;background:#0077FF;padding:2px 5px;border-radius:4px;font-size:.8em;">просмотрено ' + pct + '%</div>';
            if (pct >= 95) return '<div style="position:absolute;left:6px;top:6px;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:4px;font-size:.8em;">✓</div>';
        }
        return '';
    }

    function buildCard(video) {
        var card = Lampa.Template.get('vk_video_card', {
            title: Lampa.Utils.shortText(video.title || 'Без названия', 60),
            duration: fmtDuration(video.duration),
            views: 'Просмотры: ' + (video.views || 0),
            badge: resumeBadge(video)
        });
        var img = card.find('.video__img')[0];
        if (img) img.src = pickImage(video);
        card.on('hover:enter', function () { playVideo(video); });
        card.on('hover:long', function () { openCardMenu(video); });
        return card;
    }

    // ------------------------------------------------------------------
    // Базовый экран: скролл, пагинация, кэш, ошибки с повтором
    // ------------------------------------------------------------------

    function VkScreen(object) {
        this.data = object;
        this.items = [];
        this.offset = 0;
        this.total = Infinity;
        this.loading = false;
    }

    VkScreen.prototype.create = function () {
        this.html = $('<div class="vk-video-screen" style="width:100%;"></div>');
        this.scroll = new Lampa.Scroll({ mask: true, over: true });
        this.scroll.append(this.body = $('<div class="vk-video-grid" style="display:flex;flex-wrap:wrap;gap:12px;padding:1.5em;"></div>'));
        this.html.append(this.scroll.render());
        if (!getToken()) {
            this.showAuth();
        } else {
            this.bootstrap();
        }
        return this.html;
    };

    VkScreen.prototype.render = function () { return this.html; };

    VkScreen.prototype.showAuth = function () {
        this.authMode = true;
        var self = this;
        this.body.empty();
        this.body.append(buildAuthPanel(function () {
            // экран пересоздаётся целиком: появятся действия, «недавно» и каталог
            self.authMode = false;
            if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
            else { self.body.empty(); self.bootstrap(); }
        }));
    };

    // старт: кэш мгновенно + фоновое обновление
    VkScreen.prototype.bootstrap = function () {
        var self = this;
        var cacheKey = this.cacheKey();
        var cached = cacheKey ? cacheGet(cacheKey) : null;
        if (cached && cached.items && cached.items.length) {
            this.total = cached.total || Infinity;
            this.renderItems(cached.items, true);
            this.offset = cached.items.length;
            setTimeout(function () { self.nextPage(true); }, 300);
        } else {
            this.loader();
            this.nextPage();
        }
    };

    VkScreen.prototype.loader = function () {
        var l = $('<div style="padding:1.5em;opacity:.6;">Загрузка…</div>');
        this.body.append(l);
        this._loadingEl = l;
    };

    VkScreen.prototype.removeLoader = function () {
        if (this._loadingEl) { this._loadingEl.remove(); this._loadingEl = null; }
    };

    VkScreen.prototype.showError = function (msg) {
        var self = this;
        var err = $('<div class="vk-error" style="padding:1.5em;">' + msg +
            '<div class="vk-error__retry selector" style="display:inline-block;margin-top:1em;background:rgba(255,255,255,.1);border-radius:8px;padding:.7em 1.5em;">Повторить</div></div>');
        err.find('.vk-error__retry').on('hover:enter', function () {
            err.remove();
            self.loader();
            self.nextPage();
        });
        this.body.append(err);
    };

    VkScreen.prototype.renderItems = function (items, fromCache) {
        var self = this;
        items.forEach(function (item) {
            if (fromCache && self.items.some(function (x) { return videoKey(x) === videoKey(item); })) return;
            var el = self.buildItemEl(item);
            self.body.append(el);
            self.items.push(item);
        });
    };

    // переопределяется наследниками
    VkScreen.prototype.fetch = function (cb, fail) { cb([], 0); };
    VkScreen.prototype.buildItemEl = function (item) {
        var el = this.cardFor(item);
        var self = this;
        el.on('hover:enter', function () { self.onItem(item, el); });
        return el;
    };
    VkScreen.prototype.cardFor = function (item) { return buildCard(item); };
    VkScreen.prototype.onItem = function (item) {};
    VkScreen.prototype.cacheKey = function () { return null; };

    VkScreen.prototype.nextPage = function (silent) {
        var self = this;
        if (this.loading || this.offset >= this.total) return;
        this.loading = true;
        if (!silent) this.removeLoader();
        this.fetch(function (items, total) {
            self.loading = false;
            self.removeLoader();
            self.total = total;
            self.renderItems(items, false);
            self.offset = self.items.length;
            if (!self.items.length) {
                self.body.append('<div style="padding:1.5em;opacity:.6;">Пока нет видео здесь.</div>');
            }
        }, function (msg) {
            self.loading = false;
            self.removeLoader();
            if (!self.items.length) {
                self.showError(msg);
            } else {
                Lampa.Noty.show(msg);
            }
        });
    };

    VkScreen.prototype.start = function () {
        var self = this;
        Lampa.Controller.add('vk_video_content', {
            toggle: function () {
                var els = (self.authMode || self.body.find('.vk-error').length)
                    ? self.body.find('.selector')
                    : self.body.children();
                Lampa.Controller.collectionSet(els, self.body);
                Lampa.Controller.collectionFocus(false, self.body);
            },
            up: function () { if (Lampa.Controller.move) Lampa.Controller.move('up'); },
            down: function () { if (Lampa.Controller.move) Lampa.Controller.move('down'); },
            right: function () { if (Lampa.Controller.move) Lampa.Controller.move('right'); },
            left: function () { if (Lampa.Controller.move) Lampa.Controller.move('left'); },
            back: function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('vk_video_content');
        this.scroll.onEnd = function () { self.nextPage(); };
    };

    VkScreen.prototype.pause = function () {};
    VkScreen.prototype.stop = function () {};
    VkScreen.prototype.destroy = function () {
        this.html.remove();
        if (this.scroll && this.scroll.destroy) this.scroll.destroy();
    };

    // ------------------------------------------------------------------
    // «Мои видео» (+ действия, «недавно»)
    // ------------------------------------------------------------------

    function VideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cacheKey = function () { return 'vk_video_cache_list'; };

        this.addHeaderActions = function () {
            var actions = $(
                '<div style="display:flex;gap:10px;padding:1.5em 1.5em 0 1.5em;">' +
                '<div class="vk-action selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.7em 1.3em;">🔍 Поиск</div>' +
                '<div class="vk-action selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.7em 1.3em;">🔗 По ссылке</div>' +
                '<div class="vk-action selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.7em 1.3em;">📁 Альбомы</div>' +
                '</div>'
            );
            actions.find('.vk-action').eq(0).on('hover:enter', function () {
                Lampa.Input.edit({
                    title: 'Поиск по видео (мои и доступные)',
                    value: '', free: true, nosave: true, nomic: true, keyboard: 'simple'
                }, function (query) {
                    query = (query || '').trim();
                    if (query) {
                        Lampa.Activity.push({ url: '', title: 'VK: поиск «' + query + '»', component: 'vk_video_search', query: query, page: 1 });
                    }
                });
            });
            actions.find('.vk-action').eq(1).on('hover:enter', function () {
                openByLinkInput(function (parsed) { playVideo(parsed); });
            });
            actions.find('.vk-action').eq(2).on('hover:enter', function () {
                Lampa.Activity.push({ url: '', title: 'VK Video — Альбомы', component: 'vk_video_albums', page: 1 });
            });
            this.html.prepend(actions);
        };

        // «Недавно просмотренные» поверх каталога
        this.addRecentRow = function () {
            var hist = historyList().slice(0, 12);
            if (!hist.length) return;
            var row = $('<div style="padding:1.5em 1.5em 0 1.5em;"><div style="opacity:.6;margin-bottom:.7em;">Недавно просмотренные</div><div class="vk-recent" style="display:flex;gap:12px;flex-wrap:wrap;"></div></div>');
            hist.forEach(function (h) {
                var pct = Math.round(100 * h.time / (h.duration || 1));
                var el = $('<div class="selector" style="max-width:170px;background:rgba(255,255,255,.05);border-radius:8px;padding:.6em;">' +
                    '<div style="font-size:.9em;line-height:1.3;overflow:hidden;max-height:2.6em;">' + Lampa.Utils.shortText(h.title || 'Видео', 40) + '</div>' +
                    '<div style="opacity:.6;font-size:.8em;margin-top:.3em;">' + fmtDuration(h.duration) + ' · ' + pct + '%</div></div>');
                el.on('hover:enter', function () {
                    var parts = h.key.replace('vk:', '').split('_');
                    playVideo({ owner_id: +parts[0], id: +parts[1], title: h.title });
                });
                row.find('.vk-recent').append(el);
            });
            this.html.prepend(row);
        };

        this.create = function () {
            VkScreen.prototype.create.call(this);
            if (getToken()) {
                this.addHeaderActions();
                this.addRecentRow();
            }
            return this.html;
        };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK. Проверьте токен.'); return; }
                apiCall('video.get', {
                    owner_id: owner.id,
                    extended: 1,
                    count: PAGE_SIZE,
                    offset: self.offset
                }, function (res) {
                    var items = res.items || [];
                    cb(items, res.count || 0);
                    if (self.offset === 0) {
                        cacheSet('vk_video_cache_list', { items: items, total: res.count || 0 });
                    }
                }, fail);
            });
        };
    }
    VideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Поиск
    // ------------------------------------------------------------------

    function SearchScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.query = object.query;

        this.fetch = function (cb, fail) {
            apiCall('video.search', {
                q: self.query,
                extended: 1,
                count: PAGE_SIZE,
                offset: self.offset,
                search_global: 0
            }, function (res) {
                cb(res.items || [], res.count || 0);
            }, fail);
        };
    }
    SearchScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Альбомы и видео альбома
    // ------------------------------------------------------------------

    function AlbumsScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cardFor = function (album) {
            return Lampa.Template.get('vk_video_album', {
                title: Lampa.Utils.shortText(album.title || 'Альбом', 60),
                count: (album.count || 0) + ' видео'
            });
        };

        this.onItem = function (album) {
            Lampa.Activity.push({
                url: '',
                title: album.title,
                component: 'vk_video_albums_videos',
                album_id: album.id,
                page: 1
            });
        };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK. Проверьте токен.'); return; }
                apiCall('video.getAlbums', {
                    owner_id: owner.id,
                    count: PAGE_SIZE,
                    offset: self.offset,
                    extended: 1,
                    need_system: 1
                }, function (res) {
                    self.offset += (res.items || []).length;
                    cb(res.items || [], res.count || 0);
                }, fail);
            });
        };
    }
    AlbumsScreen.prototype = Object.create(VkScreen.prototype);

    function AlbumVideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.albumId = object.album_id;

        this.cacheKey = function () { return 'vk_video_cache_album_' + self.albumId; };

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK.'); return; }
                apiCall('video.get', {
                    owner_id: owner.id,
                    album_id: self.albumId,
                    extended: 1,
                    count: PAGE_SIZE,
                    offset: self.offset
                }, function (res) {
                    var items = res.items || [];
                    cb(items, res.count || 0);
                    if (self.offset === 0) {
                        cacheSet('vk_video_cache_album_' + self.albumId, { items: items, total: res.count || 0 });
                    }
                }, fail);
            });
        };
    }
    AlbumVideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Регистрация в Lampa
    // ------------------------------------------------------------------

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.5em;height:1.5em;"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10,8.5 16,12 10,15.5" fill="currentColor" stroke="none"/></svg>';

    function appendMenuItem() {
        if ($('.menu .menu__item--vk-video').length) return;
        var $item = $(
            '<li class="menu__item selector menu__item--vk-video">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">VK Video</div>' +
            '</li>'
        );
        $item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'VK Video — Мои видео',
                component: 'vk_video_main',
                page: 1
            });
        });
        $('.menu .menu__list:eq(0)').append($item);
    }

    function init() {
        if (window[GUARD]) return;
        window[GUARD] = true;

        // Настройки
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addComponent({
                component: 'vk_video_settings',
                name: 'VK Video',
                icon: ICON
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_token', type: 'input', default: '', values: '' },
                field: { name: 'VK Access Token', description: 'Или подключите аккаунт прямо в разделе VK Video' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: {
                    name: 'vk_video_quality',
                    type: 'select',
                    values: { auto: 'Авто (лучшее)', '2160': 'до 4K', '1440': 'до 2K', '1080': 'до 1080p', '720': 'до 720p', '480': 'до 480p', '360': 'до 360p' },
                    default: 'auto'
                },
                field: { name: 'Максимальное качество' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_autonext', type: 'trigger', default: true },
                field: { name: 'Автоматически включать следующее видео' }
            });
        }

        // Компоненты экранов
        Lampa.Component.add('vk_video_main', VideosScreen);
        Lampa.Component.add('vk_video_search', SearchScreen);
        Lampa.Component.add('vk_video_albums', AlbumsScreen);
        Lampa.Component.add('vk_video_albums_videos', AlbumVideosScreen);

        // Манифест
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'VK Video',
                description: 'Свои видео из ВКонтакте: каталог, альбомы, поиск, продолжение просмотра, качества.',
                component: 'vk_video_main'
            };
        } catch (e) {}

        if (window.appready) appendMenuItem();
        else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') appendMenuItem(); });
    }

    init();
})();
