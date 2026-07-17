// ==================== ВСПОМОГАТЕЛЬНЫЕ ====================
// Заполнение выпадающих списков (изделия/клиенты) и SVG-иконки действий
// (редактировать/удалить/копировать), используемые во всех модулях.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: products/customers (главный скрипт).

// Возвращает текущую дату в локальном часовом поясе в формате YYYY-MM-DD.
// Важно: НЕ использовать toISOString() — она возвращает UTC, что в Литве
// (UTC+3) даёт неверный день в ночное время (с 00:00 до 03:00).
function getLocalDateStr(offsetDays) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ── Отложенное списание склада для заказов далеко вперёд ────────────────────
// Если заказ на дату больше чем через N дней — списывать сырьё сразу рано:
// его может ещё не быть на складе, аналитика начнёт врать (уйдёт в минус).
// Вместо этого откладываем списание до момента, когда до заказа останется N дней.
const INVENTORY_PENDING_DAYS = 7;

// true = списывать сейчас (заказ сегодня, в прошлом, или в пределах ближайших N дней)
function shouldWriteOffNow(orderDateStr) {
    if (!orderDateStr) return true;
    const limit = getLocalDateStr(INVENTORY_PENDING_DAYS);
    return orderDateStr <= limit; // сравнение строк YYYY-MM-DD работает как числовое
}

// Дата, когда должно произойти отложенное списание (дата заказа минус N дней)
function getWriteOffDate(orderDateStr) {
    const [y, m, d] = orderDateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - INVENTORY_PENDING_DAYS);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// Простое уведомление (замена системного alert()) — одна кнопка "ОК".
// Переиспользует confirmModal, временно пряча кнопку "Отмена".
function showInfo(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        if (!modal || !msgEl || !okBtn || !cancelBtn) { window.alert(message); resolve(); return; }

        msgEl.textContent = message;
        cancelBtn.classList.add('hidden');
        modal.style.display = 'flex';

        function cleanup() {
            modal.style.display = 'none';
            cancelBtn.classList.remove('hidden');
            okBtn.removeEventListener('click', onOk);
            resolve();
        }
        function onOk() { cleanup(); }
        okBtn.addEventListener('click', onOk);
    });
}

// Окно подтверждения в стиле приложения (замена системного confirm(),
// которое на Android/Chrome всегда показывает адрес сайта в заголовке —
// это выглядит как "чужое"/системное окно, а не часть приложения).
// Использование: const ok = await showConfirm('Сменить сотрудника?');
function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const msgEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        if (!modal || !msgEl || !okBtn || !cancelBtn) { resolve(window.confirm(message)); return; }

        msgEl.textContent = message;
        modal.style.display = 'flex';

        function cleanup(result) {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// Открывает короткую подсказку по маркеру "?" — универсальная модалка для
// любого раздела интерфейса. titleKey/textKey — ключи словаря i18n.js.
// textKey может содержать несколько абзацев через "\n\n" — каждый
// оборачивается в свой <p>. Текст статический (из словаря, не от
// пользователя), но экранируем на всякий случай тем же escapeHtml,
// что и везде в приложении.
// moreKey — необязательный: ключ с дополнительными абзацами. Если задан,
// показывает кнопку "Подробнее", которая ДОРИСОВЫВАЕТ эти абзацы в конец
// текста прямо в этой же модалке (не уводит в FAQ — решили не дублировать
// подробное объяснение в двух местах, чтобы не разъезжалось при правках).
function showHelpModal(titleKey, textKey, moreKey) {
    const titleEl = document.getElementById('helpModalTitle');
    const textEl = document.getElementById('helpModalText');
    const modal = document.getElementById('helpModal');
    const moreBtn = document.getElementById('helpModalMoreBtn');
    if (!titleEl || !textEl || !modal) return;

    const renderParagraphs = (key) => t(key)
        .split('\n\n')
        .map(p => `<p class="mb-2">${escapeHtml(p)}</p>`)
        .join('');

    titleEl.textContent = t(titleKey);
    textEl.innerHTML = renderParagraphs(textKey);

    if (moreBtn) {
        if (moreKey) {
            moreBtn.classList.remove('hidden');
            moreBtn.onclick = () => {
                textEl.insertAdjacentHTML('beforeend', renderParagraphs(moreKey));
                moreBtn.classList.add('hidden');
            };
        } else {
            moreBtn.classList.add('hidden');
        }
    }
    modal.style.display = 'flex';
}

// Экранирование пользовательских строк перед вставкой через innerHTML
// (защита от XSS, если в имя клиента/товара/заметку попадут HTML-теги).
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// Три плавающие круглые иконки в правом верхнем углу (Склад/Статистика/
// Настройки) технически не являются частью карточки шапки (лежат вне неё,
// position:fixed, чтобы быть видимыми поверх любой вкладки) — раньше сидели
// на фиксированных отступах от правого края ЭКРАНА, из-за чего на разных
// ширинах экрана заметно "вылезали" за реальные границы белой карточки шапки.
// Теперь после каждой отрисовки центрируем всю группу по горизонтали
// относительно самой карточки и выравниваем по вертикали её центра —
// аналогично тому, как уже сделано для positionOrdersViewToggle().
let _headerIconsResizeObserver = null, _headerIconsResizeTarget = null;

function positionHeaderIcons() {
    const headerCard = document.querySelector('#appStickyHeader .bg-white');
    const btns = ['inventoryBtn', 'statsBtn', 'settingsBtn'].map(id => document.getElementById(id)).filter(Boolean);
    if (!headerCard || !btns.length) return;

    const rect = headerCard.getBoundingClientRect();
    const BTN = 34, GAP = 6, PAD = 8; // 8px — тот же отступ, что и у карточки заказа (p-2), для единообразия
    const groupWidth = btns.length * BTN + (btns.length - 1) * GAP;
    let left = Math.round(rect.right - groupWidth - PAD);
    const top = Math.round(rect.top + PAD);

    btns.forEach(btn => {
        btn.style.right = 'auto';
        btn.style.left = left + 'px';
        btn.style.top = top + 'px';
        left += BTN + GAP;
    });

    if (typeof ResizeObserver !== 'undefined' && _headerIconsResizeTarget !== headerCard) {
        if (_headerIconsResizeObserver) _headerIconsResizeObserver.disconnect();
        _headerIconsResizeObserver = new ResizeObserver(() => positionHeaderIcons());
        _headerIconsResizeObserver.observe(headerCard);
        _headerIconsResizeTarget = headerCard;
    }
}
window.addEventListener('resize', positionHeaderIcons);
if (window.visualViewport) window.visualViewport.addEventListener('resize', positionHeaderIcons);
positionHeaderIcons();
// Проблема, которую это решает: раньше имена/названия вставлялись прямо в
// строку onclick="..." — если в названии попадалась кавычка (частый случай:
// "Торт «Наполеон»", O'Connor), атрибут ломался и в худшем случае позволял
// выполнить произвольный код (XSS). escapeHtml() эту проблему НЕ решает —
// он защищает HTML-текст, а не JS-код внутри onclick.
//
// Решение: данные передаются не как код, а как данные — через data-атрибуты
// (которые браузер не пытается исполнять), а сам вызов функции идёт через
// один общий обработчик кликов (event delegation), а не через onclick.
//
// Использование вместо onclick="myFunc(${id}, '${name}')":
//   <span ${dataAction('myFunc', [id, name])}>...</span>
// Работает для любой функции — не только для готовых иконок ниже.
function dataAction(fnName, args) {
    return `data-fn="${escapeHtml(fnName)}" data-args="${escapeHtml(JSON.stringify(args || []))}"`;
}

document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-fn]');
    if (!el) return;
    const fn = window[el.dataset.fn];
    if (typeof fn !== 'function') { console.error('dataAction: функция не найдена —', el.dataset.fn); return; }
    let args = [];
    try { args = JSON.parse(el.dataset.args || '[]'); } catch (err) { console.error('dataAction: битые аргументы', err); }
    fn(...args);
});

// ==================== ПОИСКОВЫЙ ВЫПАДАЮЩИЙ СПИСОК ====================
// Заменяет нативный <select>/<datalist> своим вертикальным списком
// (на iOS Safari datalist либо не работает, либо рисуется горизонтальной лентой).
// inputId      — id текстового поля ввода
// dropdownId   — id пустого <div class="search-dropdown hidden"> рядом с полем
// getItems()   — функция, возвращающая актуальный массив строк (названий) на момент открытия
// onPick(name) — необязательный колбэк, вызывается после выбора варианта из списка
// onCreate(text) — необязательный колбэк; если задан и среди items нет точного совпадения
//                  (без учёта регистра) с введённым текстом, в списке появляется пункт
//                  "+ Создать «текст»", по клику на который вызывается onCreate(text)
function setupSearchDropdown(inputId, dropdownId, getItems, onPick, onCreate) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;
    if (input.dataset.searchInit === '1') return; // уже инициализировано — не дублируем обработчики
    input.dataset.searchInit = '1';

    function render(filterText) {
        let items;
        try {
            items = (getItems() || []).filter(name => typeof name === 'string' && name.length > 0);
        } catch (e) {
            console.error('setupSearchDropdown getItems() error:', e);
            items = [];
        }
        const q = (filterText || '').trim().toLowerCase();
        const filtered = q ? items.filter(name => name.toLowerCase().includes(q)) : items;
        dropdown.innerHTML = '';

        const queryText = (filterText || '').trim();
        const exactMatch = queryText && items.some(name => name.toLowerCase() === queryText.toLowerCase());
        const showCreate = onCreate && queryText && !exactMatch;

        if (!filtered.length && !showCreate) { dropdown.classList.add('hidden'); return; }
        filtered.forEach(name => {
            const row = document.createElement('div');
            row.className = 'search-dropdown-item';
            row.textContent = name;
            // mousedown (а не click) — срабатывает раньше blur, иначе список успевает скрыться
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = name;
                dropdown.classList.add('hidden');
                if (onPick) onPick(name);
            });
            dropdown.appendChild(row);
        });
        if (showCreate) {
            const row = document.createElement('div');
            row.className = 'search-dropdown-item';
            row.style.color = '#2563eb';
            row.style.fontWeight = '600';
            row.textContent = `+ Создать «${queryText}»`;
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dropdown.classList.add('hidden');
                onCreate(queryText);
            });
            dropdown.appendChild(row);
        }
        dropdown.classList.remove('hidden');
    }

    input.addEventListener('focus', () => render(''));      // по клику — полный список, как раньше
    input.addEventListener('input', () => render(input.value)); // по вводу — фильтрация (+ "Создать", если задан onCreate)
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

function updateProductSelects() {
    // Для строки добавления / редактирования позиции в детальном виде заказа
    setupSearchDropdown('newItemProduct', 'newItemProductDropdown',
        () => products.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(p => p.name),
        () => autoFillNewItemPrice());
    setupSearchDropdown('editItemProduct', 'editItemProductDropdown',
        () => products.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(p => p.name),
        () => autoFillEditItemPrice());
}

function updateCustomerSelects() {
    // Топ-6 клиентов по количеству заказов, остальные по алфавиту
    const orderCount = {};
    (orders || []).forEach(o => {
        if (o.customer_id) orderCount[o.customer_id] = (orderCount[o.customer_id] || 0) + 1;
    });
    const byPopularityThenAlpha = () => {
        const sorted = customers.slice().sort((a, b) => (orderCount[b.id] || 0) - (orderCount[a.id] || 0));
        const top = sorted.slice(0, 6);
        const rest = sorted.slice(6).sort((a, b) => (a.name||"").localeCompare(b.name||""));
        return [...top, ...rest].map(c => c.name);
    };

    setupSearchDropdown('detailCustomer', 'detailCustomerDropdown',
        byPopularityThenAlpha,
        () => onDetailCustomerChange());
}

// Подставляет текущее значение клиента в поле детального просмотра заказа
// (вызывается при открытии заказа — список к этому моменту уже инициализирован).
function fillDetailCustomerSelect(selected) {
    const input = document.getElementById('detailCustomer');
    if (input) input.value = selected || '';
}

// ==================== ЕДИНЫЙ НАБОР ИКОНОК (Вариант А — тонкий контур) ====================
// Возвращают самостоятельный <svg>, для использования внутри текста кнопок: `${icon('trash')} Удалить`
function icon(name, cls) {
    const c = cls || 'w-3.5 h-3.5 inline-block align-[-2px] mr-1';
    const paths = {
        trash: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>',
        share: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0-12l-4 4m4-4l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
        money: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182 1.106-.879 2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
        box: '<path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>',
        cake: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-19.5 0v6a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-6m-19.5 0h19.5M12 3v6.75"/>',
        chart: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/>',
        user: '<path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"/>',
        users: '<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/>',
        lock: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 9V5.25A2.25 2.25 0 0012.75 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 006.75 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>',
        clipboard: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>',
        cart: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.836l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 1.98-4.706 2.545-7.187.075-.323-.174-.63-.53-.63H5.106M7.5 14.25L5.106 5.653M7.5 14.25L5.25 20.25m9-6l2.25 6"/>',
        download: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>',
        refresh: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>',
        undo: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>',
        warning: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>',
        check: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>',
        checkCircle: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
        square: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-linecap="round" stroke-linejoin="round"/>',
        close: '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>',
        edit: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/>',
        star: '<path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.98 21.539a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/>',
        dot: '<circle cx="12" cy="12" r="8"/>',
        clock: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>',
        flame: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 12.75c-1.148 0-2.078.93-2.078 2.078 0 1.024.777 1.867 1.774 1.979-.045.407.021.82.191 1.191a2.25 2.25 0 002.023-1.191M12 12.75c1.148 0 2.078.93 2.078 2.078 0 1.024-.777 1.867-1.774 1.979"/>',
        back: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>'
    };
    return `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${paths[name] || ''}</svg>`;
}


// Показывает короткое подтверждение "Сохранено" после автосохранения поля
// в карточке (клиент/изделие/ингредиент/полуфабрикат/заказ) — чтобы пользователю
// было очевидно, что изменения уже улетели в базу, без отдельной кнопки "Сохранить".
let _autosaveToastTimer = null;
function showAutosaveToast() {
    const toast = document.getElementById('autosaveToast');
    if (!toast) return;
    toast.classList.add('visible');
    if (_autosaveToastTimer) clearTimeout(_autosaveToastTimer);
    _autosaveToastTimer = setTimeout(() => toast.classList.remove('visible'), 1400);
}

function svgEdit(onclick) {
    return `<svg class="action-icon icon-edit inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="Редактировать" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>`;
}
function svgDelete(onclick) {
    return `<svg class="action-icon icon-delete inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="${t('icon_delete_title')}" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>`;
}

// ---- Безопасные версии (data-fn/data-args вместо inline onclick с именами) ----
// Используются в файлах, уже переведённых на dataAction(). См. helpers.js
// выше — блок "БЕЗОПАСНЫЕ ОБРАБОТЧИКИ КЛИКОВ" с объяснением, зачем это нужно.
function svgEditSafe(fnName, args) {
    return `<svg class="action-icon icon-edit inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="Редактировать" ${dataAction(fnName, args)}><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>`;
}
function svgDeleteSafe(fnName, args) {
    return `<svg class="action-icon icon-delete inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="${t('icon_delete_title')}" ${dataAction(fnName, args)}><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>`;
}
// Универсальный способ поделиться текстом: системное меню "Отправить через..." на телефоне,
// либо копирование в буфер обмена как запасной вариант (десктоп и т.п.)
async function shareOrCopyText(text) {
    if (navigator.share) {
        try {
            await navigator.share({ text });
        } catch (e) { /* пользователь закрыл меню — ничего не делаем */ }
    } else {
        try {
            await navigator.clipboard.writeText(text);
            showInfo(t('helpers_text_copied'));
        } catch (e) {
            console.error(e);
            showInfo(t('helpers_copy_failed') + '\n\n' + text);
        }
    }
}

// Показывает понятное сообщение при достижении лимита бесплатного тарифа,
// иначе — обычное сообщение об ошибке (по умолчанию). Текст лимита берём
// прямо из базы (поле DETAIL, заданное в триггере) — не дублируем цифры тут.
// ВАЖНО: e.details приходит с сервера (текст самого триггера в Supabase) и
// пока всегда на русском независимо от языка приложения — полный перевод
// этого конкретного сообщения потребует правки серверной функции, это уже
// не JS-фронтенд. Клиентская обвязка вокруг него переведена.
function showDbError(e, fallbackMsg) {
    const code = e && e.message;
    if (code === 'FREE_LIMIT_CUSTOMERS' || code === 'FREE_LIMIT_ORDERS') {
        showInfo((e.details || t('helpers_free_limit_reached')) + '\n\n' + t('helpers_upgrade_to_continue'));
        return true;
    }
    showInfo(fallbackMsg);
    return false;
}

// UPDATE с проверкой, что реально изменилась хотя бы одна строка.
// Supabase при заблокированном RLS-политикой обновлении НЕ возвращает ошибку —
// просто "успех, 0 строк". Из-за этого данные молча теряются, а приложение
// показывает "сохранено" (мы напоролись на это с organizations). Этот хелпер
// добавляет .select('id') к запросу и бросает ошибку, если ничего не изменилось.
//
// Использование: await updateChecked(db.from('orders').update({...}).eq('id', id));
async function updateChecked(query) {
    const { data, error } = await query.select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
        throw new Error(t('helpers_update_not_saved'));
    }
    return data;
}

function svgCopy(onclick) {
    return `<svg class="action-icon icon-copy inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="${t('icon_copy_title')}" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124M15.75 17.25h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25"/></svg>`;
}
function svgCopySafe(fnName, args) {
    return `<svg class="action-icon icon-copy inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="${t('icon_copy_title')}" ${dataAction(fnName, args)}><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124M15.75 17.25h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25"/></svg>`;
}

// ==================== ГЕНЕРАЦИЯ PDF (нативно, без html2canvas) ====================
// html2canvas превращает HTML-разметку в картинку — при этом периодически
// неверно считает высоту строк таблиц (известное ограничение библиотеки),
// из-за чего в готовом PDF "плывут" строки. jsPDF + плагин autoTable рисуют
// таблицу по-настоящему — линиями и текстом внутри самого PDF, а не как
// снимок экрана. Так строки в принципе не могут разъехаться, а текст в PDF
// становится чётким и выделяемым.
//
// Используем этот способ для ЛЮБОЙ новой генерации PDF в проекте — html2canvas
// для итоговых документов (не для снимков экрана интерфейса, это другое) больше
// не подключаем.

// Наша цветовая палитра в формате [R,G,B] — то, что принимает jsPDF/autoTable
// (fillColor/textColor не понимают HEX, только RGB-массивы или 0-255 int).
const PDF_COLORS = {
    sageLight: [227, 232, 223],   // #e3e8df — светлый шалфей, шапки таблиц
    sage:      [124, 148, 115],   // #7c9473 — основной фисташковый
    sageDark:  [79, 99, 73],      // #4f6349 — тёмный шалфей
    terracotta:[192, 104, 92],    // #c0685c
    textDark:  [61, 58, 51],      // #3d3a33
    textGray:  [107, 114, 128],   // #6b7280
};

// Создаёт новый документ jsPDF с нашими стандартными настройками (A4, мм)
// и подключённым кириллическим шрифтом (см. ensureCyrillicFont ниже) —
// встроенные шрифты jsPDF (Helvetica и т.д.) кириллицу не поддерживают
// вообще, текст на русском вышел бы нечитаемым набором символов.
async function createPdfDoc() {
    if (!window.jspdf) throw new Error(t('helpers_jspdf_not_loaded'));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    await ensureCyrillicFont(pdf);
    return pdf;
}

let _cyrillicFontBase64 = null; // кэш на текущую сессию (чтобы не скачивать заново на каждый PDF)
const CYRILLIC_FONT_CACHE_KEY = 'pdfCyrillicFontRoboto_v2'; // v2 — переехали со стороннего CDN на свой файл в репозитории

async function ensureCyrillicFont(pdf) {
    if (!_cyrillicFontBase64) {
        // Постоянный кэш в localStorage — переживает перезагрузку страницы,
        // так что шрифт реально читается с диска один раз за всё время
        // использования приложения на этом устройстве, а не при каждом открытии.
        try {
            const cached = localStorage.getItem(CYRILLIC_FONT_CACHE_KEY);
            if (cached) _cyrillicFontBase64 = cached;
        } catch (e) { /* localStorage недоступен (приватный режим и т.п.) — не критично, прочитаем заново */ }
    }
    if (!_cyrillicFontBase64) {
        // Свой файл в репозитории (Roboto-Regular.ttf, лежит рядом с index.html) —
        // раньше грузили с внешнего CDN, но сторонние серверы оказались ненадёжны
        // в некоторых сетях. Свой файл — часть самого приложения, всегда "под
        // рукой", ничего стороннего скачивать не нужно.
        try {
            const res = await fetch('Roboto-Regular.ttf');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const buf = await res.arrayBuffer();
            _cyrillicFontBase64 = arrayBufferToBase64(buf);
            try { localStorage.setItem(CYRILLIC_FONT_CACHE_KEY, _cyrillicFontBase64); } catch (e) { /* не критично */ }
        } catch (e) {
            throw new Error(t('helpers_font_load_failed'));
        }
    }
    pdf.addFileToVFS('Roboto-Regular.ttf', _cyrillicFontBase64);
    pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'bold'); // отдельного жирного файла не грузим — используем тот же
    pdf.setFont('Roboto', 'normal');
}

// btoa() на строке из String.fromCharCode(...bigArray) падает на больших файлах
// (превышение лимита аргументов) — кодируем по частям.
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// Стандартные настройки шапки таблицы в нашей палитре — передаётся как
// headStyles в pdf.autoTable({ ...  headStyles: PDF_TABLE_HEAD_STYLE }).
const PDF_TABLE_HEAD_STYLE = { fillColor: PDF_COLORS.sageLight, textColor: PDF_COLORS.textDark, fontStyle: 'bold', font: 'Roboto' };

// Пытается отправить готовый PDF через системное меню "Поделиться" (не на
// всех браузерах поддерживается) — если нет, просто скачивает файл и
// показывает подтверждение.
async function pdfSaveOrShare(pdf, filename) {
    const blob = pdf.output('blob');
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return;
        } catch (e) { /* пользователь закрыл меню "Поделиться" — просто скачиваем ниже */ }
    }
    pdf.save(filename);
    await showInfo(`${t('common_done')}: ${t('backup_file_saved_prefix')} «${filename}» ${t('backup_file_saved_suffix')}.`);
}

// ==================== ПОРТАЛ ДЛЯ ВЫПАДАЮЩИХ МЕНЮ ====================
// #tabsWrapper использует overflow:hidden + .tab-content{will-change:transform}
// (ради анимации свайпа между вкладками) — из-за этого CSS-правила ЛЮБОЙ потомок
// (даже position:fixed) обрезается по границе tabsWrapper, если физически остаётся
// в его DOM-поддереве. Так уже обрезало попап-календарь (пофикшено переносом в
// глобальный узел вне tabsWrapper) и так же обрезает обычные .status-dropdown /
// .filter-dropdown, когда список результатов короче самого дропдауна.
//
// Единственный надёжный фикс — физически переносить открытый дропдаун в портал
// #dropdownPortal (лежит вне tabsWrapper, см. index.html) на время, пока он открыт,
// и вычислять его позицию через JS от кнопки-триггера (getBoundingClientRect),
// а не через CSS top/right относительно родителя.

// dd — сам .status-dropdown/.filter-dropdown элемент, triggerEl — кнопка, под которой
// его нужно показать. Открывает(!) дропдаун — добавляет класс 'open' и позиционирует.
// Управление классом 'hidden' (у .filter-dropdown) остаётся на вызывающей стороне.
function openPortalDropdown(dd, triggerEl) {
    if (!dd || !triggerEl) return;
    const portal = document.getElementById('dropdownPortal');
    if (portal && dd.parentElement !== portal) {
        // Запоминаем, откуда забрали узел — вернём на место при закрытии, чтобы не
        // плодить дубликаты id в местах, где разметка периодически перерисовывается
        // (например статус-дропдаун карточки заказа при каждом displayOrders()).
        dd._portalOriginalParent = dd.parentElement;
        dd._portalOriginalNext = dd.nextSibling;
        portal.appendChild(dd);
    }
    dd.classList.add('open');
    positionPortalDropdown(dd, triggerEl);
}

function positionPortalDropdown(dd, triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.right = 'auto'; dd.style.bottom = 'auto';
    dd.style.visibility = 'hidden';
    dd.style.left = '0px'; dd.style.top = '0px';
    // .filter-dropdown раньше растягивался на всю ширину родителя через CSS
    // left:0;right:0 (ширина = ширине кнопки-триггера в сетке фильтров) — с
    // фиксированным позиционированием эта растяжка больше не работает, поэтому
    // явно задаём ширину кнопки-триггера, как и было (кроме мест, где ширина
    // уже задана вручную инлайн-стилем). .status-dropdown такое не трогаем —
    // у него всегда была своя фиксированная ширина через CSS-класс.
    if (dd.classList.contains('filter-dropdown') && !dd.style.width && !dd.style.minWidth) {
        dd.style.width = rect.width + 'px';
    }
    const ddRect = dd.getBoundingClientRect();
    let left = rect.left;
    const maxLeft = window.innerWidth - ddRect.width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    let top = rect.bottom + 4;
    if (top + ddRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - ddRect.height - 4);
    }
    dd.style.left = left + 'px';
    dd.style.top = top + 'px';
    dd.style.visibility = '';
}

// Закрывает дропдаун и возвращает его узел туда, откуда он был взят (если был
// перенесён в портал) — важно делать это ДО следующей перерисовки родителя.
function closePortalDropdown(dd) {
    if (!dd) return;
    dd.classList.remove('open');
    dd.style.position = ''; dd.style.left = ''; dd.style.top = ''; dd.style.right = ''; dd.style.bottom = '';
    dd.style.visibility = '';
    if (dd.classList.contains('filter-dropdown')) dd.style.width = '';
    if (dd._portalOriginalParent) {
        if (dd._portalOriginalNext && dd._portalOriginalNext.parentElement === dd._portalOriginalParent) {
            dd._portalOriginalParent.insertBefore(dd, dd._portalOriginalNext);
        } else {
            dd._portalOriginalParent.appendChild(dd);
        }
        dd._portalOriginalParent = null;
        dd._portalOriginalNext = null;
    }
}

// ==================== СВАЙП "КОПИРОВАТЬ" НА КАРТОЧКАХ СПРАВОЧНИКОВ ====================
// Тот же визуальный механизм (.oc-swipe-wrap/.oc-swipe-actions/.oc-swipe-btn — CSS
// в index.html), что и у карточек заказов (см. orders.js), но упрощённый: здесь
// всегда ровно одна кнопка — "Копировать". Используется в Изделиях, Ингредиентах
// и Полуфабрикатах (products.js/ingredients.js/semifinished.js). Сознательно НЕ
// переиспользует делегирование заказов напрямую — тот код плотно завязан на
// заказ-специфичную логику (Оплатить/Удалить, приглушённые карточки и т.п.),
// трогать его лишний раз незачем. Закрытие свайпа по тапу вне карточки уже
// покрыто существующим общим document-листенером в orders.js (селектор
// '.oc-swipe-wrap.swiped' не завязан на конкретный список).
let _refCardSwipeStartX = 0, _refCardSwipeStartY = 0, _refCardSwipeWrapEl = null, _refCardSwipeDragging = false;
const REF_CARD_SWIPE_MIN_X = 45;
const REF_CARD_SWIPE_MAX_Y = 40;

// containerId — id обёртки списка карточек (например 'productCardsBody').
// Вызывать при каждой перерисовке списка — сама защищается от повторной инициализации.
function initCopySwipeDelegation(containerId) {
    const container = document.getElementById(containerId);
    if (!container || container._swipeInit) return;
    container._swipeInit = true;

    container.addEventListener('touchstart', (e) => {
        const wrap = e.target.closest('.oc-swipe-wrap');
        if (!wrap) return;
        _refCardSwipeWrapEl = wrap;
        _refCardSwipeStartX = e.touches[0].clientX;
        _refCardSwipeStartY = e.touches[0].clientY;
        _refCardSwipeDragging = true;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!_refCardSwipeDragging || !_refCardSwipeWrapEl) return;
        const dx = e.touches[0].clientX - _refCardSwipeStartX;
        const dy = e.touches[0].clientY - _refCardSwipeStartY;
        if (Math.abs(dy) > REF_CARD_SWIPE_MAX_Y) { _refCardSwipeDragging = false; return; }
        if (Math.abs(dx) > 10) e.stopPropagation(); // не даём жесту уйти в переключение вкладок
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!_refCardSwipeDragging || !_refCardSwipeWrapEl) { _refCardSwipeDragging = false; return; }
        _refCardSwipeDragging = false;
        const wrap = _refCardSwipeWrapEl;
        _refCardSwipeWrapEl = null;
        const dx = e.changedTouches[0].clientX - _refCardSwipeStartX;
        const dy = e.changedTouches[0].clientY - _refCardSwipeStartY;
        if (Math.abs(dy) > REF_CARD_SWIPE_MAX_Y) return;
        const isOpen = wrap.classList.contains('swiped');
        if (!isOpen && dx < -REF_CARD_SWIPE_MIN_X) {
            if (typeof closeAllCardSwipes === 'function') closeAllCardSwipes();
            wrap.classList.add('swiped');
            e.stopPropagation();
        } else if (isOpen && dx > REF_CARD_SWIPE_MIN_X) {
            wrap.classList.remove('swiped');
            e.stopPropagation();
        }
    }, { passive: true });

    // Тап по уже открытой (свайпнутой) карточке закрывает её вместо перехода в карточку записи.
    container.addEventListener('click', (e) => {
        const openWrap = container.querySelector('.oc-swipe-wrap.swiped');
        if (openWrap && !e.target.closest('.oc-swipe-actions')) {
            if (typeof closeAllCardSwipes === 'function') closeAllCardSwipes();
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

// Переводит статус заказа для ОТОБРАЖЕНИЯ пользователю — само значение в базе
// (status: 'принят'/'в работе'/'выполнен') остаётся русским, это внутреннее
// значение данных, не текст интерфейса. Общая функция, чтобы карточка клиента
// и (позже) экран Заказов показывали статус одинаково на любом языке.
function orderStatusLabel(status) {
    const map = { 'принят': 'order_status_accepted', 'в работе': 'order_status_in_progress', 'выполнен': 'order_status_done' };
    return (typeof t === 'function' && map[status]) ? t(map[status]) : status;
}

// То же самое, но с заглавной буквы — для бейджей статуса в карточках
// заказов (кнопка "Принят"/"In progress" и т.п.), где нужен именно
// капитализированный вид, а не строчный (как в таблице заказов клиента).
function orderStatusLabelCap(status) {
    const map = { 'принят': 'order_status_accepted_cap', 'в работе': 'order_status_in_progress_cap', 'выполнен': 'order_status_done_cap' };
    return (typeof t === 'function' && map[status]) ? t(map[status]) : status;
}

// Открывает Политику конфиденциальности / Условия использования поверх окна настроек
// (через iframe на privacy.html/terms.html — те же файлы, что указаны в карточке Google Play),
// без ухода со страницы приложения. src задаётся только при первом открытии — чтобы каждый
// повторный клик не перезагружал iframe заново без необходимости.
function openLegalModal(modalId) {
    const map = {
        privacyModal: ['privacyFrame', 'privacy.html'],
        termsModal: ['termsFrame', 'terms.html'],
        faqModal: ['faqFrame', 'faq.html']
    };
    const [frameId, src] = map[modalId] || [];
    const frame = frameId ? document.getElementById(frameId) : null;
    // Не полагаемся на frame.src (у <iframe src=""> он не пустой, а равен
    // адресу текущей страницы — из-за этого проверка "уже загружено?" всегда
    // была бы true, и реальный файл так и не подставлялся бы). Используем
    // свой собственный флаг вместо этого.
    if (frame && !frame.dataset.loaded) {
        frame.src = src;
        frame.dataset.loaded = '1';
    }
    document.getElementById(modalId).style.display = 'flex';
}

// Закрывает Политику/Условия/FAQ и возвращает окно настроек в том виде, в каком оно было
// (те же разделы остаются раскрытыми — это тот же самый DOM, не перезагрузка страницы).
function closeLegalModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    openSettingsModal();
}

// "Написать нам" — сначала показываем свою форму с текстом сообщения, а не сразу
// открываем системную почту (это может выглядеть неожиданно для пользователя и не
// даёт возможности сначала спокойно сформулировать вопрос).
function openContactModal() {
    document.getElementById('contactMessage').value = '';
    document.getElementById('contactModal').style.display = 'flex';
}

// Отправка — формируем mailto со введённым текстом и открываем системное приложение
// почты, где пользователь уже сам решает, отправлять или нет.
function sendContactMessage() {
    const ta = document.getElementById('contactMessage');
    const msg = (ta && ta.value || '').trim();
    const subjectText = (typeof t === 'function') ? t('contact_subject') : 'Simple Bake — вопрос';
    const subject = encodeURIComponent(subjectText);
    const body = encodeURIComponent(msg || '');
    window.location.href = `mailto:simplebake.support@gmail.com?subject=${subject}&body=${body}`;
    closeLegalModal('contactModal');
}

// "Удалить аккаунт" — сначала предупреждение о том, что именно удаляется и что
// действие необратимо, затем — готовое письмо в поддержку через mailto (реальное
// удаление пока делается вручную, см. Privacy Policy раздел 6). Это и есть in-app
// путь для запроса на удаление аккаунта, требуемый политикой Google Play.
function openDeleteAccountModal() {
    document.getElementById('deleteAccountModal').style.display = 'flex';
}

function sendDeleteAccountRequest() {
    const subjectText = (typeof t === 'function') ? t('delacc_subject') : 'Simple Bake — запрос на удаление аккаунта';
    const line1 = (typeof t === 'function') ? t('delacc_body_line1') : 'Прошу удалить аккаунт и все данные организации:';
    const line2 = (typeof t === 'function') ? t('delacc_body_line2') : 'Понимаю, что это действие необратимо.';
    const orgLine = `${currentOrgName || '—'} (org_id=${currentOrgId != null ? currentOrgId : '—'})`;
    const body = `${line1}\n${orgLine}\n\n${line2}`;
    const subject = encodeURIComponent(subjectText);
    const encodedBody = encodeURIComponent(body);
    window.location.href = `mailto:simplebake.support@gmail.com?subject=${subject}&body=${encodedBody}`;
    closeLegalModal('deleteAccountModal');
}

// Готовая разметка одной кнопки "Копировать" для .oc-swipe-actions — общая для
// изделий/ингредиентов/полуфабрикатов, чтобы иконка и цвет не разъезжались.
function refCopySwipeBtnHtml(onclickCall) {
    return `<div class="oc-swipe-actions">
        <button class="oc-swipe-btn oc-swipe-copy" onclick="event.stopPropagation(); ${onclickCall}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
            ${t('icon_copy_title')}
        </button>
    </div>`;
}
