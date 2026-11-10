/*
 * VK Video — плагин для Lampa (lampa.cub.red)
 *
 * Подключает личный аккаунт ВКонтакте через access token (standalone, scope: video)
 * и позволяет смотреть свои видео прямо в Lampa.
 *
 * Установка: Настройки → Расширения → Добавить плагин → URL этого файла (HTTPS).
 */

(function () {
    'use strict';

    var GUARD = 'vk_video_plugin_loaded';
    var VERSION = '1.0.0';

    var API = 'https://api.vk.com/method/';
    var API_V = '5.199';
    var PAGE_SIZE = 50;
    var THROTTLE_MS = 360; // user-token лимит VK ≈ 3 req/s

    // ------------------------------------------------------------------
    // Сеть: VK API с троттлингом и человекопонятными ошибками
    // ------------------------------------------------------------------

    var lastCall = 0;
    var queue = [];
    var queueBusy = false;

    function runQueue() {
        if (queueBusy || !queue.length) return;
        queueBusy = true;
        var task = queue.shift();
        var wait = Math.max(0, THROTTLE_MS - (Date.now() - lastCall));
        setTimeout(function () {
            lastCall = Date.now();
            Lampa.Network.silent(task.url, function (json) {
                queueBusy = false;
                runQueue();
                if (json && json.error) {
                    task.fail(vkErrorMessage(json.error));
                    return;
                }
                task.success((json && json.response) || {});
            }, function () {
                queueBusy = false;
                runQueue();
                task.fail('Нет соединения с api.vk.com');
            });
        }, wait);
    }

    function vkErrorMessage(err) {
        var code = err && err.error_code;
        var msg = (err && err.error_msg) || 'Неизвестная ошибка VK API';
        if (code === 5) return 'Токен VK недействителен или истёк. Получите новый и вставьте его в настройках плагина VK Video.';
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
            fail('Токен VK не задан. Откройте Настройки → VK Video и вставьте access token.');
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
        var url = API + method + '?' + qs.join('&');
        queue.push({ url: url, success: success, fail: fail });
        runQueue();
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
            // image[] отсортирован по возрастанию размера
            return video.image[video.image.length - 1].url;
        }
        return video.photo_640 || video.photo_320 || video.photo_130 || '';
    }

    // CDN-ссылки подписаны и живут часы — храним только в текущей сессии
    var ownerCache = null; // { id, name }

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
    // Воспроизведение
    // ------------------------------------------------------------------

    var QUALITIES = ['mp4_2160', 'mp4_1440', 'mp4_1080', 'mp4_720', 'mp4_480', 'mp4_360', 'mp4_240'];

    function bestFile(files) {
        for (var i = 0; i < QUALITIES.length; i++) {
            if (files && files[QUALITIES[i]]) return files[QUALITIES[i]];
        }
        return '';
    }

    function playVideo(item) {
        // Свежий запрос: CDN-ссылки и hash — ограничены по времени
        var key = item.owner_id + '_' + item.id + (item.access_key ? '_' + item.access_key : '');
        Lampa.Noty.show('Получаем ссылку на видео…');
        apiCall('video.get', { videos: key, extended: 1 }, function (res) {
            var video = res.items && res.items[0];
            if (!video) { Lampa.Noty.show('Видео недоступно.'); return; }
            var url = bestFile(video.files);
            if (url) {
                Lampa.Player.play({
                    title: video.title || item.title,
                    url: url,
                    timeline: { view: 0 }
                });
                Lampa.Player.playlist([{
                    title: video.title || item.title,
                    url: url
                }]);
            } else {
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

    // ------------------------------------------------------------------
    // Шаблоны карточек
    // ------------------------------------------------------------------

    Lampa.Template.add('vk_video_card', [
        '<div class="video__card selector">',
        '<div class="video__imgbox">',
        '<img class="video__img" alt="">',
        '<div class="video__duration" style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.7);padding:2px 5px;border-radius:4px;font-size:.85em;">{duration}</div>',
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

    function buildCard(video) {
        var card = Lampa.Template.get('vk_video_card', {
            title: Lampa.Utils ? Lampa.Utils.shortText(video.title, 60) : video.title,
            duration: fmtDuration(video.duration),
            views: 'Просмотры: ' + (video.views || 0)
        });
        var img = card.find('.video__img')[0];
        if (img) img.src = pickImage(video);
        card.on('hover:enter', function () {
            playVideo(video);
        });
        return card;
    }

    // ------------------------------------------------------------------
    // Базовый экран со скроллом, пагинацией и навигацией
    // ------------------------------------------------------------------

    function VkScreen(object) {
        this.data = object;
        this.items = [];
        this.offset = 0;
        this.total = Infinity;
        this.loading = false;

        this.create = function () {
            this.html = $('<div class="vk-video-screen" style="width:100%;"></div>');
            this.scroll = new Lampa.Scroll({ mask: true, over: true });
            this.scroll.append(this.body = $('<div class="vk-video-grid" style="display:flex;flex-wrap:wrap;gap:12px;padding:1.5em;"></div>'));
            this.html.append(this.scroll.render());
            this.loader();
            this.nextPage();
            return this.html;
        };

        this.render = function () { return this.html; };

        this.loader = function () {
            var l = $('<div style="padding:1.5em;opacity:.6;">Загрузка…</div>');
            this.body.append(l);
            this._loadingEl = l;
        };

        this.removeLoader = function () {
            if (this._loadingEl) { this._loadingEl.remove(); this._loadingEl = null; }
        };

        // Методы, переопределяемые наследниками
        this.fetch = function (cb, fail) { cb([], Infinity); };
        this.onItem = function (item, el) {};

        this.nextPage = function () {
            var self = this;
            if (this.loading || this.offset >= this.total) return;
            this.loading = true;
            this.fetch(function (items, total) {
                self.loading = false;
                self.removeLoader();
                self.total = total;
                items.forEach(function (item) {
                    var el = self.buildItemEl(item);
                    self.body.append(el);
                    self.items.push(item);
                });
                if (!items.length && !self.items.length) {
                    self.body.append('<div style="padding:1.5em;opacity:.6;">Пока нет видео. Загрузите их в VK или проверьте токен.</div>');
                }
            }, function (msg) {
                self.loading = false;
                self.removeLoader();
                self.body.append('<div style="padding:1.5em;">' + msg + '</div>');
            });
        };

        this.buildItemEl = function (item) {
            var el = this.cardFor(item);
            var self = this;
            el.on('hover:enter', function () { self.onItem(item, el); });
            return el;
        };

        this.cardFor = function (item) { return buildCard(item); };

        this.start = function () {
            var self = this;
            Lampa.Controller.add('vk_video_content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(self.body.children());
                    Lampa.Controller.collectionFocus(false, self.body);
                },
                up: function () {
                    if (Navigator && Navigator.move) Navigator.move('up');
                    else Lampa.Controller.move ? Lampa.Controller.move('up') : null;
                },
                down: function () {
                    if (Navigator && Navigator.move) Navigator.move('down');
                    else Lampa.Controller.move ? Lampa.Controller.move('down') : null;
                },
                right: function () {
                    if (Navigator && Navigator.move) Navigator.move('right');
                    else Lampa.Controller.move ? Lampa.Controller.move('right') : null;
                },
                left: function () {
                    if (Navigator && Navigator.move) Navigator.move('left');
                    else Lampa.Controller.move ? Lampa.Controller.move('left') : null;
                },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('vk_video_content');
            // бесконечная подгрузка при доскролле
            this.scroll.onEnd = function () { self.nextPage(); };
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            this.html.remove();
            if (this.scroll && this.scroll.destroy) this.scroll.destroy();
        };
    }

    // ------------------------------------------------------------------
    // Экран «Мои видео»
    // ------------------------------------------------------------------

    function VideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.fetch = function (cb, fail) {
            resolveOwner(function (owner) {
                if (!owner) { fail('Не удалось определить ваш ID VK. Проверьте токен.'); return; }
                apiCall('video.get', {
                    owner_id: owner.id,
                    extended: 1,
                    count: PAGE_SIZE,
                    offset: self.offset
                }, function (res) {
                    self.offset += (res.items || []).length;
                    cb(res.items || [], res.count || 0);
                }, fail);
            });
        };
    }
    VideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Экран альбомов
    // ------------------------------------------------------------------

    function AlbumsScreen(object) {
        VkScreen.call(this, object);
        var self = this;

        this.cardFor = function (album) {
            var el = Lampa.Template.get('vk_video_album', {
                title: Lampa.Utils ? Lampa.Utils.shortText(album.title, 60) : album.title,
                count: (album.count || 0) + ' видео'
            });
            return el;
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
                    extended: 1
                }, function (res) {
                    self.offset += (res.items || []).length;
                    cb(res.items || [], res.count || 0);
                }, fail);
            });
        };
    }
    AlbumsScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Экран видео внутри альбома
    // ------------------------------------------------------------------

    function AlbumVideosScreen(object) {
        VkScreen.call(this, object);
        var self = this;
        this.albumId = object.album_id;

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
                    self.offset += (res.items || []).length;
                    cb(res.items || [], res.count || 0);
                }, fail);
            });
        };
    }
    AlbumVideosScreen.prototype = Object.create(VkScreen.prototype);

    // ------------------------------------------------------------------
    // Регистрация в Lampa
    // ------------------------------------------------------------------

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:1.5em;height:1.5em;"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10,8.5 16,12 10,15.5" fill="currentColor" stroke="none"/></svg>';

    function register() {
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
                field: { name: 'VK Access Token' }
            });
        }

        // Компоненты экранов
        Lampa.Component.add('vk_video_main', VideosScreen);
        Lampa.Component.add('vk_video_albums', AlbumsScreen);
        Lampa.Component.add('vk_video_albums_videos', AlbumVideosScreen);

        // Манифест
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'VK Video',
                description: 'Свои видео из ВКонтакте: список, альбомы, просмотр.',
                component: 'vk_video_main'
            };
        } catch (e) {}

    }

    // Пункт в главном меню
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
                field: { name: 'VK Access Token' }
            });
        }

        // Компоненты экранов
        Lampa.Component.add('vk_video_main', VideosScreen);
        Lampa.Component.add('vk_video_albums', AlbumsScreen);
        Lampa.Component.add('vk_video_albums_videos', AlbumVideosScreen);

        // Манифест
        try {
            Lampa.Manifest.plugins = {
                type: 'video',
                version: VERSION,
                name: 'VK Video',
                description: 'Свои видео из ВКонтакте: список, альбомы, просмотр.',
                component: 'vk_video_main'
            };
        } catch (e) {}

        if (window.appready) appendMenuItem();
        else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') appendMenuItem(); });
    }

    init();
})();
