// ==================== КАСТОМНЫЙ ПОПАП-КАЛЕНДАРЬ ====================
// Замена системного <input type="date"> собственным виджетом в палитре
// приложения (вариант B из макетов: цветной бейдж с числом в углу клетки).
//
// ВАЖНО: используется ОДИН общий DOM-узел popup на всё приложение —
// <div class="calendar-popup" id="globalCalendarPopup"> лежит в index.html
// вне #tabsWrapper (причина та же, что и у productsSearchBar/ordersViewToggle:
// у tabsWrapper overflow:hidden ради анимации свайпа, а .tab-content
// { will-change: transform } делает его containing block для потомков
// с position:fixed — такой popup внутри него обрезался бы и позиционировался
// не от экрана, а от этого контейнера). Поэтому все вызовы ниже всегда
// передают popupId='globalCalendarPopup', а не создают свой div на каждое поле.
//
// Использование:
//   <input id="myDate" type="hidden">
//   <button onclick="toggleCustomCalendar('globalCalendarPopup','myDate','myLabel',{onPick:fn, badge:fn})">
//       <span id="myLabel">—</span>
//   </button>
//
// opts.onPick(isoDate)   — вызывается сразу после выбора дня
// opts.badge(y, m, d)    — необязательно; y — год, m — месяц 0-11, d — число;
//                          возвращает {count, color} для бейджа клетки, или null/ничего

const _calInstances = {}; // popupId -> {hiddenInputId, labelId, onPick, badge, viewYear, viewMonth}

const CAL_MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const CAL_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function toggleCustomCalendar(popupId, hiddenInputId, labelId, opts) {
    const popup = document.getElementById(popupId);
    if (!popup) return;
    const wasOpen = popup.classList.contains('open');
    closeAllCalendarPopups();
    if (typeof closeAllOrderStatusDropdowns === 'function') closeAllOrderStatusDropdowns();
    if (wasOpen) return;

    const currentVal = document.getElementById(hiddenInputId)?.value || '';
    const base = currentVal ? new Date(currentVal + 'T00:00:00') : new Date();
    _calInstances[popupId] = {
        mode: 'single',
        hiddenInputId, labelId,
        onPick: opts && opts.onPick,
        badge: opts && opts.badge,
        allowClear: opts && opts.allowClear,
        viewYear: base.getFullYear(),
        viewMonth: base.getMonth()
    };
    renderCalendarPopup(popupId);
    popup.classList.add('open');
}

// Режим диапазона (вариант А — тап-тап): первый тап ставит начало, второй —
// конец (заливка между ними), третий тап начинает новый диапазон. Ничего
// не пишется в скрытые input, пока не нажата "Применить" — иначе непонятно,
// когда диапазон считается завершённым.
//
//   <input id="myFrom" type="hidden"><input id="myTo" type="hidden">
//   <button onclick="toggleCustomCalendarRange('globalCalendarPopup','myFrom','myTo','myFromLabel','myToLabel',{onApply:fn})">
//
// opts.onApply(fromIso, toIso) — вызывается после нажатия "Применить"
function toggleCustomCalendarRange(popupId, fromInputId, toInputId, fromLabelId, toLabelId, opts) {
    const popup = document.getElementById(popupId);
    if (!popup) return;
    const wasOpen = popup.classList.contains('open');
    closeAllCalendarPopups();
    if (typeof closeAllOrderStatusDropdowns === 'function') closeAllOrderStatusDropdowns();
    if (wasOpen) return;

    const fromVal = document.getElementById(fromInputId)?.value || '';
    const toVal = document.getElementById(toInputId)?.value || '';
    const base = fromVal ? new Date(fromVal + 'T00:00:00') : new Date();
    _calInstances[popupId] = {
        mode: 'range',
        fromInputId, toInputId, fromLabelId, toLabelId,
        onApply: opts && opts.onApply,
        tempFrom: fromVal || null,
        tempTo: toVal || null,
        viewYear: base.getFullYear(),
        viewMonth: base.getMonth()
    };
    renderCalendarPopup(popupId);
    popup.classList.add('open');
}

function closeAllCalendarPopups() {
    document.querySelectorAll('.calendar-popup.open').forEach(p => {
        p.classList.remove('open');
    });
}
document.addEventListener('click', closeAllCalendarPopups);

function calNavMonth(popupId, delta) {
    const st = _calInstances[popupId];
    if (!st) return;
    st.viewMonth += delta;
    if (st.viewMonth < 0) { st.viewMonth = 11; st.viewYear--; }
    if (st.viewMonth > 11) { st.viewMonth = 0; st.viewYear++; }
    renderCalendarPopup(popupId);
}

function calGoToday(popupId) {
    const st = _calInstances[popupId];
    if (!st) return;
    const now = new Date();
    st.viewYear = now.getFullYear();
    st.viewMonth = now.getMonth();
    renderCalendarPopup(popupId);
}

function calPickDay(popupId, y, m, d) {
    const st = _calInstances[popupId];
    if (!st) return;
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const input = document.getElementById(st.hiddenInputId);
    if (input) input.value = iso;
    const lbl = document.getElementById(st.labelId);
    if (lbl) lbl.textContent = formatDateDMY(iso);
    closeAllCalendarPopups();
    if (typeof st.onPick === 'function') st.onPick(iso);
}

// Вариант А: тап1 = начало, тап2 (не раньше начала) = конец, тап3 = новый диапазон.
// Тап раньше уже выбранного начала просто сдвигает начало (без сброса на "новый диапазон").
function calPickRangeDay(popupId, y, m, d) {
    const st = _calInstances[popupId];
    if (!st) return;
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!st.tempFrom || (st.tempFrom && st.tempTo)) {
        st.tempFrom = iso;
        st.tempTo = null;
    } else if (iso < st.tempFrom) {
        st.tempFrom = iso;
    } else {
        st.tempTo = iso;
    }
    renderCalendarPopup(popupId);
}

function calClearRange(popupId) {
    const st = _calInstances[popupId];
    if (!st) return;
    st.tempFrom = null;
    st.tempTo = null;
    renderCalendarPopup(popupId);
}

function calApplyRange(popupId) {
    const st = _calInstances[popupId];
    if (!st || !st.tempFrom || !st.tempTo) return;
    const fromInput = document.getElementById(st.fromInputId);
    const toInput = document.getElementById(st.toInputId);
    if (fromInput) fromInput.value = st.tempFrom;
    if (toInput) toInput.value = st.tempTo;
    const fromLbl = document.getElementById(st.fromLabelId);
    const toLbl = document.getElementById(st.toLabelId);
    if (fromLbl) fromLbl.textContent = formatDateDMY(st.tempFrom);
    if (toLbl) toLbl.textContent = formatDateDMY(st.tempTo);
    closeAllCalendarPopups();
    if (typeof st.onApply === 'function') st.onApply(st.tempFrom, st.tempTo);
}

function renderCalendarPopup(popupId) {
    const st = _calInstances[popupId];
    const popup = document.getElementById(popupId);
    if (!st || !popup) return;
    const isRange = st.mode === 'range';

    const selectedIso = !isRange ? (document.getElementById(st.hiddenInputId)?.value || '') : '';
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const firstOfMonth = new Date(st.viewYear, st.viewMonth, 1);
    let startDay = firstOfMonth.getDay(); // 0=Вс..6=Сб
    startDay = startDay === 0 ? 6 : startDay - 1; // сдвиг недели на понедельник
    const daysInMonth = new Date(st.viewYear, st.viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(st.viewYear, st.viewMonth, 0).getDate();

    let cellsHtml = '';
    for (let i = 0; i < startDay; i++) {
        const d = daysInPrevMonth - startDay + i + 1;
        cellsHtml += `<div class="cal-day other-month">${d}</div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${st.viewYear}-${String(st.viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        let cls = 'cal-day';
        if (iso === todayIso) cls += ' today';
        if (isRange) {
            if (iso === st.tempFrom) cls += ' selected range-start';
            if (iso === st.tempTo) cls += ' selected range-end';
            if (st.tempFrom && st.tempTo && iso > st.tempFrom && iso < st.tempTo) cls += ' in-range';
        } else {
            if (iso === selectedIso) cls += ' selected';
        }
        let badgeHtml = '';
        let dotsHtml = '';
        if (typeof st.badge === 'function') {
            const b = st.badge(st.viewYear, st.viewMonth, d);
            if (b && b.dots && b.dots.length) {
                dotsHtml = `<div class="cal-day-dots">${b.dots.map(c => `<span class="cal-day-dot" style="background:${c}"></span>`).join('')}</div>`;
            } else if (b && b.count > 0) {
                badgeHtml = `<span class="cal-day-badge" style="background:${b.color}">${b.count}</span>`;
            }
        }
        const clickFn = isRange ? 'calPickRangeDay' : 'calPickDay';
        cellsHtml += `<div class="${cls}" onclick="${clickFn}('${popupId}', ${st.viewYear}, ${st.viewMonth}, ${d})">${d}${badgeHtml}${dotsHtml}</div>`;
    }
    const totalCells = startDay + daysInMonth;
    const tail = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
        cellsHtml += `<div class="cal-day other-month">${i}</div>`;
    }

    const statusHtml = isRange
        ? `<div class="cal-range-status">С ${st.tempFrom ? formatDateDMY(st.tempFrom) : '—'} &nbsp;по&nbsp; ${st.tempTo ? formatDateDMY(st.tempTo) : '—'}</div>`
        : '';

    const footerHtml = isRange
        ? `<div class="cal-footer" style="justify-content:space-between;">
               <div class="cal-today-btn" onclick="calGoToday('${popupId}')">Сегодня</div>
               <div style="display:flex; gap:6px;">
                   <div class="cal-today-btn" onclick="calClearRange('${popupId}')">Очистить</div>
                   <div class="cal-apply-btn${(st.tempFrom && st.tempTo) ? '' : ' disabled'}" onclick="calApplyRange('${popupId}')">Применить</div>
               </div>
           </div>`
        : `<div class="cal-footer">
               <div class="cal-today-btn" onclick="calGoToday('${popupId}')">Сегодня</div>
               ${st.allowClear ? `<div class="cal-today-btn" onclick="calClearDay('${popupId}')">Очистить</div>` : ''}
           </div>`;

    popup.innerHTML = `
        <div class="cal-header">
            <div class="cal-nav-btn" onclick="calNavMonth('${popupId}', -1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg></div>
            <div class="cal-title">${CAL_MONTH_NAMES[st.viewMonth]} ${st.viewYear}</div>
            <div class="cal-nav-btn" onclick="calNavMonth('${popupId}', 1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/></svg></div>
        </div>
        ${statusHtml}
        <div class="cal-weekdays">${CAL_WEEKDAYS.map(w => `<div class="cal-weekday">${w}</div>`).join('')}</div>
        <div class="cal-days">${cellsHtml}</div>
        ${footerHtml}
    `;
}

function calClearDay(popupId) {
    const st = _calInstances[popupId];
    if (!st) return;
    const input = document.getElementById(st.hiddenInputId);
    if (input) input.value = '';
    const lbl = document.getElementById(st.labelId);
    if (lbl) lbl.textContent = '—';
    closeAllCalendarPopups();
    if (typeof st.onPick === 'function') st.onPick('');
}

// Утилита для JS-кода, который выставляет дату программно (например,
// дефолт "сегодня" при открытии модалки) — держит скрытый input и подпись
// на кнопке синхронными без дублирования форматирования в каждом месте.
function calSetFieldValue(hiddenInputId, labelId, iso) {
    const input = document.getElementById(hiddenInputId);
    if (input) input.value = iso || '';
    const lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = iso ? formatDateDMY(iso) : '—';
}

// ---- Место применения №1: поле "Дата" в карточке заказа ----

// Цвет "по статусу" одного конкретного заказа — просрочка оплаты перебивает
// статус исполнения (самое критичное состояние из возможных для заказа).
function orderSeverityColor(order) {
    const payInfo = getOrderPaymentStatus(order);
    if (payInfo.overdue) return '#8b3a3a'; // тёмно-красный — просрочен
    if (order.status === 'принят') return '#c0685c';   // terracotta
    if (order.status === 'в работе') return '#d9a441'; // honey
    return '#7c9473'; // sage — выполнен
}

// Бейдж — заказы на этот день (любой статус; массив orders уже не содержит
// мягко удалённых — фильтр deleted_at is null применён при загрузке).
// До 3 заказов — точки под числом дня, цвет каждой точки = статус конкретного
// заказа. Больше 3 — точки не помещаются, возвращаемся к числу в углу клетки;
// его цвет — по самому критичному заказу дня (просрочен > принят > в работе > выполнен).
function orderCountBadgeForDay(y, m, d) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOrders = orders.filter(o => o.date === iso);
    if (!dayOrders.length) return null;
    if (dayOrders.length <= 3) {
        return { dots: dayOrders.map(orderSeverityColor) };
    }
    const priority = ['#8b3a3a', '#c0685c', '#d9a441', '#7c9473']; // просрочен > принят > в работе > выполнен
    const colors = dayOrders.map(orderSeverityColor);
    const color = priority.find(p => colors.includes(p)) || '#7c9473';
    return { count: dayOrders.length, color };
}

function onDetailDatePicked(iso) {
    saveDetailHeader();
}
