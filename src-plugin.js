/*
 * VK Video — плагин для Lampa (lampa.cub.red)
 *
 * Личный аккаунт ВКонтакте в Lampa: каталог, альбомы, сообщества, поиск,
 * продолжение просмотра, выбор качества и скорости, избранное, авто-next,
 * открытие по ссылке, скачивание разрешённых видео.
 *
 * Сборка: build.sh -> vk-video.js (src-utils.js + src-plugin.js + vendor/qrcode-lib.js).
 */

(function () {
    'use strict';

    var GUARD = 'vk_video_plugin_loaded';
    var VERSION = '1.3.0';
    var UPDATE_URL = 'https://shangri0la.github.io/vk-lampa-plugin/version.json';

    var API = 'https://api.vk.com/method/';
    var API_V = '5.199';
    var PAGE_SIZE = 50;
    var THROTTLE_MS = 360;      // user-token лимит VK ≈ 3 req/s
    var REQUEST_TIMEOUT = 20000;
    var RESOLVE_TTL = 20 * 60 * 1000; // подписанные CDN-ссылки живут часами; кэш на 20 минут

    // Публичное standalone-приложение по умолчанию (Kate Mobile — единственное
    // живое; VK отключил остальные). Можно заменить своим app_id в настройках.
    var AUTH_APP_ID = '2685278';

    function authAppId() {
        try {
            return (Lampa.Storage.field('vk_video_appid') || '').trim() || AUTH_APP_ID;
        } catch (e) {
            return AUTH_APP_ID;
        }
    }

    function buildAuthUrl(withGroups) {
        var scope = withGroups ? 'video,groups,offline' : 'video,offline';
        return 'https://oauth.vk.com/authorize?client_id=' + authAppId() +
            '&display=page&scope=' + scope + '&response_type=token&v=' + API_V;
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
    // Локальные списки: история просмотра, избранное, кэш каталога
    // ------------------------------------------------------------------

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

    function favoritesList() {
        return Lampa.Storage.get('vk_video_favorites', []) || [];
    }

    function favoritesHas(item) {
        var key = VKU.videoKey(item);
        return favoritesList().some(function (f) { return f.key === key; });
    }

    function favoritesToggle(video) {
        var key = VKU.videoKey(video);
        if (favoritesHas(video)) {
            var without = favoritesList().filter(function (f) { return f.key !== key; });
            Lampa.Storage.set('vk_video_favorites', without.slice(0, 100));
            return false;
        }
        var list = favoritesList();
        list.unshift({
            key: key,
            owner_id: video.owner_id,
            id: video.id,
            access_key: video.access_key || '',
            title: video.title || 'Видео',
            duration: video.duration || 0,
            views: video.views || 0,
            __img: VKU.pickImage(video),
            date: Date.now()
        });
        Lampa.Storage.set('vk_video_favorites', list.slice(0, 100));
        return true;
    }

    function cacheGet(key) {
        return Lampa.Storage.get(key, null);
    }

    function cacheSet(key, val) {
        Lampa.Storage.set(key, val);
    }

    // ------------------------------------------------------------------
    // Кэш разрешённых ссылок (в памяти, 20 минут)
    // ------------------------------------------------------------------

    var resolveCache = {};

    function resolveVideo(item, cb, fail) {
        var key = VKU.videoKey(item);
        var hit = resolveCache[key];
        if (hit && Date.now() - hit.ts < RESOLVE_TTL) { cb(hit.video); return; }

        var videosParam = item.owner_id + '_' + item.id + (item.access_key ? '_' + item.access_key : '');
        apiCall('video.get', { videos: videosParam, extended: 1 }, function (res) {
            var video = res.items && res.items[0];
            if (!video) { fail('Видео недоступно.'); return; }
            video.access_key = item.access_key || video.access_key || '';
            resolveCache[key] = { ts: Date.now(), video: video };
            cb(video);
        }, fail);
    }

    // ------------------------------------------------------------------
    // Плеер: качества, скорость, авто-next, прогресс
    // ------------------------------------------------------------------

    function maxQualitySetting() {
        try {
            var q = Lampa.Storage.field('vk_video_quality') || 'auto';
            return q === 'auto' ? 9999 : parseInt(q, 10);
        } catch (e) {
            return 9999;
        }
    }

    function playbackRateSetting() {
        try {
            var r = parseFloat(Lampa.Storage.field('vk_video_rate') || '1');
            return r > 0 ? r : 1;
        } catch (e) {
            return 1;
        }
    }

    function autoNextEnabled() {
        try {
            var v = Lampa.Storage.field('vk_video_autonext');
            return v === undefined || v === null || v === true || v === '1' || v === 'true';
        } catch (e) {
            return true;
        }
    }

    var playQueue = [];
    var playerHooked = false;

    function setPlayQueue(items, startIndex) {
        playQueue = items.slice(startIndex + 1).map(function (v) {
            return { owner_id: v.owner_id, id: v.id, access_key: v.access_key || '', title: v.title };
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
                if (!el) return;
                try { el.playbackRate = playbackRateSetting(); } catch (e) {}
                if (!el.__vk_next_hook) {
                    el.__vk_next_hook = true;
                    el.addEventListener('ended', onEnded);
                }
            }, 700);
        });

        Lampa.Player.listener.follow('destroy', function () {
            playQueue = [];
            stopProgressMonitor();
        });
    }

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
    // Воспроизведение
    // ------------------------------------------------------------------

    function resumeTime(item) {
        var h = historyFind(VKU.videoKey(item));
        if (h && h.duration > 0) {
            var pct = h.time / h.duration;
            if (pct > 0.03 && pct < 0.95) return h.time;
        }
        return 0;
    }

    function playVideo(item, opts) {
        opts = opts || {};
        var key = VKU.videoKey(item);
        hookPlayer();
        if (!opts.silent) Lampa.Noty.show('Получаем ссылку на видео…');

        resolveVideo(item, function (video) {
            var map = VKU.qualityMap(video.files, maxQualitySetting());
            var url = VKU.bestInMap(map);
            var reserve = VKU.reserveInMap(map);

            var title = video.title || item.title || 'VK Video';
            var time = opts.startOver ? 0 : resumeTime(item);

            setPlayQueue([video], 0);

            if (url) {
                Lampa.Player.play({
                    title: title,
                    url: url,
                    quality: Object.keys(map).length > 1 ? map : undefined,
                    url_reserve: reserve || undefined,
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

    // Скачивание: только то, что VK сам разрешил (can_download)
    function downloadVideo(video) {
        resolveVideo(video, function (fresh) {
            if (!fresh.can_download) {
                Lampa.Noty.show('VK не разрешает скачивать это видео.');
                return;
            }
            var map = VKU.qualityMap(fresh.files, maxQualitySetting());
            var url = VKU.bestInMap(map);
            if (!url) { Lampa.Noty.show('Прямой файл недоступен.'); return; }
            var w = window.open(url, '_blank');
            if (!w) {
                Lampa.Utils.copyTextToClipboard(url, function () {
                    Lampa.Noty.show('Ссылка на файл скопирована — откройте её в браузере.');
                }, function () {
                    Lampa.Noty.show('Не удалось открыть ссылку на файл.');
                });
            }
        }, function (msg) {
            Lampa.Noty.show(msg);
        });
    }

    // ------------------------------------------------------------------
    // Меню карточки (долгое нажатие)
    // ------------------------------------------------------------------

    function openCardMenu(video) {
        var inFav = favoritesHas(video);
        var items = [
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
                title: inFav ? 'Убрать из избранного' : '★ В избранное',
                subtitle: 'локальный список на этом устройстве',
                onSelect: function () {
                    var added = favoritesToggle(video);
                    Lampa.Noty.show(added ? 'Добавлено в избранное.' : 'Убрано из избранного.');
                }
            },
            {
                title: 'Скопировать ссылку',
                subtitle: 'ссылка на страницу видео VK',
                onSelect: function () {
                    Lampa.Utils.copyTextToClipboard(VKU.pageUrl(video), function () {
                        Lampa.Noty.show('Ссылка скопирована.');
                    }, function () {
                        Lampa.Noty.show('Не удалось скопировать.');
                    });
                }
            }
        ];
        if (video.can_download) {
            items.push({
                title: '⬇ Скачать',
                subtitle: 'VK разрешает скачивание этого видео',
                onSelect: function () { downloadVideo(video); }
            });
        }
        Lampa.Select.show({
            title: video.title || 'VK Видео',
            items: items,
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
            var parsed = VKU.parseVkVideoLink(value);
            if (!parsed) {
                Lampa.Noty.show('Не распознали ссылку. Поддерживаются vk.com, vk.ru, vkvideo.ru.');
                return;
            }
            onFound(parsed);
        });
    }

    function buildAuthPanel(onConnected, withGroups) {
        var url = buildAuthUrl(withGroups);
        var extra = withGroups
            ? '<div style="margin-top:.5em;color:#7fb2ff;">Права сообществ включены: после входа откроются видео ваших групп.</div>'
            : '';
        var panel = $(
            '<div class="vk-auth" style="max-width:640px;margin:0 auto;padding:2em 1.5em;">' +
            '<div style="font-size:1.4em;margin-bottom:.4em;">VK Видео — подключение аккаунта</div>' +
            '<div style="opacity:.7;white-space:pre-line;line-height:1.5;">' + AUTH_STEPS + '</div>' + extra +
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

    Lampa.Template.add('vk_video_group', [
        '<div class="video__card selector">',
        '<div class="video__imgbox" style="display:flex;align-items:center;justify-content:center;height:110px;background:rgba(255,255,255,.06);border-radius:8px;">',
        '<img style="max-width:70px;max-height:70px;border-radius:12px;" src="{img}">',
        '</div>',
        '<div class="video__title" style="margin-top:6px;">{title}</div>',
        '<div class="video__views">{count}</div>',
        '</div>'
    ].join(''));

    function resumeBadge(video) {
        var h = historyFind(VKU.videoKey(video));
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
            duration: VKU.fmtDuration(video.duration),
            views: 'Просмотры: ' + (video.views || 0),
            badge: resumeBadge(video)
        });
        var img = card.find('.video__img')[0];
        if (img) img.src = VKU.pickImage(video);
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

    VkScreen.prototype.showAuth = function (withGroups) {
        this.authMode = true;
        var self = this;
        this.body.empty();
        this.body.append(buildAuthPanel(function () {
            // экран пересоздаётся целиком: появятся действия, «недавно» и каталог
            self.authMode = false;
            if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
            else { self.body.empty(); self.bootstrap(); }
        }, withGroups));
    };

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

    // Ошибка + «Повторить»; наследники могут переопределить (сообщества — доп. кнопка)
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
            if (fromCache && self.items.some(function (x) { return VKU.videoKey(x) === VKU.videoKey(item); })) return;
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
    VkScreen.prototype.sortItems = null; // 'date'|'title'|'duration' или null

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

    // Локальная пересортировка уже показанных карточек
    VkScreen.prototype.resortGrid = function () {
        if (!this.sortItems || !this.items.length) return;
        var sort = this.sortItems;
        var sorted = this.items.slice().sort(function (a, b) {
            if (sort === 'title') return (a.title || '').localeCompare(b.title || '', 'ru');
            if (sort === 'duration') return (b.duration || 0) - (a.duration || 0);
            return 0; // date: VK уже отдаёт новые первыми
        });
        this.body.children().remove();
        this.items = [];
        this.renderItems(sorted, false);
    };

    VkScreen.prototype.start = function () {
        var self = this;
        Lampa.Controller.add('vk_video_content', {
            toggle: function () {
                if (!self.body || !self.body[0]) return;
                var els = (self.authMode || self.body.find('.vk-error').length)
                    ? self.body.find('.selector')
                    : self.body.children();
                try {
                    Lampa.Controller.collectionSet(els);
                    Lampa.Controller.collectionFocus(false, self.body[0]);
                } catch (e) {}
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

    // Строка действий под шапкой экрана
    VkScreen.prototype.buildActions = function (defs) {
        var html = '<div class="vk-actions" style="display:flex;gap:10px;padding:1.5em 1.5em 0 1.5em;flex-wrap:wrap;">';
        defs.forEach(function (d) {
            html += '<div class="vk-action selector" style="background:rgba(255,255,255,.08);border-radius:8px;padding:.7em 1.3em;">' + d.title + '</div>';
        });
        html += '</div>';
        var row = $(html);
        row.find('.vk-action').each(function (i) {
            if (defs[i].onEnter) $(this).on('hover:enter', defs[i].onEnter);
        });
        return row;
    };

    // ------------------------------------------------------------------
    // «Мои видео»
    // ------------------------------------------------------------------

    function VideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cacheKey = function () { return 'vk_video_cache_list'; };
        this.sortItems = 'date';
        try { this.sortItems = Lampa.Storage.field('vk_video_sort') || 'date'; } catch (e) {}

        this.addHeaderActions = function () {
            this.html.prepend(this.buildActions([
                {
                    title: '🔍 Поиск',
                    onEnter: function () {
                        Lampa.Input.edit({
                            title: 'Поиск по видео (мои и доступные)',
                            value: '', free: true, nosave: true, nomic: true, keyboard: 'simple'
                        }, function (query) {
                            query = (query || '').trim();
                            if (query) {
                                Lampa.Activity.push({ url: '', title: 'VK: поиск «' + query + '»', component: 'vk_video_search', query: query, page: 1 });
                            }
                        });
                    }
                },
                {
                    title: '★ Избранное',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Избранное', component: 'vk_video_favorites', page: 1 });
                    }
                },
                {
                    title: '📁 Альбомы',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Альбомы', component: 'vk_video_albums', page: 1 });
                    }
                },
                {
                    title: '👥 Сообщества',
                    onEnter: function () {
                        Lampa.Activity.push({ url: '', title: 'VK Video — Сообщества', component: 'vk_video_communities', page: 1 });
                    }
                },
                {
                    title: '⇅ Сортировка',
                    onEnter: function () {
                        Lampa.Select.show({
                            title: 'Сортировка',
                            items: [
                                { title: 'По дате (новые)', sort: 'date' },
                                { title: 'По названию', sort: 'title' },
                                { title: 'По длительности', sort: 'duration' }
                            ],
                            onSelect: function (a) {
                                Lampa.Storage.set('vk_video_sort', a.sort);
                                self.sortItems = a.sort;
                                self.resortGrid();
                                Lampa.Controller.toggle('vk_video_content');
                            },
                            onBack: function () { Lampa.Controller.toggle('vk_video_content'); }
                        });
                    }
                },
                {
                    title: '🔗 По ссылке',
                    onEnter: function () {
                        openByLinkInput(function (parsed) { playVideo(parsed); });
                    }
                },
                {
                    title: '🔄 Обновить',
                    onEnter: function () {
                        cacheSet('vk_video_cache_list', null);
                        if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
                    }
                }
            ]));
        };

        this.addRecentRow = function () {
            var hist = historyList().slice(0, 12);
            if (!hist.length) return;
            var row = $('<div style="padding:1.5em 1.5em 0 1.5em;"><div style="opacity:.6;margin-bottom:.7em;">Недавно просмотренные</div><div class="vk-recent" style="display:flex;gap:12px;flex-wrap:wrap;"></div></div>');
            hist.forEach(function (h) {
                var pct = Math.round(100 * h.time / (h.duration || 1));
                var el = $('<div class="selector" style="max-width:170px;background:rgba(255,255,255,.05);border-radius:8px;padding:.6em;">' +
                    '<div style="font-size:.9em;line-height:1.3;overflow:hidden;max-height:2.6em;">' + Lampa.Utils.shortText(h.title || 'Видео', 40) + '</div>' +
                    '<div style="opacity:.6;font-size:.8em;margin-top:.3em;">' + VKU.fmtDuration(h.duration) + ' · ' + pct + '%</div></div>');
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
                this.addRecentRow();
                this.addHeaderActions();
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
    // Избранное (локальный список)
    // ------------------------------------------------------------------

    function FavoritesScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.fetch = function (cb) {
            var list = favoritesList();
            cb(list, list.length);
        };

        this.create = function () {
            VkScreen.prototype.create.call(this);
            if (getToken() && !favoritesList().length) {
                this.body.append('<div style="padding:1.5em;opacity:.6;">Пусто. Добавляйте видео через долгое нажатие на карточку → «★ В избранное».</div>');
            }
            return this.html;
        };
    }
    FavoritesScreen.prototype = Object.create(VkScreen.prototype);

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
    // Сообщества и их видео
    // ------------------------------------------------------------------

    function CommunitiesScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cacheKey = function () { return 'vk_video_cache_communities'; };

        this.cardFor = function (group) {
            return Lampa.Template.get('vk_video_group', {
                title: Lampa.Utils.shortText(group.name || 'Сообщество', 60),
                img: group.photo_200 || group.photo_100 || '',
                count: group.members_count ? group.members_count + ' участников' : ''
            });
        };

        this.onItem = function (group) {
            Lampa.Activity.push({
                url: '',
                title: group.name,
                component: 'vk_video_community_videos',
                group_id: group.id,
                page: 1
            });
        };

        // Не хватило прав (токен без groups) — предлагаем переподключение
        this.showError = function (msg) {
            var self2 = this;
            var err = $('<div class="vk-error" style="padding:1.5em;">' + msg +
                '<div style="margin-top:1em;display:flex;gap:10px;flex-wrap:wrap;">' +
                '<div class="vk-error__retry selector" style="display:inline-block;background:rgba(255,255,255,.1);border-radius:8px;padding:.7em 1.5em;">Повторить</div>' +
                '<div class="vk-error__reauth selector" style="display:inline-block;background:#0077FF;border-radius:8px;padding:.7em 1.5em;">Переподключить с правами сообществ</div>' +
                '</div></div>');
            err.find('.vk-error__retry').on('hover:enter', function () {
                err.remove();
                self2.loader();
                self2.nextPage();
            });
            err.find('.vk-error__reauth').on('hover:enter', function () {
                self2.showAuth(true);
            });
            this.body.append(err);
        };

        this.fetch = function (cb, fail) {
            apiCall('groups.get', {
                extended: 1,
                count: 100,
                offset: self.offset,
                fields: 'members_count,photo_200,photo_100'
            }, function (res) {
                var items = res.items || [];
                cb(items, res.count || 0);
                if (self.offset === 0) {
                    cacheSet('vk_video_cache_communities', { items: items, total: res.count || 0 });
                }
            }, fail);
        };
    }
    CommunitiesScreen.prototype = Object.create(VkScreen.prototype);

    function CommunityVideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.groupId = object.group_id;

        this.cacheKey = function () { return 'vk_video_cache_group_' + self.groupId; };

        this.fetch = function (cb, fail) {
            apiCall('video.get', {
                owner_id: -self.groupId,
                extended: 1,
                count: PAGE_SIZE,
                offset: self.offset
            }, function (res) {
                var items = res.items || [];
                cb(items, res.count || 0);
                if (self.offset === 0) {
                    cacheSet('vk_video_cache_group_' + self.groupId, { items: items, total: res.count || 0 });
                }
            }, fail);
        };
    }
    CommunityVideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Проверка обновлений
    // ------------------------------------------------------------------

    function scheduleUpdateCheck() {
        setTimeout(function () {
            try {
                Lampa.Network.silent(UPDATE_URL + '?v=' + VERSION, function (json) {
                    if (json && json.version && VKU.versionNewer(VERSION, json.version)) {
                        Lampa.Noty.show('VK Video: доступна новая версия ' + json.version + '. Переустановите плагин по своему URL.');
                    }
                }, function () {});
            } catch (e) {}
        }, 45000);
    }

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
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: {
                    name: 'vk_video_rate',
                    type: 'select',
                    values: { '1': 'Обычная', '1.25': '1.25x', '1.5': '1.5x', '2': '2x' },
                    default: '1'
                },
                field: { name: 'Скорость воспроизведения', description: 'Работает там, где плеер устройства позволяет' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_appid', type: 'input', default: '', values: '' },
                field: { name: 'VK App ID (своё приложение)', description: 'Оставьте пустым, чтобы использовать встроенное. Пригодится, если VK закроет встроенное' }
            });
            Lampa.SettingsApi.addParam({
                component: 'vk_video_settings',
                param: { name: 'vk_video_version', type: 'input', default: VERSION, values: '' },
                field: { name: 'Версия плагина' }
            });
        }

        // Компоненты экранов
        Lampa.Component.add('vk_video_main', VideosScreen);
        Lampa.Component.add('vk_video_search', SearchScreen);
        Lampa.Component.add('vk_video_favorites', FavoritesScreen);
        Lampa.Component.add('vk_video_albums', AlbumsScreen);
        Lampa.Component.add('vk_video_albums_videos', AlbumVideosScreen);
        Lampa.Component.add('vk_video_communities', CommunitiesScreen);
        Lampa.Component.add('vk_video_community_videos', CommunityVideosScreen);

        // Манифест
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'VK Video',
                description: 'Свои видео из ВКонтакте: каталог, альбомы, сообщества, поиск, продолжение, качества.',
                component: 'vk_video_main'
            };
        } catch (e) {}

        if (window.appready) {
            appendMenuItem();
            scheduleUpdateCheck();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    appendMenuItem();
                    scheduleUpdateCheck();
                }
            });
        }
    }

    init();
})();
