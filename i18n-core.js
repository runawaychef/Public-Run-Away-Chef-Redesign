// ==================== i18n: ЯДРО (без переводов) ====================
// Архитектура с 21.07.2026: раньше все языки жили в одном файле i18n.js —
// при 2 языках (RU/EN) это было нормально (33 КБ gzip на оба), но с ростом
// до ~10 языков грузить их все всегда стало бы ощутимо (~165 КБ gzip только
// на переводы при каждом запуске). Поэтому: один язык — один файл
// (i18n-ru.js, i18n-en.js, ...), а здесь — только логика.
//
// При старте загружаются ТОЛЬКО: EN (базовый язык, всегда — см. ниже, почему)
// + определённый язык пользователя (сохранённый выбор или navigator.language),
// если он отличается от EN. Остальные языки подгружаются лениво, только если
// пользователь явно переключится на них в Настройках (см. setLang()).
//
// Базовый язык — АНГЛИЙСКИЙ (не русский): используется как язык по умолчанию
// и как аварийный откат, если для ключа нет перевода на текущем языке —
// поэтому I18N.en должен быть загружен ВСЕГДА, при любом выбранном языке.
//
// Как эти файлы гарантированно успевают загрузиться ДО того, как остальной
// код (который вызывает t()/applyI18n()) начнёт выполняться — без переделки
// сложной последовательности запуска приложения (мгновенный запуск из кэша +
// таймер сплэша в index.html, см. комментарии там): используем document.write()
// в конце этого файла. Он выполняется синхронно прямо во время разбора HTML
// и приостанавливает его до тех пор, пока дописанные <script> теги не
// загрузятся и не выполнятся — то есть к моменту, когда браузер продолжит
// разбирать остальные <script> приложения, нужные словари уже гарантированно
// на месте. Старомодный приём, но ровно то, что нужно в проекте без сборщика
// и без ES-модулей: простой, синхронный, без гонки состояний.
//
// Как добавить новый язык в будущем: (1) создать i18n-XX.js по образцу
// i18n-en.js/i18n-ru.js; (2) добавить код языка в SUPPORTED_LANGS ниже;
// (3) добавить файл в список кэша service worker'а (sw.js ASSETS);
// (4) добавить кнопку/пункт в переключатель языка в интерфейсе.

// LANG_META — единственное место, где перечислены поддерживаемые языки.
// Чтобы добавить новый: (1) создать i18n-XX.js по образцу i18n-en.js;
// (2) добавить строку сюда; (3) добавить файл в список кэша sw.js ASSETS.
// native — как язык называется сам на себе (для списка выбора), english —
// название на английском (подпись помельче рядом, для однозначности).
const LANG_META = {
    en: { native: 'English',    english: 'English' },
    ru: { native: 'Русский',    english: 'Russian' },
    lt: { native: 'Lietuvių',   english: 'Lithuanian' },
    pl: { native: 'Polski',     english: 'Polish' },
    uk: { native: 'Українська', english: 'Ukrainian' },
    de: { native: 'Deutsch',    english: 'German' },
};
const SUPPORTED_LANGS = Object.keys(LANG_META);
const BASE_LANG = 'en';

// Кэш промисов загрузки — чтобы не запрашивать один и тот же файл языка
// повторно, если пользователь быстро дважды переключит язык туда-обратно.
const _langLoadPromises = {};

function _loadLangScript(lang) {
    if (I18N[lang]) return Promise.resolve(); // уже загружен
    if (_langLoadPromises[lang]) return _langLoadPromises[lang];
    _langLoadPromises[lang] = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `i18n-${lang}.js?v=6`;
        script.onload = () => resolve();
        script.onerror = () => {
            console.error(`Не удалось загрузить язык: ${lang}`);
            delete _langLoadPromises[lang];
            resolve(); // не блокируем приложение навсегда из-за одного языка
        };
        document.head.appendChild(script);
    });
    return _langLoadPromises[lang];
}

window.I18N = window.I18N || {};
const I18N = window.I18N;

let currentLang = localStorage.getItem('appLang');
if (!currentLang) {
    // Первый запуск: если системный язык телефона совпадает с одним из
    // поддерживаемых — используем его, иначе базовый (английский).
    const sysLang = (navigator.language || '').toLowerCase().slice(0, 2);
    currentLang = SUPPORTED_LANGS.includes(sysLang) ? sysLang : BASE_LANG;
}
if (!SUPPORTED_LANGS.includes(currentLang)) currentLang = BASE_LANG;

function t(key) {
    const dict = I18N[currentLang] || I18N[BASE_LANG] || {};
    if (dict[key] !== undefined) return dict[key];
    const base = I18N[BASE_LANG];
    if (base && base[key] !== undefined) return base[key];
    return key;
}

// В отличие от setLang() ниже (переключает язык ВСЕГО интерфейса), эта
// функция используется там, где нужно дождаться конкретного языка перед
// использованием (например, перед генерацией документа на выбранном языке).
async function ensureLangLoaded(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    await _loadLangScript(lang);
}

async function setLang(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return;
    await _loadLangScript(lang);
    currentLang = lang;
    localStorage.setItem('appLang', lang);
    applyI18n();
    updateLangSwitcherUI();
    // Текст тарифа (Тариф/Лимиты) собирается в JS и зависит от языка —
    // перерисовываем, если функция уже подключена (inventory.js).
    if (typeof renderPlanInfo === 'function') renderPlanInfo();
    // Страна/валюта в окне "Информация о компании" — та же логика (company.js).
    if (typeof refreshCompanyLangDependentUI === 'function') refreshCompanyLangDependentUI();
    if (typeof refreshVatLabels === 'function') refreshVatLabels();
    if (typeof syncPushLangIfSubscribed === 'function') syncPushLangIfSubscribed();
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = currentLang;
}

// Общий рендер переключателя "EN | <второй язык>" — используется и для языка
// интерфейса (Настройки), и для языка документа (окно счёта/накладной).
// Если второй язык совпадает с английским — показывает только одну кнопку
// (переключатель "EN | EN" не имеет смысла).
function renderLangSwitcher(containerId, secondLang, activeLang, onClickFnName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const options = secondLang === BASE_LANG ? [BASE_LANG] : [BASE_LANG, secondLang];
    el.innerHTML = options.map(code =>
        `<button type="button" class="${code === activeLang ? 'active' : ''}" onclick="${onClickFnName}('${code}')">${code.toUpperCase()}</button>`
    ).join('');
}

// Подпись на кнопке "выбрать второй язык" — родное название текущего
// выбранного второго языка. Кнопка скрывается, если выбран сам английский
// (тогда нечего показывать во втором слоте — переключатель однокнопочный).
function updateLangPickButtonLabel() {
    const btn = document.getElementById('langPickBtn');
    if (!btn) return;
    if (currentLang === BASE_LANG) {
        btn.classList.add('hidden');
        return;
    }
    btn.classList.remove('hidden');
    const label = btn.querySelector('.lang-pick-label');
    const native = (LANG_META[currentLang] && LANG_META[currentLang].native) || currentLang.toUpperCase();
    if (label) label.textContent = `${native} · ${t('lang_pick_change_suffix')}`;
}

function updateLangSwitcherUI() {
    renderLangSwitcher('langSwitchContainer', currentLang, currentLang, 'setLang');
    updateLangPickButtonLabel();
    // Переключатель языка документа обновляем тоже, если он сейчас на экране
    // (invoice.js) — тот же второй язык, но своя активная кнопка (_docPreview.lang).
    if (typeof updateDocumentLangSwitcherUI === 'function') updateDocumentLangSwitcherUI();
}

// ---- Модалка выбора "второго" языка (кроме английского, он всегда доступен) ----
function openLangPickerModal() {
    const list = document.getElementById('langPickerList');
    if (list) {
        list.innerHTML = SUPPORTED_LANGS.filter(code => code !== BASE_LANG).map(code => {
            const meta = LANG_META[code];
            const selected = code === currentLang;
            return `<div class="lang-list-item${selected ? ' selected' : ''}" onclick="selectSecondLang('${code}')">
                <span>${meta.native} <span class="lang-native-hint">${meta.english}</span></span>
                ${selected ? '<svg class="lang-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>' : ''}
            </div>`;
        }).join('');
    }
    document.getElementById('langPickerModal').style.display = 'flex';
}

async function selectSecondLang(code) {
    document.getElementById('langPickerModal').style.display = 'none';
    await setLang(code);
}

document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    updateLangSwitcherUI();
});

// ---- Синхронная загрузка нужных языков ДО разбора остального HTML ----
// EN — всегда (базовый язык + аварийный откат). Плюс currentLang, если он
// отличается от EN. document.write выполняется прямо сейчас, во время
// разбора этого <script>, и гарантированно приостанавливает разбор
// документа до полной загрузки дописанных тегов.
(function bootLoadLanguages() {
    let tags = `<script src="i18n-${BASE_LANG}.js?v=2"><\/script>`;
    if (currentLang !== BASE_LANG) {
        tags += `<script src="i18n-${currentLang}.js?v=2"><\/script>`;
    }
    document.write(tags);
})();
