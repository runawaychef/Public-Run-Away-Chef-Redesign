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

    setupSearchDropdown('editOrderCustomer', 'editOrderCustomerDropdown',
        byPopularityThenAlpha);
}

// Подставляет текущее значение клиента в поле детального просмотра заказа
// (вызывается при открытии заказа — список к этому моменту уже инициализирован).
function fillDetailCustomerSelect(selected) {
    const input = document.getElementById('detailCustomer');
    if (input) input.value = selected || '';
}

// SVG-иконки (вариант E3: серые контурные, подсвечиваются своим цветом при наведении/нажатии — см. .action-icon в index.html)
function svgEdit(onclick) {
    return `<svg class="action-icon icon-edit inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="Редактировать" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/></svg>`;
}
function svgDelete(onclick) {
    return `<svg class="action-icon icon-delete inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="Удалить" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>`;
}
function svgCopy(onclick) {
    return `<svg class="action-icon icon-copy inline mr-1 cursor-pointer" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="1.6" title="Копировать" onclick="${onclick}"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124M15.75 17.25h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25"/></svg>`;
}
