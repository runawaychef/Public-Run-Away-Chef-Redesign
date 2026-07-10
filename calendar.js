// ==================== КАСТОМНЫЙ ПОПАП-КАЛЕНДАРЬ ====================
// Замена системного <input type="date"> собственным виджетом в палитре
// приложения (вариант B из макетов: цветной бейдж с числом в углу клетки).
//
// Первое место применения — поле "Дата" в карточке заказа (#detailDate).
// Задуман переиспользуемым для дальнейших мест (см. открытый бэклог по
// календарю) — вся привязка к конкретному полю передаётся параметрами,
// сам модуль ни от чего конкретного не зависит.
//
// Использование:
//   <input id="myDate" type="hidden">
//   <button onclick="toggleCustomCalendar('myPopup','myDate','myLabel',{onPick:fn, badge:fn})">
//       <span id="myLabel">—</span>
//   </button>
//   <div class="calendar-popup" id="myPopup"></div>
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

function renderCalendarPopup(popupId) {
    const st = _calInstances[popupId];
    const popup = document.getElementById(popupId);
    if (!st || !popup) return;

    const selectedIso = document.getElementById(st.hiddenInputId)?.value || '';
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
        if (iso === selectedIso) cls += ' selected';
        let badgeHtml = '';
        if (typeof st.badge === 'function') {
            const b = st.badge(st.viewYear, st.viewMonth, d);
            if (b && b.count > 0) {
                badgeHtml = `<span class="cal-day-badge" style="background:${b.color}">${b.count}</span>`;
            }
        }
        cellsHtml += `<div class="${cls}" onclick="calPickDay('${popupId}', ${st.viewYear}, ${st.viewMonth}, ${d})">${d}${badgeHtml}</div>`;
    }
    const totalCells = startDay + daysInMonth;
    const tail = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
        cellsHtml += `<div class="cal-day other-month">${i}</div>`;
    }

    popup.innerHTML = `
        <div class="cal-header">
            <div class="cal-nav-btn" onclick="calNavMonth('${popupId}', -1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path stroke-linecap="round" stroke-linejoin="round" d="M15 18l-6-6 6-6"/></svg></div>
            <div class="cal-title">${CAL_MONTH_NAMES[st.viewMonth]} ${st.viewYear}</div>
            <div class="cal-nav-btn" onclick="calNavMonth('${popupId}', 1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/></svg></div>
        </div>
        <div class="cal-weekdays">${CAL_WEEKDAYS.map(w => `<div class="cal-weekday">${w}</div>`).join('')}</div>
        <div class="cal-days">${cellsHtml}</div>
        <div class="cal-footer">
            <div class="cal-today-btn" onclick="calGoToday('${popupId}')">Сегодня</div>
            ${st.allowClear ? `<div class="cal-today-btn" onclick="calClearDay('${popupId}')">Очистить</div>` : ''}
        </div>
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

// Бейдж — количество заказов на этот день (любой статус; массив orders уже
// не содержит мягко удалённых — фильтр deleted_at is null применён при загрузке).
// Цвет по загруженности дня, по той же логике terracotta/honey/sage,
// что используется в остальном приложении для критично/средне/норм.
function orderCountBadgeForDay(y, m, d) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = orders.filter(o => o.date === iso).length;
    if (count === 0) return null;
    let color = '#7c9473'; // sage
    if (count >= 5) color = '#c0685c'; // terracotta
    else if (count >= 3) color = '#d9a441'; // honey
    return { count, color };
}

function onDetailDatePicked(iso) {
    saveDetailHeader();
}
