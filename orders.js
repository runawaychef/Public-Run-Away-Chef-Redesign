// ==================== ЗАКАЗЫ ====================
// Список заказов: отображение, группировка по неделям/месяцам, фильтры,
// создание и копирование заказа.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), orders/customers/products/employees (главный скрипт),
// orderGrandTotal (money.js), formatDateDMY/getMondayOf/MONTH_NAMES_RU (dates.js),
// showLoading/hideLoading, logActivity (employees.js), currentEmployee (employees.js),
// svgEdit/svgDelete/svgCopy, openOrderDetail (главный скрипт).

// ---- Список заказов ----

// id заказа -> его реальный индекс в массиве orders. Пересобирается в начале
// каждого displayOrders() и используется вместо orders.indexOf(order) в
// renderOrderCard/renderDoneOrderCard (отдельные функции, вызываемые по одной
// на карточку из отфильтрованных/отсортированных производных массивов —
// напрямую индекс цикла тут не подходит, а indexOf на каждую карточку
// давал O(n²) при росте числа заказов).
let _ordersIndexById = new Map();

// ---- Порционная отрисовка списка заказов (автоподгрузка при прокрутке) ----
// Активные заказы показываются всегда целиком; «Выполненные» (карточки) и
// недели (таблица) — порциями. Лимиты запоминаются, чтобы перерисовка после
// смены статуса не «схлопывала» уже подгруженное, и сбрасываются при смене фильтров.
const ORDERS_DONE_CHUNK = 30;
const ORDERS_WEEKS_CHUNK = 8;
let _ocDoneLimit = ORDERS_DONE_CHUNK;
let _otWeeksLimit = ORDERS_WEEKS_CHUNK;
let _ocLoadMore = null;
let _otLoadMore = null;
const _ordersMoreObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
        if (!en.isIntersecting) return;
        if (en.target.id === 'ocMoreSentinel' && _ocLoadMore) _ocLoadMore();
        else if (en.target.id === 'otMoreSentinel' && _otLoadMore) _otLoadMore();
    });
}, { rootMargin: '800px 0px' });
function resetOrdersRenderLimits() {
    _ocDoneLimit = ORDERS_DONE_CHUNK;
    _otWeeksLimit = ORDERS_WEEKS_CHUNK;
}

function displayOrders() {
    if (typeof refreshDocsVisibility === 'function') refreshDocsVisibility();
    renderDraftBar();
    _ordersMoreObserver.disconnect(); // старые sentinel'ы уйдут вместе с перерисованным DOM
    // Список карточек сейчас перерисуется целиком — если у какого-то заказа был
    // открыт статус-дропдаун (и портал увёл его из карточки наружу, см. helpers.js
    // openPortalDropdown), его старый узел иначе останется висеть в портале с тем же
    // id, что и у свежесозданного в новой разметке — убираем такие "сироты" заранее.
    document.querySelectorAll('#dropdownPortal [id^="statusDropdown-"], #dropdownPortal [id^="statusDropdownT-"]').forEach(d => d.remove());

    _ordersIndexById = new Map(orders.map((o, i) => [o.id, i]));

    const today    = getLocalDateStr(0);
    const tomorrow = getLocalDateStr(1);
    // Заказ считается "срочным" (раздел "Заказы в работе") если он на сегодня
    // или завтра (либо уже прошла) и ещё не выполнен. Раньше сюда попадал ещё и послезавтра —
    // сократили до двух дней, чтобы заказы, принятые сильно заранее, не
    // выглядели как уже "в работе".
    function isUrgentOrder(o) {
        // дата <= завтра: сегодня, завтра и просроченные (даты в формате YYYY-MM-DD сравниваются как строки)
        return o.date <= tomorrow && o.status !== 'выполнен';
    }

    // ---- Табличный вид: блоки-«острова» по неделям (Пн–Вс), итог недели — отдельной
    // строкой под блоком; итогов за месяц нет. Состав и сортировка — как раньше,
    // фильтры общие с карточным видом. ----
    refreshCancelledFilterOption();
    const filteredOrders = getFilteredOrdersForList();
    // v983: фильтр «Отменённые» — свой простой список, без сумм продаж, оплат и свайпов
    if (ordersCancelledMode()) {
        const html = cancelledListHtml(filteredOrders);
        const tb = document.getElementById('orderTableBody'); if (tb) tb.innerHTML = html;
        const cb = document.getElementById('orderCardsBody'); if (cb) cb.innerHTML = html;
        updateOrdersFilterSummary([]);
        if (typeof positionOrdersViewToggle === 'function') requestAnimationFrame(positionOrdersViewToggle);
        return;
    }
    const sorted = [...filteredOrders].sort((a, b) => new Date(b.date) - new Date(a.date));
    const tbody = document.getElementById('orderTableBody');

    function localStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    // Неделя всегда целая (Пн–Вс) — недельный итог сохраняет смысл производственного цикла.
    function weekKeyOf(order) {
        return localStr(getMondayOf(new Date(order.date)));
    }

    const hasVat = (typeof currentOrgVatRate !== 'undefined') && currentOrgVatRate > 0 && (currentOrgProtected || currentOrgVatPayer);

    function weekHeadHtml(weekKey) {
        const monday = new Date(weekKey + 'T00:00:00');
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        const weekLabel = formatDateDMY(localStr(monday)) + ' – ' + formatDateDMY(localStr(sunday));
        return `<div class="ot-week-head">${t('orders_week_word')} ${weekLabel}</div>`;
    }

    function weekSummaryHtml(weekKey) {
        const wt = calcGroupTotals(sorted, o => weekKeyOf(o) === weekKey);
        const countsText = `${wt.count} ${t('orders_orders_short')}, ${wt.qty} ${t('unit_pcs')}`;
        const sumsText = hasVat
            ? `${formatMoney(wt.net)} ${t('orders_sum_novat_short')} · <b>${formatMoney(wt.sum)}</b> ${t('orders_sum_withvat_short')}`
            : `<b>${formatMoney(wt.sum)}</b>`;
        return `<div class="ot-week-summary">
            <span class="ot-week-counts">${countsText}</span><span class="ot-week-sums">${sumsText}</span>
        </div>`;
    }

    function tableRowHtml(order) {
        const itemsCount = order.items ? order.items.length : 0;
        // Плашка оплаты — как в карточках: цвет = статус оплаты, тап = ввод платежа / список платежей
        const payInfo = getOrderPaymentStatus(order);
        const payKey = payInfo.overdue ? 'overdue' : payInfo.status;
        const payLabel = payInfo.overdue ? t('pay_status_overdue')
            : payInfo.status === 'paid' ? t('pay_status_paid')
            : payInfo.status === 'partial' ? t('pay_status_partial')
            : t('pay_status_unpaid');
        const payPillHtml = `<button type="button" class="pay-pill" data-pay="${payKey}" style="background:${getPaymentStripeColor(payInfo)};" onclick="event.stopPropagation(); quickPayPillTap(${order.id}, ${payInfo.status === 'paid' ? 'true' : 'false'})">${orderHasAutoBankPay(order.id) ? payAutoBankIconHtml(11) : ''}${payLabel}</button>`;
        // Статус заказа (21.10): точка 5 px после даты (цвета — как в карточках), выполненные приглушены
        const stColor = ORDER_STATUS_COLORS[order.status] || ORDER_STATUS_COLORS['принят'];
        return `<div class="ot-row${order.status === 'выполнен' ? ' ot-done' : ''}" onclick="openOrderDetail(${order.id})">
            <span class="ot-date">${formatDateDMY(order.date).slice(0, 5)}<span class="ot-dot" style="background:${stColor};" title="${escapeHtml(orderStatusLabelCap(order.status || 'принят'))}"></span></span>
            <span class="ot-cust">${escapeHtml(order.customer || t('orders_no_customer'))}</span>
            <span class="ot-pos">${itemsCount}</span>
            <span class="ot-sum">${formatMoney(orderGrandTotal(order))}</span>
            <span class="ot-pay">${payPillHtml}</span>
        </div>`;
    }

    // Недели группируем заранее, но в DOM кладём только первые _otWeeksLimit —
    // остальные догружаются при прокрутке (см. _ordersMoreObserver ниже).
    // Раньше рисовались ВСЕ заказы разом: на 470+ заказах это секунды на телефоне.
    const weekGroups = [];
    sorted.forEach(order => {
        const wk = weekKeyOf(order);
        const last = weekGroups[weekGroups.length - 1];
        if (last && last.wk === wk) last.list.push(order);
        else weekGroups.push({ wk, list: [order] });
    });
    const weekGroupHtml = (g, idx) => (idx > 0 ? '<div class="ot-week-sep"></div>' : '') + weekHeadHtml(g.wk) + `<div class="ot-island">${g.list.map(tableRowHtml).join('')}</div>` + weekSummaryHtml(g.wk);
    const _otFirst = Math.min(weekGroups.length, _otWeeksLimit);
    let tableHtml = '';
    for (let i = 0; i < _otFirst; i++) tableHtml += weekGroupHtml(weekGroups[i], i);
    let _otRendered = _otFirst;
    if (_otRendered < weekGroups.length) tableHtml += '<div id="otMoreSentinel" style="height:1px"></div>';
    _otLoadMore = function () {
        const sentinel = document.getElementById('otMoreSentinel');
        if (!sentinel) return;
        const end = Math.min(weekGroups.length, _otRendered + ORDERS_WEEKS_CHUNK);
        let html = '';
        for (let i = _otRendered; i < end; i++) html += weekGroupHtml(weekGroups[i], i);
        _otRendered = end;
        _otWeeksLimit = end;
        sentinel.insertAdjacentHTML('beforebegin', html);
        if (_otRendered >= weekGroups.length) { _ordersMoreObserver.unobserve(sentinel); sentinel.remove(); }
        else { _ordersMoreObserver.unobserve(sentinel); _ordersMoreObserver.observe(sentinel); }
    };
    const _memoStrip = typeof ordersDayMemoStripHtml === 'function' ? ordersDayMemoStripHtml() : '';
    tbody.innerHTML = _memoStrip + (tableHtml || (typeof ordersEmptyHtml === 'function' ? ordersEmptyHtml() : `<p class="text-xs text-gray-400 text-center py-4">${t('orders_none_found')}</p>`));

    { const sn = document.getElementById('otMoreSentinel'); if (sn) _ordersMoreObserver.observe(sn); }

    // ---- Карточный вид: та же фильтрация, что и в таблице (общее состояние
    // фильтров теперь единое для обоих видов — включая новый календарь-фильтр
    // по дате с бейджами, см. openOrdersCardFilterCalendar), плюс своя группировка ----
    const cardsBody = document.getElementById('orderCardsBody');
    if (cardsBody) {
        const sortedAll = [...filteredOrders].sort((a, b) => new Date(b.date) - new Date(a.date));
        const urgentOrders  = sortedAll.filter(o => isUrgentOrder(o));
        const plannedOrders = sortedAll.filter(o => o.status !== 'выполнен' && !isUrgentOrder(o));
        const doneOrders    = sortedAll.filter(o => o.status === 'выполнен');

        function sectionDividerHtml(label, iconSvg) {
            return `<div class="oc-section-divider"><span class="label">${iconSvg}${label}</span></div>`;
        }

        let cardsHtml = '';

        if (plannedOrders.length) {
            cardsHtml += sectionDividerHtml(t('orders_section_accepted'),
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>');
            plannedOrders.forEach(order => { cardsHtml += renderOrderCard(order); });
        }

        if (urgentOrders.length) {
            cardsHtml += sectionDividerHtml(t('orders_section_in_progress'),
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>');
            urgentOrders.forEach(order => { cardsHtml += renderOrderCard(order); });
        }

        if (doneOrders.length) {
            cardsHtml += sectionDividerHtml(t('orders_section_done'),
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>');
            const doneFirst = Math.min(doneOrders.length, _ocDoneLimit);
            for (let i = 0; i < doneFirst; i++) cardsHtml += renderDoneOrderCard(doneOrders[i]);
            let doneRendered = doneFirst;
            if (doneRendered < doneOrders.length) cardsHtml += '<div id="ocMoreSentinel" style="height:1px"></div>';
            _ocLoadMore = function () {
                const sentinel = document.getElementById('ocMoreSentinel');
                if (!sentinel) return;
                const end = Math.min(doneOrders.length, doneRendered + ORDERS_DONE_CHUNK);
                let html = '';
                for (let i = doneRendered; i < end; i++) html += renderDoneOrderCard(doneOrders[i]);
                doneRendered = end;
                _ocDoneLimit = end;
                sentinel.insertAdjacentHTML('beforebegin', html);
                if (doneRendered >= doneOrders.length) { _ordersMoreObserver.unobserve(sentinel); sentinel.remove(); }
                else { _ordersMoreObserver.unobserve(sentinel); _ordersMoreObserver.observe(sentinel); }
            };
        }

        cardsBody.innerHTML = _memoStrip + (cardsHtml || (typeof ordersEmptyHtml === 'function' ? ordersEmptyHtml() : `<p class="text-xs text-gray-400 text-center py-4">${t('orders_none_found')}</p>`));
        initOrderCardSwipeDelegation();
        { const sn = document.getElementById('ocMoreSentinel'); if (sn) _ordersMoreObserver.observe(sn); }
    }

    updateOrdersFilterSummary(filteredOrders);

    // Пересчитываем позицию переключателя вида при каждой перерисовке списка —
    // не полагаемся на одноразовый расчёт при входе, который мог сработать
    // до того, как реальная раскладка страницы устоялась.
    if (typeof positionOrdersViewToggle === 'function') {
        requestAnimationFrame(positionOrdersViewToggle);
    }
    // Ссылка «Пройти тур по приложению», пока нет своих заказов (demoData.js, 11.11.2026)
    if (typeof refreshTourOrdersLink === 'function') refreshTourOrdersLink();
}

// ==================== КАРТОЧНЫЙ ВИД СПИСКА ЗАКАЗОВ ====================

// Цвет полосы слева = статус оплаты. Цвет кнопки статуса исполнения — те же
// 3 оттенка (терракота/охра/шалфей), уже используемые в остальном интерфейсе.
const ORDER_STATUS_COLORS = { 'принят': '#c0685c', 'в работе': '#d9a441', 'выполнен': '#7c9473' };
const ORDER_STATUS_LIST = ['принят', 'в работе', 'выполнен'];

function getPaymentStripeColor(payInfo) {
    if (payInfo.overdue) return '#8b3a3a';
    if (payInfo.status === 'paid') return '#7c9473';
    if (payInfo.status === 'partial') return '#d9a441';
    return '#c0685c';
}

const RU_MONTH_ABBR = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const EN_MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function monthAbbr(monthIdx0) {
    return (typeof currentLang !== 'undefined' && currentLang === 'en') ? EN_MONTH_ABBR[monthIdx0] : RU_MONTH_ABBR[monthIdx0];
}
function orderDateBadgeParts(iso) {
    const d = new Date(iso + 'T00:00:00');
    return { month: monthAbbr(d.getMonth()), day: d.getDate() };
}

// Позиции заказа теперь показываются во всех карточках без исключения.
function renderOrderCard(order) {
    const payInfo = getOrderPaymentStatus(order);
    const stripeColor = getPaymentStripeColor(payInfo);
    const statusColor = ORDER_STATUS_COLORS[order.status] || ORDER_STATUS_COLORS['принят'];
    const oNum = orderNumLabel(order);
    const total = formatMoney(orderGrandTotal(order));
    const dateBadge = orderDateBadgeParts(order.date);

    let payLine = '';
    if (payInfo.status === 'partial' || payInfo.overdue) {
        const pending = Math.max(0, payInfo.grandAmt - payInfo.paidAmt);
        payLine = `<div class="oc-pay-line">${orderPaidPartsHtml(payInfo)} · <span style="color:#c0685c">${formatMoney(pending)} ${t('orders_remaining_lower')}</span></div>`;
    }
    const overdueLine = payInfo.overdue ? `<div class="oc-pay-line" style="color:#8b3a3a; font-weight:700;">${t('orders_payment_overdue')}</div>` : '';

    // Заметка к заказу (готовность/доставка и т.п.) — то же поле order.notes,
    // что и "Комментарий к заказу" в карточке; показываем только если заполнено.
    let noteLine = '';
    if (order.notes && order.notes.trim()) {
        noteLine = `<div class="oc-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 7v5l3 3"/></svg><span>${escapeHtml(order.notes.trim())}</span></div>`;
    }

    let itemsLine = '';
    if (order.items && order.items.length) {
        itemsLine = `<div class="oc-items">` +
            order.items.map(it => {
                const prod = products.find(p => p.id === it.product_id);
                const unitLabel = unitAbbrev(prod && prod.unit ? prod.unit : 'pcs');
                return `<div class="oc-item-row"><span class="oc-item-name">· ${escapeHtml(it.product)}</span><span class="oc-item-qty">${it.quantity} ${unitLabel}</span></div>`;
            }).join('') +
            `</div>`;
    }

    const statusOptions = ORDER_STATUS_LIST.map(s => `
        <div class="status-option${s === order.status ? ' selected' : ''}" onclick="event.stopPropagation(); quickSetOrderStatus(${order.id}, '${s}')">
            <span><span class="dot" style="background:${ORDER_STATUS_COLORS[s]}"></span> ${orderStatusLabelCap(s)}</span>
            <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        </div>`).join('');

    // Свайп-действия (прототип): "Копировать" — всегда, "Удалить" — только
    // при наличии права (правая панель, свайп влево). "Оплатить" — отдельная
    // панель слева (свайп вправо), логически рядом с цветной полосой статуса
    // оплаты. Ширина панели (переменная --oc-swipe-x) зависит от того, сколько
    // кнопок реально показано в правой панели.
    const realIdx = _ordersIndexById.get(order.id);
    let swipeBtns = '';
    let swipeBtnCount = 0;
    swipeBtnCount++;
    swipeBtns += `<button class="oc-swipe-btn oc-swipe-copy" onclick="event.stopPropagation(); quickCopyFromSwipe(${realIdx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
        ${t('icon_copy_title')}
    </button>`;
    if (hasPermission('can_delete')) {
        swipeBtnCount++;
        swipeBtns += `<button class="oc-swipe-btn oc-swipe-delete" onclick="event.stopPropagation(); quickDeleteFromSwipe(${realIdx}, '${escapeHtml(order.customer || '').replace(/'/g, "\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
            ${t('common_delete')}
        </button>`;
    }
    let leftBtns = '';
    let leftBtnCount = 0;
    if (payInfo.status !== 'paid') {
        leftBtnCount++;
        leftBtns += `<button class="oc-swipe-btn oc-swipe-pay" onclick="event.stopPropagation(); quickPayFromSwipe(${order.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"/></svg>
            ${t('orders_pay_btn')}
        </button>`;
    }
    leftBtnCount++;
    leftBtns += `<button class="oc-swipe-btn oc-swipe-send" onclick="event.stopPropagation(); openOrderDocAction(${order.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zm0 0l9.75 6.75 9.75-6.75"/></svg>
        ${t('orders_send_btn')}
    </button>`;
    const payPanel = `<div class="oc-swipe-actions-left">${leftBtns}</div>`;
    const swipeWrapStyle = ` style="--oc-swipe-x:-${swipeBtnCount * 72}px; --oc-swipe-pay-x:${leftBtnCount * 72}px;"`;
    const swipeWrapOpen = '';

    return `
    <div class="oc-swipe-wrap"${swipeWrapStyle}${swipeWrapOpen}>
        <div class="oc-swipe-actions">${swipeBtns}</div>
        ${payPanel}
        <div class="order-card" id="orderCard-${order.id}">
            <div class="order-card-tap" onclick="openOrderDetail(${order.id})">
                <div class="stripe" style="background:${stripeColor}"></div>
                ${_sentIconHtml(order) ? `<div class="oc-sent-badge">${_sentIconHtml(order)}</div>` : ''}
                <div class="order-card-body">
                    <div class="oc-header">
                        <div class="oc-datebadge">
                            <div class="oc-datebadge-month" style="background:${statusColor};">${dateBadge.month}</div>
                            <div class="oc-datebadge-day">${dateBadge.day}</div>
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div class="oc-row">
                                <span class="oc-name">${escapeHtml(order.customer || t('orders_no_customer'))}</span>
                                <span class="oc-sum">${total}</span>
                            </div>
                            <div class="oc-row" style="margin-top:3px;">
                                <span class="oc-meta">${orderMetaHtml(order)}</span>
                                <div style="position:relative;" onclick="event.stopPropagation();">
                                    <button class="status-btn" style="background:${statusColor};" onclick="toggleOrderStatusDropdown(${order.id})">
                                        ${orderStatusLabelCap(order.status)}
                                        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                                    </button>
                                    <div class="status-dropdown" id="statusDropdown-${order.id}">${statusOptions}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${noteLine}
                    ${payLine}
                    ${overdueLine}
                    ${orderDocChipsHtml(order)}
                    ${typeof orderStockShortCapsuleHtml === 'function' ? orderStockShortCapsuleHtml(order) : ''}
                    ${itemsLine}
                </div>
            </div>
        </div>
    </div>`;
}

// ==================== СВАЙП КАРТОЧКИ ЗАКАЗА — быстрые действия (прототип) ====================
// Свайп влево открывает панель с кнопками "Копировать"/"Удалить" справа от
// карточки. Свайп вправо открывает панель "Оплатить" слева от карточки (рядом
// с цветной полосой статуса оплаты — логическая связка). Реализовано через
// делегирование на общий контейнер (#orderCardsBody), а не отдельные
// обработчики на каждой карточке — карточки создаются через innerHTML при
// каждой перерисовке списка, а не поэлементно. stopPropagation() на самом
// жесте не даёт глобальному свайпу между вкладками (initSwipeNavigation)
// перехватить то же движение пальца как переключение вкладки.
let _cardSwipeStartX = 0, _cardSwipeStartY = 0, _cardSwipeWrapEl = null, _cardSwipeDragging = false;
const CARD_SWIPE_MIN_X = 45;
const CARD_SWIPE_MAX_Y = 40;

function closeAllCardSwipes() {
    document.querySelectorAll('.oc-swipe-wrap.swiped-left, .oc-swipe-wrap.swiped-right').forEach(w => w.classList.remove('swiped-left', 'swiped-right'));
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.oc-swipe-wrap')) closeAllCardSwipes();
});

function initOrderCardSwipeDelegation() {
    const container = document.getElementById('orderCardsBody');
    if (!container || container._swipeInit) return;
    container._swipeInit = true;

    container.addEventListener('touchstart', (e) => {
        const wrap = e.target.closest('.oc-swipe-wrap');
        if (!wrap || wrap.dataset.noSwipe) return;
        _cardSwipeWrapEl = wrap;
        _cardSwipeStartX = e.touches[0].clientX;
        _cardSwipeStartY = e.touches[0].clientY;
        _cardSwipeDragging = true;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!_cardSwipeDragging || !_cardSwipeWrapEl) return;
        const dx = e.touches[0].clientX - _cardSwipeStartX;
        const dy = e.touches[0].clientY - _cardSwipeStartY;
        if (Math.abs(dy) > CARD_SWIPE_MAX_Y) { _cardSwipeDragging = false; return; }
        if (Math.abs(dx) > 10) e.stopPropagation(); // не даём жесту уйти в переключение вкладок
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        if (!_cardSwipeDragging || !_cardSwipeWrapEl) { _cardSwipeDragging = false; return; }
        _cardSwipeDragging = false;
        const wrap = _cardSwipeWrapEl;
        _cardSwipeWrapEl = null;
        const dx = e.changedTouches[0].clientX - _cardSwipeStartX;
        const dy = e.changedTouches[0].clientY - _cardSwipeStartY;
        if (Math.abs(dy) > CARD_SWIPE_MAX_Y) return;
        const isOpenLeft = wrap.classList.contains('swiped-left');
        const isOpenRight = wrap.classList.contains('swiped-right');
        const hasPayPanel = !!wrap.querySelector('.oc-swipe-actions-left');

        if (!isOpenLeft && !isOpenRight && dx < -CARD_SWIPE_MIN_X) {
            closeAllCardSwipes();
            wrap.classList.add('swiped-left');
            e.stopPropagation();
        } else if (!isOpenLeft && !isOpenRight && dx > CARD_SWIPE_MIN_X && hasPayPanel) {
            closeAllCardSwipes();
            wrap.classList.add('swiped-right');
            e.stopPropagation();
        } else if (isOpenLeft && dx > CARD_SWIPE_MIN_X) {
            wrap.classList.remove('swiped-left');
            e.stopPropagation();
        } else if (isOpenRight && dx < -CARD_SWIPE_MIN_X) {
            wrap.classList.remove('swiped-right');
            e.stopPropagation();
        }
    }, { passive: true });

    // Тап по уже открытой (свайпнутой) карточке закрывает её вместо перехода в заказ.
    container.addEventListener('click', (e) => {
        const openWrap = container.querySelector('.oc-swipe-wrap.swiped-left, .oc-swipe-wrap.swiped-right');
        if (openWrap && !e.target.closest('.oc-swipe-actions') && !e.target.closest('.oc-swipe-actions-left')) {
            closeAllCardSwipes();
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

// "Оплатить" из свайпа: открываем карточку заказа (там уже есть вся нужная
// логика загрузки платежей) и сразу поверх открываем форму добавления оплаты —
// не полноценный "минуя карточку" сценарий конкурента, но заметно быстрее
// обычного пути (не нужно самому искать и нажимать кнопку оплаты внутри).
async function quickPayFromSwipe(orderId) {
    closeAllCardSwipes();
    openOrderDetail(orderId);
    await loadOrderPayments(orderId);
    openAddPaymentModal(true);
}

// Нажатие на плашку оплаты в свёрнутой карточке: доплатить остаток или посмотреть платежи
async function quickPayPillTap(orderId, isPaid) {
    closeAllCardSwipes();
    openOrderDetail(orderId);
    await loadOrderPayments(orderId);
    if (isPaid) openPaymentModal();
    else openAddPaymentModal(true);
}

function quickCopyFromSwipe(realIdx) {
    closeAllCardSwipes();
    copyOrder(realIdx);
}

function quickDeleteFromSwipe(realIdx, customerName) {
    closeAllCardSwipes();
    openDeleteModal(realIdx, 'order', `${t('delete_label_order_of')} «${customerName}»`);
}

// Открытие/закрытие статус-дропдаунов теперь идёт через общий портал
// (openPortalDropdown/closePortalDropdown в helpers.js) — он же решает то, что раньше
// решал "умный" флип вверх/вниз, плюс не даёт дропдауну обрезаться внутри #tabsWrapper.
function closeAllOrderStatusDropdowns() {
    document.querySelectorAll('.status-dropdown.open').forEach(d => closePortalDropdown(d));
}
// Закрываем дропдаун статуса при тапе где угодно ещё на странице.
document.addEventListener('click', closeAllOrderStatusDropdowns);

// Компактная приглушённая карточка выполненного заказа. Полоса оплаты теперь
// видна всегда (приглушается вместе с остальной карточкой через CSS-прозрачность
// у .order-card.muted .stripe, а не через display:none, как раньше) — статус
// оплаты должен быть заметен даже для закрытых заказов. Точка справа красится
// по статусу исполнения; при разворачивании превращается в ту же кликабельную
// кнопку смены статуса, что и в активных карточках — иногда нужно быстро
// поменять/откатить статус, не открывая полную карточку заказа.
function renderDoneOrderCard(order, opts) {
    // opts.embedded (16.10): «встроенная» копия свёрнутой карточки для окон (окно дня календаря клиента,
    // «Неоплаченные заказы»): тот же вид, но без свайпов, раскрытия и id; плашка оплаты и статус только
    // показывают состояние; нажатие на карточку — opts.onTap(id). opts.extraHtml — доп. строка под шапкой.
    const emb = !!(opts && opts.embedded);
    const payInfo = getOrderPaymentStatus(order);
    const stripeColor = getPaymentStripeColor(payInfo);
    const statusColor = ORDER_STATUS_COLORS[order.status] || ORDER_STATUS_COLORS['принят'];
    const oNum = orderNumLabel(order);
    const total = formatMoney(orderGrandTotal(order));
    const dateBadge = orderDateBadgeParts(order.date);
    const statusLabel = orderStatusLabelCap(order.status);

    // Заметка и полоса оплаты — те же блоки, что и в активной карточке
    // (renderOrderCard), показываются только в развёрнутом виде.
    let noteLine = '';
    if (order.notes && order.notes.trim()) {
        noteLine = `<div class="oc-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 7v5l3 3"/></svg><span>${escapeHtml(order.notes.trim())}</span></div>`;
    }
    let payLine = '';
    if (payInfo.status === 'partial' || payInfo.overdue) {
        const pending = Math.max(0, payInfo.grandAmt - payInfo.paidAmt);
        payLine = `<div class="oc-pay-line">${orderPaidPartsHtml(payInfo)} · <span style="color:#c0685c">${formatMoney(pending)} ${t('orders_remaining_lower')}</span></div>`;
    }
    const overdueLine = payInfo.overdue ? `<div class="oc-pay-line" style="color:#8b3a3a; font-weight:700;">${t('orders_payment_overdue')}</div>` : '';

    let itemsLine = '';
    if (order.items && order.items.length) {
        itemsLine = order.items.map(it => {
            const prod = products.find(p => p.id === it.product_id);
            const unitLabel = unitAbbrev(prod && prod.unit ? prod.unit : 'pcs');
            return `<div class="oc-item-row"><span class="oc-item-name">· ${escapeHtml(it.product)}</span><span class="oc-item-qty">${it.quantity} ${unitLabel}</span></div>`;
        }).join('');
    }

    // Кнопка смены статуса — идентична той, что в активных карточках
    // (renderOrderCard), включая выпадающее меню с тремя вариантами.
    const statusOptions = ORDER_STATUS_LIST.map(s => `
        <div class="status-option${s === order.status ? ' selected' : ''}" onclick="event.stopPropagation(); quickSetOrderStatus(${order.id}, '${s}')">
            <span><span class="dot" style="background:${ORDER_STATUS_COLORS[s]}"></span> ${orderStatusLabelCap(s)}</span>
            <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        </div>`).join('');

    // Плашка статуса оплаты (левый нижний угол) — дублирует цвет боковой полосы и
    // нажимается: если есть что доплатить — открывает ввод платежа с остатком,
    // если заказ оплачен — открывает список платежей по заказу.
    const payKey = payInfo.overdue ? 'overdue' : payInfo.status; // paid | partial | unpaid | overdue
    const payPillLabel = payInfo.overdue ? t('pay_status_overdue')
        : payInfo.status === 'paid' ? t('pay_status_paid')
        : payInfo.status === 'partial' ? t('pay_status_partial')
        : t('pay_status_unpaid');
    const payPill = `<button type="button" class="pay-pill" data-pay="${payKey}" style="background:${stripeColor};" onclick="event.stopPropagation(); quickPayPillTap(${order.id}, ${payInfo.status === 'paid' ? 'true' : 'false'})">${orderHasAutoBankPay(order.id) ? payAutoBankIconHtml(12) : ''}${payPillLabel}</button>`;
    if (emb) {
        const onTap = (opts && opts.onTap) || 'openOrderDetail';
        const extra = (opts && opts.extraHtml) || '';
        return `
        <div class="order-card${order.status === 'выполнен' ? ' done-card' : ''}" style="cursor:pointer; margin-bottom:8px;" onclick="${onTap}(${order.id})">
            <div class="oc-card-top">
                <div class="stripe" style="background:${stripeColor};" data-pay="${payKey}"></div>
                ${_sentIconHtml(order) ? `<div class="oc-sent-badge">${_sentIconHtml(order)}</div>` : ''}
                <div class="order-card-tap">
                    <div class="order-card-body">
                        <div class="oc-header">
                            <div class="oc-datebadge">
                                <div class="oc-datebadge-month" style="background:${statusColor};">${dateBadge.month}</div>
                                <div class="oc-datebadge-day">${dateBadge.day}</div>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div class="oc-row">
                                    <span class="oc-name">${escapeHtml(order.customer || t('orders_no_customer'))}</span>
                                    <span class="oc-sum">${total}</span>
                                </div>
                                <div class="oc-row" style="margin-top:3px;">
                                    <span class="oc-meta">${orderMetaHtml(order)}</span>
                                </div>
                            </div>
                        </div>
                        ${payLine}
                        ${overdueLine}
                        ${orderDocChipsHtml(order)}
                    ${typeof orderStockShortCapsuleHtml === 'function' ? orderStockShortCapsuleHtml(order) : ''}
                        ${extra}
                        <div class="oc-bottom">
                            <span class="pay-pill" data-pay="${payKey}" style="background:${stripeColor}; cursor:inherit;">${orderHasAutoBankPay(order.id) ? payAutoBankIconHtml(12) : ''}${payPillLabel}</span>
                            <span style="flex:1;"></span>
                            <span class="status-btn" style="background:${statusColor}; cursor:inherit;">${statusLabel}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Свайп-действия — "Копировать" в правой панели (кроме "Удалить" — заказ
    // уже выполнен, удалять из свайпа этого экрана не даём, только из полной
    // карточки). "Оплатить" — отдельная левая панель, свайп вправо, как и у
    // активных карточек. Работает и в свёрнутом, и в развёрнутом виде.
    const realIdx = _ordersIndexById.get(order.id);
    let swipeBtns = '';
    let swipeBtnCount = 1;
    swipeBtns += `<button class="oc-swipe-btn oc-swipe-copy" onclick="event.stopPropagation(); quickCopyFromSwipe(${realIdx})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
        ${t('icon_copy_title')}
    </button>`;
    let leftBtns = '';
    let leftBtnCount = 0;
    if (payInfo.status !== 'paid') {
        leftBtnCount++;
        leftBtns += `<button class="oc-swipe-btn oc-swipe-pay" onclick="event.stopPropagation(); quickPayFromSwipe(${order.id})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"/></svg>
            ${t('orders_pay_btn')}
        </button>`;
    }
    leftBtnCount++;
    leftBtns += `<button class="oc-swipe-btn oc-swipe-send" onclick="event.stopPropagation(); openOrderDocAction(${order.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zm0 0l9.75 6.75 9.75-6.75"/></svg>
        ${t('orders_send_btn')}
    </button>`;
    const payPanel = `<div class="oc-swipe-actions-left">${leftBtns}</div>`;
    const swipeWrapStyle = ` style="--oc-swipe-x:-${swipeBtnCount * 72}px; --oc-swipe-pay-x:${leftBtnCount * 72}px;"`;

    return `
    <div class="oc-swipe-wrap"${swipeWrapStyle}>
        <div class="oc-swipe-actions">${swipeBtns}</div>
        ${payPanel}
        <div class="order-card done-card" id="orderCard-${order.id}">
            <div class="oc-card-top">
                <div class="stripe" style="background:${stripeColor};" data-role="stripe" data-pay="${payKey}"></div>
                ${_sentIconHtml(order) ? `<div class="oc-sent-badge">${_sentIconHtml(order)}</div>` : ''}
                <div class="order-card-tap" onclick="handleDoneCardTap(event, ${order.id})">
                    <div class="order-card-body">
                        <div data-role="header">
                            <div class="oc-header">
                                <div class="oc-datebadge">
                                    <div class="oc-datebadge-month" style="background:${statusColor};">${dateBadge.month}</div>
                                    <div class="oc-datebadge-day">${dateBadge.day}</div>
                                </div>
                                <div style="flex:1; min-width:0;">
                                    <div class="oc-row">
                                        <span class="oc-name">${escapeHtml(order.customer || t('orders_no_customer'))}</span>
                                        <span class="oc-sum">${total}</span>
                                    </div>
                                    <div class="oc-row" style="margin-top:3px;">
                                        <span class="oc-meta">${orderMetaHtml(order)}</span>
                                    </div>
                                </div>
                            </div>
                            ${noteLine}
                            ${payLine}
                            ${overdueLine}
                            ${orderDocChipsHtml(order)}
                    ${typeof orderStockShortCapsuleHtml === 'function' ? orderStockShortCapsuleHtml(order) : ''}
                        </div>
                        <div class="oc-items" data-role="items" style="display:none;">${itemsLine}</div>
                        <div class="oc-bottom">
                            ${payPill}
                            <button type="button" class="oc-chev" onclick="event.stopPropagation(); toggleDoneCardExpand(${order.id})" title="${t('orders_expand_title')}" aria-label="${t('orders_expand_title')}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>
                            </button>
                            <div style="position:relative;" onclick="event.stopPropagation();">
                                <button class="status-btn" style="background:${statusColor};" onclick="toggleOrderStatusDropdown(${order.id})">
                                    ${statusLabel}
                                    <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                                </button>
                                <div class="status-dropdown" id="statusDropdown-${order.id}">${statusOptions}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function handleDoneCardTap(e, orderId) {
    if (e.target.closest('.oc-bottom')) return;
    openOrderDetail(orderId);
}

function toggleDoneCardExpand(orderId) {
    const card = document.getElementById('orderCard-' + orderId);
    if (!card) return;
    // Свёрнутый и развёрнутый вид отличаются только списком позиций;
    // шапка, статус и свайп-действия одинаковы в обоих видах.
    const expanded = card.classList.toggle('expanded');
    card.querySelector('[data-role="items"]').style.display = expanded ? 'block' : 'none';
}

// Пункты меню смены статуса (используется в табличном виде; в карточках то же собирается inline)
function orderStatusOptionsHtml(order) {
    return ORDER_STATUS_LIST.map(s => `
        <div class="status-option${s === order.status ? ' selected' : ''}" onclick="event.stopPropagation(); quickSetOrderStatus(${order.id}, '${s}')">
            <span><span class="dot" style="background:${ORDER_STATUS_COLORS[s]}"></span> ${orderStatusLabelCap(s)}</span>
            <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        </div>`).join('');
}

function toggleOrderStatusDropdown(orderId, variant) {
    // variant 'T' — меню статуса в табличном виде (отдельный id, чтобы не пересекаться с карточкой)
    const dd = document.getElementById('statusDropdown' + (variant || '') + '-' + orderId);
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) openPortalDropdown(dd, event.currentTarget);
}

async function quickSetOrderStatus(orderId, newStatus) {
    closeAllOrderStatusDropdowns();
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === newStatus) return;
    const oldStatus = order.status;
    order.status = newStatus; // оптимистичное обновление — сразу перерисовываем
    displayOrders();
    try {
        await updateChecked(db.from('orders').update({ status: newStatus }).eq('id', orderId));
        const oNum = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
        logActivity('order', `${t('trash_order_word')} ${oNum}: ${t('customers_col_status')} «${orderStatusLabel(oldStatus)}» → «${orderStatusLabel(newStatus)}»`, orderId);
        if (newStatus === 'выполнен' && oldStatus !== 'выполнен' && typeof maybeOpenDoneDocSheet === 'function') maybeOpenDoneDocSheet(order); // 30.10.2026: окно «Что выставить»
    } catch (e) {
        order.status = oldStatus; // откат при ошибке сети/сохранения
        displayOrders();
        showInfo(t('orders_status_change_error'));
    }
}

// Показывает подсказку, соответствующую активному виду списка заказов
// (карточки/таблица) — у каждого вида своя логика, поэтому и текст разный.
function openOrdersHelp() {
    const isTable = document.getElementById('ordersViewBtnTable')?.classList.contains('active');
    if (isTable) {
        showHelpModal('help_orders_table_title', 'help_orders_table_text');
    } else {
        showHelpModal('help_orders_screen_title', 'help_orders_screen_text');
    }
    _appendCancelHelp();
}

// v987: абзацы про отмену заказа в справке экрана заказов
function _appendCancelHelp() {
    const el = document.getElementById('helpModalText');
    if (el) el.insertAdjacentHTML('beforeend', t('help_orders_cancel_text').split('\n\n')
        .map(p => `<p class="mb-2">${escapeHtml(p)}</p>`).join(''));
}

// Переключатель "Карточки / Таблица" — верхний правый угол экрана.
function setOrdersViewMode(mode) {
    document.getElementById('orderCardsWrap')?.classList.toggle('hidden', mode !== 'cards');
    document.getElementById('orderTableWrap')?.classList.toggle('hidden', mode !== 'table');
    document.getElementById('ordersViewBtnCards')?.classList.toggle('active', mode === 'cards');
    document.getElementById('ordersViewBtnTable')?.classList.toggle('active', mode === 'table');
    // Перерисовка здесь не нужна: фильтры общие для обоих видов, а displayOrders()
    // и так обновляет и карточки, и таблицу при любом изменении данных или фильтров.
}

// Ставит переключатель ровно посередине зазора между нижним краем шапки
// (белая карточка с названием пекарни) и верхним краем первой карточки/таблицы
// заказов. Считается по реальным координатам элементов на экране (а не
// подобранными "на глаз" числами в CSS) — так расстояние остаётся верным
// независимо от размера шрифта/устройства.
//
// Заодно это ЕДИНЫЙ источник истины для самой видимости переключателя.
// Раньше show/hide были раскиданы по всему коду (вход, выход, смена вкладки,
// открытие/закрытие карточки заказа) — и как только где-то отрисовка списка
// срабатывала в обход одного из этих мест (например, realtime-обновление
// после любого обращения к базе), переключатель мог "залипнуть" видимым не
// на своём месте. Карточка заказа — это под-экран ВНУТРИ вкладки "Заказы"
// (currentTabId остаётся 'orders', даже когда открыта именно карточка), поэтому
// проверки одного currentTabId было недостаточно. Теперь видимость всегда
// пересчитывается заново из реального состояния экрана при каждом вызове —
// а вызывается эта функция при каждой перерисовке списка заказов, то есть
// в том числе и после любого realtime-обновления.
function positionOrdersViewToggle() {
    const toggle = document.getElementById('ordersViewToggle');
    if (!toggle) return;

    const isOrderDetailOpen = document.getElementById('orderDetail')?.classList.contains('active');
    const isAnyModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => getComputedStyle(m).display !== 'none');
    const shouldShow = (typeof currentTabId === 'undefined' || currentTabId === 'orders') && !isOrderDetailOpen && !isAnyModalOpen;
    toggle.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;

    const headerCard = document.querySelector('#appStickyHeader .bg-white');
    const list = document.getElementById('ordersList');
    if (!headerCard || !list) return;

    const GAP = 52; // желаемое расстояние между шапкой и первой карточкой
    list.style.paddingTop = GAP + 'px';

    const headerBottom = headerCard.getBoundingClientRect().bottom;
    const toggleHeight  = toggle.offsetHeight;
    // +10px — сдвиг чуть ниже геометрического центра зазора (по просьбе, "на глаз" смотрится лучше)
    toggle.style.top = Math.round(headerBottom + GAP / 2 - toggleHeight / 2 + 6) + 'px';

    watchHeaderResize(headerCard);
}
window.addEventListener('resize', positionOrdersViewToggle);
// window 'resize' не всегда срабатывает при появлении/скрытии клавиатуры на
// Android Chrome (зависит от версии браузера и того, что фокус попал именно
// в текстовое поле) — visualViewport.resize ловит это надёжнее в любом случае.
// Это тот самый класс "переключатель иногда уезжает", который не покрывался
// ни pageshow/visibilitychange (не про клавиатуру), ни обычным resize.
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', positionOrdersViewToggle);
}
// Доп. подстраховка: пересчёт при скролле, throttled через requestAnimationFrame.
// На случай, если положение вдруг посчиталось в момент, когда прилипающая
// шапка (#appStickyHeader, position:sticky) ещё "доезжает" до прилипшего
// состояния — тогда getBoundingClientRect() у неё на миг даёт промежуточное,
// а не финальное значение.
let _ovtScrollScheduled = false;
window.addEventListener('scroll', () => {
    if (_ovtScrollScheduled) return;
    _ovtScrollScheduled = true;
    requestAnimationFrame(() => {
        positionOrdersViewToggle();
        _ovtScrollScheduled = false;
    });
}, { passive: true });

// Самокорректирующийся пересчёт: раньше позиция переключателя пересчитывалась
// только "по требованию" — из конкретных мест кода (смена вкладки, pageshow
// после разморозки вкладки, мгновенное восстановление из кэша и т.д.), каждое
// со своим наспех подобранным таймаутом (150мс/300мс). Если в момент такого
// вызова шапка ЕЩЁ не приняла окончательную высоту (например: имя организации
// подставилось чуть позже, чем должно, или строка с шапкой на секунду шире
// одну строку, а не две) — расчёт делался по неверным координатам и больше
// никогда не переигрывался, пока не случится следующее из этих конкретных
// событий. Это классический whack-a-mole: у каждого нового пути попадания
// в приложение (новый способ восстановления из фона и т.п.) — своя, ранее не
// учтённая гонка. ResizeObserver на самой шапке решает это раз и навсегда:
// как только реальная высота шапки меняется (по любой причине), переключатель
// сам пересчитывает позицию — независимо от того, что именно и когда его вызвало.
let _headerResizeObserver = null;
let _headerResizeObserverTarget = null;
function watchHeaderResize(headerCard) {
    if (typeof ResizeObserver === 'undefined' || !headerCard) return;
    if (_headerResizeObserverTarget === headerCard) return; // уже наблюдаем именно за этим узлом
    if (_headerResizeObserver) _headerResizeObserver.disconnect();
    _headerResizeObserver = new ResizeObserver(() => {
        if (typeof positionOrdersViewToggle === 'function') positionOrdersViewToggle();
    });
    _headerResizeObserver.observe(headerCard);
    _headerResizeObserverTarget = headerCard;
}

// Считает сумму (с НДС) и общее кол-во изделий по подмножеству заказов, отобранных predicate
function calcGroupTotals(allOrders, predicate) {
    let sum = 0, net = 0, qty = 0, count = 0;
    allOrders.forEach(o => {
        if (predicate(o)) {
            sum += orderGrandTotal(o);
            net += orderAfterDiscount(o);
            qty += (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
            count++;
        }
    });
    return { sum, net, qty, count };
}

// Статус оплаты заказа — единая логика для цветной точки в списке и для фильтра "Оплата",
// чтобы они никогда не расходились между собой.
// ---- Срок оплаты заказа (12.11.2026) ----
// Если срок не задан вручную (orders.due_date), он считается сам: дата заказа + отсрочка клиента (payment_term_days, по умолчанию 7 дн.,
// как при выставлении счёта). Ручное значение сильнее; сброс календарём («очистить») возвращает автоматический срок.
function orderAutoTerm(o) {
    const cust = (typeof customers !== 'undefined' ? customers : []).find(c => c.id === (o && o.customer_id));
    // не задана у клиента: физлицо платит в день заказа (0), всё остальное — 7 дней (13.11.2026)
    const term = (cust && cust.payment_term_days != null) ? Number(cust.payment_term_days) : ((cust && cust.entity_type === 'individual') ? 0 : 7);
    return isNaN(term) ? 7 : term;
}
function orderAutoDue(o) {
    if (!o || !o.date) return null;
    const d = new Date(String(o.date).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + orderAutoTerm(o));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Поле «Оплатить до» в шапке карточки заказа. У заказа со счётом показывается срок счёта (меняется в самом счёте).
let _detailInvDue = {};   // orderId -> срок счёта (кэш)
function refreshDetailDue(order) {
    const lbl = document.getElementById('detailDueBtnLabel'), inp = document.getElementById('detailDue'), btn = document.getElementById('detailDueBtn');
    if (!lbl || !inp || !order) return;
    const hasInv = typeof orderHasInvoice === 'function' && orderHasInvoice(order);
    inp.value = order.due_date || '';
    if (hasInv) {
        btn.style.opacity = '0.75';
        const d = _detailInvDue[order.id];
        lbl.textContent = d ? formatDateDMY(d) + ' · ' + t('order_due_inv') : t('order_due_inv');
        lbl.style.color = (d && d < getLocalDateStr(0) && getOrderPaymentStatus(order).status !== 'paid') ? '#a3493d' : '';   // просрочка — красным и у заказа со счётом
        if (d === undefined) _loadDetailInvDue(order);
        return;
    }
    btn.style.opacity = '';
    const eff = order.due_date || orderAutoDue(order);
    lbl.innerHTML = eff ? escapeHtml(formatDateDMY(eff)) + (order.due_date ? '' : ` <span style="font-size:11px;color:#9a9488;">${escapeHtml(t('order_due_auto_n').replace('{n}', orderAutoTerm(order)))}</span>`) : '—';
    const today = getLocalDateStr(0);
    const over = eff && eff < today && getOrderPaymentStatus(order).status !== 'paid';
    lbl.style.color = over ? '#a3493d' : '';
}
async function _loadDetailInvDue(order) {
    try {
        const { data, error } = await db.from('orders').select('inv_due_date, consolidated_invoice_id').eq('id', order.id).single();
        if (error) throw error;
        let due = data.inv_due_date || null;
        if (data.consolidated_invoice_id) {
            const r = await db.from('consolidated_invoices').select('due_date, cancelled_at').eq('id', data.consolidated_invoice_id).single();
            if (!r.error && r.data && !r.data.cancelled_at && r.data.due_date) due = r.data.due_date;
        }
        _detailInvDue[order.id] = due || null;
    } catch (e) { console.error('срок счёта', e); _detailInvDue[order.id] = null; }
    if (currentOrderId === order.id) refreshDetailDue(order);
}
function openDetailDueCalendar() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    if (typeof orderHasInvoice === 'function' && orderHasInvoice(order)) { showInfo(t('order_due_inv_hint')); return; }
    toggleCustomCalendar('globalCalendarPopup', 'detailDue', 'detailDueBtnLabel', { onPick: function () { saveDueDate(); }, allowClear: true });
}

// v952: «получено» и «авансом» — отдельно (аванса нет — одно число «оплачено», как раньше)
function orderPaidPartsHtml(payInfo) {
    const credit = Math.max(0, Math.round((payInfo.creditAmt || 0) * 100)) / 100;
    if (credit <= 0.004) return `<span style="color:#4f6349">${formatMoney(payInfo.paidAmt)} ${t('orders_paid_lower')}</span>`;
    const money = Math.round((payInfo.paidAmt - credit) * 100) / 100;
    return `<span style="color:#4f6349">${formatMoney(money)} + ${formatMoney(credit)} ${t('orders_credit_short')}</span>`;
}
function getOrderPaymentStatus(order) {
    const paidAmt = _orderPaidTotals[order.id] || 0;
    const creditAmt = (typeof _orderCreditTotals !== 'undefined' && _orderCreditTotals[order.id]) || 0;   // v952: часть paidAmt, закрытая авансом
    const grandAmt = orderGrandTotal(order);
    // Допуск в 1 цент — иначе копеечное расхождение при округлении (JS vs заранее
    // посчитанные суммы, например при переносе данных) ошибочно показывало
    // "частично оплачен" вместо "оплачен".
    const EPS = 0.01;
    let status = 'unpaid';
    if (grandAmt <= EPS) {
        // Платить нечего (например, скидка 100%) — заказ считается закрытым
        status = 'paid';
    } else if (paidAmt > 0 && paidAmt < grandAmt - EPS) {
        status = 'partial';
    } else if (paidAmt >= grandAmt - EPS) {
        status = 'paid';
    }
    const today = getLocalDateStr(0);
    const dueEff = order.due_date || orderAutoDue(order);   // срок заказа; если не задан — дата заказа + отсрочка клиента
    const overdue = !!dueEff && dueEff < today && status !== 'paid';
    return { paidAmt, creditAmt, grandAmt, status, overdue };
}

// ---- Фильтры списка заказов ----

let selectedOrderCustomers = []; // пусто = все клиенты
// Фильтр по статусу ставит ТОЛЬКО Dashboard (dashboard.js): '' = нет; иначе 'принят' / 'в работе' / 'выполнен'.
// _dashSavedOnly — при фильтре из Dashboard в список входят только сохранённые заказы (без черновиков),
// чтобы число на плашке совпадало со списком.
// ==================== ЯРЛЫКИ ДОКУМЕНТОВ У ЗАКАЗА (30.10.2026) ====================
// Состояние документов заказа: 'cons' — в сводном счёте; 'inv' — есть счёт по заказу (orders.inv_no);
// 'out' — выставлен вне программы (cons_excluded); 'cash' — id1: частный клиент, оплачено наличными без счёта;
// 'none' — счёта нет. Черновики не учитываются (null).
function orderDocKind(o) {
    const k = _orderDocKindRaw(o);
    // Режим «По заказу»: документы не отслеживаем — «нет счёта»/«наличные»/«вне программы» не показываем (выставленные остаются видны)
    if ((k === 'none' || k === 'cash' || k === 'out') && typeof docsEnabled === 'function' && !docsEnabled()) return null;
    return k;
}
function _orderDocKindRaw(o) {
    if (!o || !isOrderSaved(o)) return null;
    if (o.consolidated_invoice_id) return 'cons';
    if (o.inv_no) return 'inv';
    // «Вести учёт с даты» (30.10.2026): заказы раньше даты — вне программы, счёт не требуется
    if (o.cons_excluded || (typeof currentOrgInvoicingFrom !== 'undefined' && currentOrgInvoicingFrom && String(o.date || o.order_date || '') < currentOrgInvoicingFrom)) return 'out';
    // Годовые правила (31.10.2026): заказ прошлого года без документа после 15 января — вне программы (в базу не пишется, считается на лету)
    if (typeof docYearAllowed === 'function') {
        const oy = Number(String(o.date || o.order_date || '').slice(0, 4));
        if (oy && oy < orgNowDate().getFullYear() && !docYearAllowed(oy)) return 'out';
    }
    if (typeof currentOrgCashNoInv !== 'undefined' && currentOrgCashNoInv) {
        const cust = o.customer_id ? customers.find(c => c.id === o.customer_id) : null;
        const isPrivate = !cust || cust.entity_type !== 'company';
        if (isPrivate && getOrderPaymentStatus(o).status === 'paid') return 'cash';
    }
    return 'none';
}
function orderNeedsInvoice(o) { return orderDocKind(o) === 'none'; }

let _docChipConsLoading = false;
function orderDocChipsHtml(o) {
    const kind = orderDocKind(o);
    if (!kind) return '';
    const chips = [];
    if (kind === 'cons') {
        let num = typeof _payConsNumber === 'function' ? _payConsNumber(o.consolidated_invoice_id) : '…';
        if (num === '…' && !_docChipConsLoading && typeof _payLoadConsNumbers === 'function') {
            _docChipConsLoading = true;
            const ids = [...new Set(orders.map(x => x.consolidated_invoice_id).filter(Boolean))];
            _payLoadConsNumbers(ids).then(() => { _docChipConsLoading = false; if (typeof displayOrders === 'function') displayOrders(); });
        }
        chips.push(`<span class="oc-chip oc-chip-cons"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5"/></svg>${escapeHtml(t('orders_doc_in_cons'))} ${escapeHtml(num)}</span>`);
    } else if (kind === 'inv') {
        chips.push(`<span class="oc-chip oc-chip-ok">${escapeHtml(t('orders_doc_invoice'))} ${escapeHtml(_formatDocNumber('invoice', o.inv_no))}</span>`);
    } else if (kind === 'out') {
        chips.push(`<span class="oc-chip oc-chip-out">${escapeHtml(t('orders_doc_outside'))}</span>`);
    } else if (kind === 'cash') {
        chips.push(`<span class="oc-chip oc-chip-out">${escapeHtml(t('orders_doc_cash'))}</span>`);
    } else {
        chips.push(`<span class="oc-chip oc-chip-none">${escapeHtml(t('orders_doc_no_invoice'))}</span>`);
    }
    if (o.dn_no) chips.push(`<span class="oc-chip oc-chip-ok">${escapeHtml(t('orders_doc_delivery_note'))} ${escapeHtml(_formatDocNumber('delivery_note', o.dn_no))}</span>`);
    return `<div class="oc-doc-line">${chips.join('')}</div>`;
}

let ordersStatusFilter = '';
let _dashSavedOnly = false;
// _dashUnpaidOnly — плашка «Ждут оплаты»: заказы, оплаченные не полностью (getOrderPaymentStatus)
let _dashUnpaidOnly = false;

// opts.ignoreDate — без фильтра «Период» (для календаря-фильтра: он сам выбирает день), 23.10
function getFilteredOrdersForList(opts) {
    const dateRange = (opts && opts.ignoreDate) ? 'all' : (document.getElementById('orderDateRangeFilter') ? document.getElementById('orderDateRangeFilter').value : 'all');
    const dateFrom  = document.getElementById('orderDateFrom') ? document.getElementById('orderDateFrom').value : '';
    const dateTo    = document.getElementById('orderDateTo')   ? document.getElementById('orderDateTo').value   : '';
    const employeeFilter = document.getElementById('orderEmployeeFilter') ? document.getElementById('orderEmployeeFilter').value : '';
    const paymentFilter  = document.getElementById('orderPaymentFilter')  ? document.getElementById('orderPaymentFilter').value  : '';
    // Черновики (заказ без номера) видит только автор; чужие черновики и пустые брошенные
    // черновики ожидающие удаления в списке не показываем
    const cancelledMode = paymentFilter === 'cancelled';   // v983
    let filtered = cancelledMode ? cancelledOrders.slice() : orders.filter(isOrderVisible);
    if (!cancelledMode) {
    if (ordersStatusFilter || _dashSavedOnly || _dashUnpaidOnly) filtered = filtered.filter(isOrderSaved);
    if (_dashUnpaidOnly) filtered = filtered.filter(o => getOrderPaymentStatus(o).status !== 'paid');
    if (ordersStatusFilter) filtered = filtered.filter(o => o.status === ordersStatusFilter);
    }
    if (selectedOrderCustomers.length > 0) filtered = filtered.filter(o => selectedOrderCustomers.includes(o.customer));
    if (employeeFilter) filtered = filtered.filter(o => String(o.employee_id) === employeeFilter);
    if (paymentFilter && !cancelledMode) {
        filtered = filtered.filter(o => {
            const info = getOrderPaymentStatus(o);
            if (paymentFilter === 'noinv') return orderNeedsInvoice(o);
            return paymentFilter === 'overdue' ? info.overdue : info.status === paymentFilter;
        });
    }
    if (dateRange === 'week' || dateRange === 'month') {
        const today = orgNowDate();
        let startStr, endStr;
        if (dateRange === 'week') {
            // Неделя Пн–Вс: от понедельника до воскресенья включительно
            const mon = getMondayOf(today);
            const sun = new Date(mon);
            sun.setDate(sun.getDate() + 6);
            startStr = mon.getFullYear() + '-' + String(mon.getMonth()+1).padStart(2,'0') + '-' + String(mon.getDate()).padStart(2,'0');
            endStr   = sun.getFullYear() + '-' + String(sun.getMonth()+1).padStart(2,'0') + '-' + String(sun.getDate()).padStart(2,'0');
            filtered = filtered.filter(o => o.date >= startStr && o.date <= endStr);
        } else {
            startStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
            filtered = filtered.filter(o => o.date >= startStr);
        }
    } else if (dateRange === 'custom' && dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to   = new Date(dateTo); to.setDate(to.getDate() + 1);
        filtered = filtered.filter(o => { const d = new Date(o.date); return d >= from && d < to; });
    }
    return filtered;
}

// Проверяет все заказы с отложенным списанием (inventory_pending = true), списывает
// склад и снимает флаг. С 21.10 отложенное списание отключено (helpers.js
// shouldWriteOffNow всегда true) — функция только дописывает заказы, отложенные раньше.
// Вызывается при каждой загрузке данных (loadAllData), чтобы отложенные заказы
// "дозревали" сами, без участия пользователя.
// Не запускаем два прохода одновременно (загрузка данных + добавление позиции) —
// иначе один заказ мог бы списаться дважды; второй вызов ждёт первый и проверяет заново.
let _pendingInvRun = null;
async function processPendingInventory() {
    while (_pendingInvRun) { try { await _pendingInvRun; } catch (e) { /* ниже повторим */ } }
    _pendingInvRun = _processPendingInventoryOnce();
    try { await _pendingInvRun; } finally { _pendingInvRun = null; }
}

async function _processPendingInventoryOnce() {
    const pending = orders.filter(o => o.inventory_pending && shouldWriteOffNow(o.date));
    if (!pending.length) return;
    for (const order of pending) {
        for (const it of (order.items || [])) {
            const prod = products.find(p => p.id === it.product_id);
            if (!prod) continue;
            const actualCost = await writeOffInventoryForItem(prod, it.quantity, order.id, it.id);
            if (actualCost != null && Math.abs(actualCost - (it.item_cost || 0)) > 0.0001) {
                try {
                    await dbMust(db.from('order_items').update({ item_cost: actualCost }).eq('id', it.id));
                    it.item_cost = actualCost;
                } catch (e) { console.error('Не удалось обновить себестоимость позиции:', e); }
            }
        }
        try {
            await updateChecked(db.from('orders').update({ inventory_pending: false }).eq('id', order.id));
            order.inventory_pending = false;
        } catch (e) { console.error('Не удалось снять inventory_pending:', e); }
    }
    displayOrders();
}

function updateOrderCustomerFilter() {
    const allRow = document.getElementById('orderFilterAllRow');
    if (allRow) allRow.classList.toggle('selected', selectedOrderCustomers.length === 0);

    const list = document.getElementById('orderFilterList');
    if (!list) return;
    list.innerHTML = '';
    // Сверху — до 5 клиентов с наибольшим числом заказов (по убыванию), затем все
    // остальные по алфавиту. При ≤5 клиентах отдельная верхняя группа не нужна.
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
    const orderCount = {};
    orders.forEach(o => {
        if (!isOrderVisible(o)) return;
        if (o.customer) orderCount[o.customer] = (orderCount[o.customer] || 0) + 1;
    });
    const sortedAll = customers.slice().sort(byName);
    let top = [];
    if (sortedAll.length > 5) {
        top = sortedAll
            .filter(c => orderCount[c.name] > 0)
            .sort((a, b) => (orderCount[b.name] - orderCount[a.name]) || byName(a, b))
            .slice(0, 5);
    }
    const topSet = new Set(top);
    const ordered = top.concat(sortedAll.filter(c => !topSet.has(c)));
    ordered.forEach((c, i) => {
        const selected = selectedOrderCustomers.includes(c.name);
        const row = document.createElement('div');
        row.className = 'status-option' + (selected ? ' selected' : '');
        row.style.justifyContent = 'flex-start';
        row.style.gap = '4px';
        row.style.padding = '9px 6px';
        // тонкая линия между «топ-5» и остальными
        if (top.length && i === top.length - 1 && ordered.length > top.length) row.style.borderBottom = '1px solid #e8e3d6';
        row.addEventListener('click', () => onOrderCustomerFilterChange(c.name));
        row.innerHTML = `<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span>${escapeHtml(c.name)}</span>`;
        list.appendChild(row);
    });
    updateOrderFilterLabel();
}

function updateOrderEmployeeFilter() {
    const sel = document.getElementById('orderEmployeeFilter');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">${t('orders_filter_all_staff')}</option>`;
    employees.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name + (e.archived_at ? ' · ' + t('employees_archived_tag') : '');
        if (String(e.id) === prev) opt.selected = true;
        sel.appendChild(opt);
    });
    renderOrderEmployeeFilterList();
}

function renderOrderEmployeeFilterList() {
    const list = document.getElementById('orderEmployeeFilterList');
    if (!list) return;
    const current = document.getElementById('orderEmployeeFilter').value;
    let html = `<div class="status-option${current === '' ? ' selected' : ''}" onclick="setOrderEmployeeFilter('')"><span>${t('orders_filter_all_staff')}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    employees.forEach(e => {
        html += `<div class="status-option${String(e.id) === current ? ' selected' : ''}" onclick="setOrderEmployeeFilter('${e.id}')"><span>${escapeHtml(e.name + (e.archived_at ? ' · ' + t('employees_archived_tag') : ''))}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    });
    list.innerHTML = html;
}

function setOrderEmployeeFilter(employeeId) {
    document.getElementById('orderEmployeeFilter').value = employeeId;
    renderOrderEmployeeFilterList();
    closeAllFilterDropdowns();
    applyOrderFilter();
}

function setOrderDateRangeFilter(range) {
    document.getElementById('orderDateRangeFilter').value = range;
    document.querySelectorAll('#orderPeriodDropdown .status-option').forEach(o => o.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    toggleOrderDateRange();
    closeAllFilterDropdowns();
    if (range === 'custom') {
        updateOrderFilterButtonsState();
        // stopPropagation — иначе этот же клик долетает до document и глобальный
        // closeAllCalendarPopups() (закрытие календаря по тапу "снаружи") закрывает
        // календарь сразу же, в рамках того же самого клика, которым мы его открыли.
        event.stopPropagation();
        toggleCustomCalendarRange('globalCalendarPopup', 'orderDateFrom', 'orderDateTo', 'orderDateRangeFromLabel', 'orderDateRangeToLabel', { onApply: function () { applyOrderFilter(); } });
    } else {
        applyOrderFilter();
    }
}

function setOrderPaymentFilter(status) {
    document.getElementById('orderPaymentFilter').value = status;
    document.querySelectorAll('#orderPaymentDropdown .status-option').forEach(o => o.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    closeAllFilterDropdowns();
    applyOrderFilter();
}

function toggleFilterDropdown(id, triggerEl) {
    // У этих кнопок (в отличие от .status-dropdown) нет обёртки со
    // stopPropagation — без него клик по кнопке долетел бы до document и
    // глобальный closeAllFilterDropdowns закрыл бы только что открытое меню
    // в рамках того же клика.
    if (typeof event !== 'undefined' && event) event.stopPropagation();
    document.querySelectorAll('.filter-dropdown').forEach(d => {
        if (d.id !== id) { d.classList.add('hidden'); closePortalDropdown(d); }
    });
    const dd = document.getElementById(id);
    if (!dd) return;
    const isHidden = dd.classList.contains('hidden');
    if (isHidden) {
        dd.classList.remove('hidden');
        openPortalDropdown(dd, triggerEl || event.currentTarget);
    } else {
        dd.classList.add('hidden');
        closePortalDropdown(dd);
    }
}

function closeAllFilterDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(d => { d.classList.add('hidden'); closePortalDropdown(d); });
}

function toggleAllOrderCustomersFilter() {
    selectedOrderCustomers = [];
    updateOrderCustomerFilter();
    applyOrderFilter();
}

function onOrderCustomerFilterChange(name) {
    if (selectedOrderCustomers.includes(name)) {
        selectedOrderCustomers = selectedOrderCustomers.filter(n => n !== name);
    } else {
        selectedOrderCustomers.push(name);
    }
    updateOrderCustomerFilter();
    applyOrderFilter();
}

// Кнопка "Клиенты" больше не показывает выбранное значение (по решению Сержа —
// без предустановленных значений на кнопках фильтров), поэтому текст не меняем.
// Функция оставлена как есть (вызывается из нескольких мест), чтобы не трогать
// остальную логику фильтра клиентов.
function updateOrderFilterLabel() {}

function toggleOrderDateRange() {
    const range = document.getElementById('orderDateRangeFilter').value;
    document.getElementById('orderCustomDateRange').classList.toggle('hidden', range !== 'custom');
}

// Сбросить фильтр по статусу, поставленный Dashboard (крестик в полосе итога)
function clearOrdersStatusFilter() {
    ordersStatusFilter = '';
    _dashUnpaidOnly = false;
    _dashSavedOnly = false;
    applyOrderFilter();
}

function applyOrderFilter() {
    // Любое ручное изменение фильтров делает дату «обычной»: Dashboard её больше не сбрасывает
    if (typeof _dashDayFilter !== 'undefined') { _dashDayFilter = false; if (!ordersStatusFilter && !_dashUnpaidOnly) _dashSavedOnly = false; }
    resetOrdersRenderLimits();
    updateOrderFilterButtonsState();
    displayOrders();
}


// ==================== ИТОГ ПО ФИЛЬТРУ + ОКНО «ИЗДЕЛИЯ» ====================
// Полоса под блоком иконок: видна, только если включён хотя бы один фильтр.
// Считает по ВСЕМ отфильтрованным заказам (а не по подгруженной части списка).
let _ofsFiltered = [];

function ordersFilterDescription() {
    const parts = [];
    if (selectedOrderCustomers.length === 1) parts.push(selectedOrderCustomers[0]);
    else if (selectedOrderCustomers.length === 2) parts.push(selectedOrderCustomers.join(', '));
    else if (selectedOrderCustomers.length > 2) parts.push(t('stats_all_customers_short') + ': ' + selectedOrderCustomers.length);
    const range = document.getElementById('orderDateRangeFilter')?.value || 'all';
    if (range === 'week') parts.push(t('stats_range_week'));
    else if (range === 'month') parts.push(t('stats_range_month'));
    else if (range === 'custom') {
        const f = document.getElementById('orderDateFrom')?.value, to = document.getElementById('orderDateTo')?.value;
        if (f && to) parts.push(f === to ? formatDateDMY(f) : formatDateDMY(f) + ' – ' + formatDateDMY(to));
    }
    const empId = document.getElementById('orderEmployeeFilter')?.value || '';
    if (empId) {
        const emp = (typeof employees !== 'undefined' ? employees : []).find(e => String(e.id) === empId);
        parts.push(t('orders_master') + ': ' + (emp ? emp.name : '?'));
    }
    const pay = document.getElementById('orderPaymentFilter')?.value || '';
    if (pay) parts.push(pay === 'noinv' ? t('orders_filter_no_invoice') : t('orders_payment') + ': ' + t('pay_status_' + pay));
    if (ordersStatusFilter) parts.push(t('dash_status_label') + ': ' + orderStatusLabelCap(ordersStatusFilter));
    if (_dashUnpaidOnly) parts.push(t('dash_unpaid'));
    return parts.join(' · ');
}

function updateOrdersFilterSummary(filtered) {
    const el = document.getElementById('ordersFilterSummary');
    if (!el) return;
    const desc = ordersCancelledMode() ? '' : ordersFilterDescription();
    if (!desc) { el.classList.add('hidden'); _ofsFiltered = []; return; }
    _ofsFiltered = filtered;
    const hasVat = (typeof currentOrgVatRate !== 'undefined') && currentOrgVatRate > 0 && (currentOrgProtected || currentOrgVatPayer);
    const wt = calcGroupTotals(filtered, () => true);
    const counts = `${wt.count} ${t('orders_orders_short')}, ${wt.qty} ${t('unit_pcs')}`;
    const sums = hasVat
        ? `${formatMoney(wt.net)} ${t('orders_sum_novat_short')} · <b>${formatMoney(wt.sum)}</b> ${t('orders_sum_withvat_short')}`
        : `<b>${formatMoney(wt.sum)}</b>`;
    const clearX = (ordersStatusFilter || _dashUnpaidOnly) ? `<span class="ofs-x" role="button" aria-label="${escapeHtml(t('dash_clear_filter'))}" onclick="event.stopPropagation(); clearOrdersStatusFilter()">✕</span>` : '';
    el.innerHTML = `<div class="ofs-row1"><span class="ofs-filters">${escapeHtml(desc)}</span>${clearX}<span class="ofs-link">${t('orders_summary_products')} ›</span></div>
        <div class="ofs-row2"><span class="ofs-counts">${counts}</span><span class="ofs-sums">${sums}</span></div>`;
    el.classList.remove('hidden');
}

function openOrdersProductsModal() {
    const orders_ = _ofsFiltered || [];
    const hasVat = (typeof currentOrgVatRate !== 'undefined') && currentOrgVatRate > 0 && (currentOrgProtected || currentOrgVatPayer);
    const agg = {};
    orders_.forEach(o => {
        const tot = _orderTotals(o);
        orderBillItems(o).forEach((it, i) => {
            const key = it.product || '—';
            const line = tot.lines[i] || { net: 0, vat: 0, gross: 0 };
            const a = agg[key] || (agg[key] = { qty: 0, gross: 0, vat: 0 });
            a.qty += Number(it.quantity || 0);
            a.gross += line.gross;
            a.vat += line.vat;
        });
    });
    const rows = Object.entries(agg).sort((a, b) => b[1].gross - a[1].gross);
    let tq = 0, tg = 0, tv = 0;
    rows.forEach(([, a]) => { tq += a.qty; tg += a.gross; tv += a.vat; });
    const sumHead = t('stats_col_sum');
    let html = '<table class="w-full stats-table table-clean"><thead><tr style="background-color:#e3e8df; position:sticky; top:0;">'
        + `<th class="p-0.5 text-left">${t('stats_col_product')}</th><th class="p-0.5 text-right">${t('stats_col_qty')}</th><th class="p-0.5 text-right">${sumHead}</th>`
        + (hasVat ? `<th class="p-0.5 text-right">${t('stats_col_vat')}</th>` : '') + '</tr></thead><tbody>';
    rows.forEach(([name, a]) => {
        html += `<tr class="border-b"><td class="p-0.5">${escapeHtml(name)}</td><td class="p-0.5 text-right">${roundQty(a.qty)}</td><td class="p-0.5 text-right stats-num">${a.gross.toFixed(2)}</td>`
            + (hasVat ? `<td class="p-0.5 text-right" style="color:#6b7280;">${a.vat.toFixed(2)}</td>` : '') + '</tr>';
    });
    html += `<tr style="font-weight:700;"><td class="p-0.5">${t('orders_products_total')}</td><td class="p-0.5 text-right">${roundQty(tq)}</td><td class="p-0.5 text-right stats-num">${tg.toFixed(2)}</td>`
        + (hasVat ? `<td class="p-0.5 text-right">${tv.toFixed(2)}</td>` : '') + '</tr></tbody></table>';
    if (hasVat) html += `<p class="text-xs mt-2" style="color:#6b7280;">${formatMoney(tg - tv)} ${t('orders_sum_novat_short')} · ${formatMoney(tg)} ${t('orders_sum_withvat_short')}</p>`;
    document.getElementById('ordersProductsModalTitle').textContent = t('orders_products_title');
    document.getElementById('ordersProductsModalSub').textContent = ordersFilterDescription() + ' · ' + orders_.length + ' ' + t('orders_orders_short');
    document.getElementById('ordersProductsModalBody').innerHTML = rows.length ? html : `<p class="text-xs text-gray-400">${t('stats_no_data')}</p>`;
    document.getElementById('ordersProductsModal').style.display = 'flex';
}

// ==================== КАЛЕНДАРЬ-ФИЛЬТР ПО ДАТЕ (иконка в переключателе
// Карточки/Таблица) ====================
// Тот же попап-календарь, но с включёнными бейджами (сколько заказов в
// какой день — orderCountBadgeForDay уже был написан для этого, просто не
// использовался). Пишет в ТЕ ЖЕ orderDateFrom/orderDateTo/orderDateRangeFilter,
// что и табличный фильтр "Период" — состояние общее для обоих видов.
// Пока только один день; диапазон через эту иконку — следующий шаг.
function openOrdersCardFilterCalendar() {
    // stopPropagation — у этой кнопки, в отличие от большинства других триггеров
    // календаря, нет обёртки с этим уже готовым — без него клик долетел бы до
    // document и глобальный closeAllCalendarPopups закрыл бы только что открытый
    // попап в рамках того же клика.
    if (typeof event !== 'undefined' && event) event.stopPropagation();
    // Точки на днях — по заказам, прошедшим фильтры Клиенты / Мастер / Оплата
    // (без «Периода»); под месяцем — строка с включёнными фильтрами. 23.10
    const calList = getFilteredOrdersForList({ ignoreDate: true });
    toggleCustomCalendar('globalCalendarPopup', 'ordersCardFilterTempDate', 'ordersCardFilterTempLabel', {
        onPick: onOrdersCardDatePicked,
        badge: function (y, m, d) { return orderCountBadgeForDay(y, m, d, calList); },
        subtitleHtml: ordersCalendarFilterSubtitleHtml(),
        allowClear: true
    });    // 27.10: календарь ставим на «чистое поле» под панелью капсул (и под карточкой итога по фильтрам, если она показана),
    // чтобы он не перекрывал их и не прижимался к ним. Над разделителем «Заказы в работе» остаётся зазор ~10px.
    (function () {
        const pop = document.getElementById('globalCalendarPopup');
        if (!pop || !pop.classList.contains('open')) return;
        let anchor = document.getElementById('ordersViewToggle')?.getBoundingClientRect().bottom || 0;
        const sum = document.getElementById('ordersFilterSummary');
        if (sum && !sum.classList.contains('hidden')) {
            const sb = sum.getBoundingClientRect().bottom;
            if (sb > anchor && sb < window.innerHeight * 0.6) anchor = sb;
        }
        if (anchor > 0) pop.style.top = Math.round(anchor + 10) + 'px';
    })();
    const btn = document.getElementById('ordersCardCalendarBtn');
    const open = document.getElementById('globalCalendarPopup')?.classList.contains('open');
    if (btn) { btn.classList.toggle('is-open', !!open); if (open) btn.setAttribute('data-cal-trigger', '1'); }
}

// Строка под месяцем в календаре-фильтре: «Клиент: X · Мастер: Y · Оплата: Z».
// Пусто, если фильтры Клиенты / Мастер / Оплата не включены. 23.10
function ordersCalendarFilterSubtitleHtml() {
    const parts = [];
    if (selectedOrderCustomers.length === 1) parts.push(t('stats_col_customer') + ': <b>' + escapeHtml(selectedOrderCustomers[0]) + '</b>');
    else if (selectedOrderCustomers.length > 1) parts.push(t('stats_all_customers_short') + ': <b>' + selectedOrderCustomers.length + '</b>');
    const empId = document.getElementById('orderEmployeeFilter')?.value || '';
    if (empId) {
        const emp = (typeof employees !== 'undefined' ? employees : []).find(e => String(e.id) === empId);
        parts.push(t('orders_master') + ': <b>' + escapeHtml(emp ? emp.name : '?') + '</b>');
    }
    const pay = document.getElementById('orderPaymentFilter')?.value || '';
    if (pay) parts.push(pay === 'noinv' ? '<b>' + escapeHtml(t('orders_filter_no_invoice')) + '</b>' : t('orders_payment') + ': <b>' + escapeHtml(t('pay_status_' + pay)) + '</b>');
    return parts.join(' · ');
}

function onOrdersCardDatePicked(iso) {
    const rangeSelect = document.getElementById('orderDateRangeFilter');
    if (!iso) {
        rangeSelect.value = 'all';
        document.getElementById('orderDateFrom').value = '';
        document.getElementById('orderDateTo').value = '';
    } else {
        rangeSelect.value = 'custom';
        document.getElementById('orderDateFrom').value = iso;
        document.getElementById('orderDateTo').value = iso;
    }
    // Держим табличные фильтры (селектор "Период" и его подсветку) в
    // синхронизации, раз состояние теперь общее.
    if (typeof toggleOrderDateRange === 'function') toggleOrderDateRange();
    applyOrderFilter();
}

// Кнопка фильтра заливается фисташковым, если в ней реально что-то выбрано —
// так видно, какие фильтры сейчас активны, без необходимости менять текст
// на самой кнопке (особенно неудобно для "Клиенты", где выбор мог быть множественный).
function updateOrderFilterButtonsState() {
    const clientsBtn  = document.getElementById('orderFilterBtn');
    const periodBtn   = document.getElementById('orderPeriodBtn');
    const employeeBtn = document.getElementById('orderEmployeeBtn');
    const paymentBtn  = document.getElementById('orderPaymentBtn');
    const cardCalBtn  = document.getElementById('ordersCardCalendarBtn');
    if (clientsBtn)  clientsBtn.classList.toggle('active', selectedOrderCustomers.length > 0);
    if (periodBtn)   periodBtn.classList.toggle('active', document.getElementById('orderDateRangeFilter').value !== 'all');
    if (employeeBtn) employeeBtn.classList.toggle('active', document.getElementById('orderEmployeeFilter').value !== '');
    if (paymentBtn)  paymentBtn.classList.toggle('active', document.getElementById('orderPaymentFilter').value !== '');
    // Иконка календаря в переключателе Карточки/Таблица — общее состояние с
    // "Период" из табличных фильтров (сейчас общий фильтр на оба вида).
    if (cardCalBtn)  cardCalBtn.classList.toggle('active', document.getElementById('orderDateRangeFilter').value !== 'all');
}

// Закрытие любой открытой панели фильтра заказов по клику снаружи её самой —
// раньше здесь была проверка "клик вне .relative-обёртки кнопки", но теперь
// сам дропдаун при открытии переносится в #dropdownPortal (у которого свой
// stopPropagation), так что просто: клик долетел до document — снаружи.
document.addEventListener('click', closeAllFilterDropdowns);

// ---- Черновик и сохранённый заказ ----
// Номер заказа выдаётся только при сохранении (кнопка «Сохранить» или выход из карточки
// с клиентом и позициями). Пока номера нет — это черновик: его видит только автор.
// Старые заказы (с номером или подтверждённые) всегда считаются сохранёнными.
function isOrderSaved(o) { return !!(o && (o.order_number || o.is_confirmed)); }

function isOrderVisible(o) {
    if (isOrderSaved(o)) return true;
    const me = currentEmployee ? currentEmployee.id : null;
    // Свой черновик показываем, только когда в нём уже есть клиент или позиции (пустой — это заготовка)
    if ((o.created_by || null) === me) return !!(o.customer_id || (o.items && o.items.length > 0));
    // Совсем старые заказы без автора и без номера: показываем, если в них есть клиент или позиции
    return !o.created_by && !!(o.customer_id || (o.items && o.items.length > 0));
}

// Подпись под заголовком карточки и кнопка «Сохранить заказ» (внизу, под позициями) зависят от того,
// сохранён ли заказ: у черновика — подсказка про сохранение и кнопка, у сохранённого — «автосохранение».
function updateDetailSaveUi(order) {
    const saved = isOrderSaved(order);
    document.getElementById('confirmOrderWrap')?.classList.toggle('hidden', saved);
    document.getElementById('cancelOrderBtn')?.classList.toggle('hidden', !canShowCancelButton(order));   // v983
    const note = document.getElementById('detailAutosaveNote');
    if (note) {
        const key = saved ? 'company_autosave' : 'orders_draft_hint';
        note.setAttribute('data-i18n', key);
        note.textContent = t(key);
    }
}

function orderNumLabel(o) { return o.order_number ? ('№' + o.order_number) : (o.is_demo ? t('order_demo_label') : t('orders_draft_label')); }

// Подпись в карточке списка: номер у сохранённого заказа, заметная плашка у несохранённого
// (черновик виден только автору: другие сотрудники его не видят, push не уходит).
function orderMetaHtml(o) {
    if (isOrderSaved(o)) return escapeHtml(orderNumLabel(o));
    return `<span class="oc-chip oc-chip-unsaved">${escapeHtml(t('orders_unsaved_chip'))}</span>`;
}

// Полоса над списком заказов: свои несохранённые заказы (с клиентом или позициями).
function renderDraftBar() {
    const box = document.getElementById('ordersDraftBar');
    if (!box) return;
    const me = currentEmployee ? currentEmployee.id : null;
    const mine = orders.filter(o => !o.deleted_at && !isOrderSaved(o) && (o.created_by || null) === me && isOrderVisible(o));
    if (!mine.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="oc-draftbar">
        <span class="db-t">${escapeHtml(t('orders_unsaved_bar').replace('{n}', String(mine.length)))}<span class="db-s">${escapeHtml(t('orders_unsaved_bar_sub'))}</span></span>
        <button type="button" onclick="openOrderDetail(${mine[0].id})">${escapeHtml(t('orders_unsaved_open'))}</button>
    </div>`;
}

// Переключение нижней вкладки из открытого несохранённого заказа: так же, как «Назад»,
// сначала сохраняем или спрашиваем (resolveDraftOnLeave), и только потом уходим.
// true — переход отложен (showTab вызовется снова после решения).
let _draftGuardBypass = false; // v973: программный переход в карточку клиента из заказа не должен вызывать вопрос «сохранить/удалить»
function orderDraftGuardOnTab(tabId) {
    if (_draftGuardBypass) return false;
    if (tabId === 'orders' || currentOrderId === null) return false;
    const detail = document.getElementById('orderDetail');
    if (!detail || !detail.classList.contains('active')) return false;
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || isOrderSaved(order)) return false;
    if (!order.customer_id && !(order.items && order.items.length > 0)) return false;
    resolveDraftOnLeave(order).then(ok => { if (ok) showTab(tabId); });
    return true;
}

// Есть ли в пекарне другие сотрудники, которым уйдёт уведомление о сохранённом заказе
function orderTeamHasOthers() {
    return activeEmployees().some(e => !currentEmployee || e.id !== currentEmployee.id);
}

// ---- Создание и копирование заказа ----

// Кнопка "+": сразу создаёт черновик заказа (клиент пока не выбран,
// дата — сегодня, статус — "принят") и открывает его карточку.
// Клиента и остальное можно дозаполнить уже внутри карточки.
async function createDraftOrderAndOpen() {
    suppressRealtimeFor3s();
    const today = getLocalDateStr(0);
    const employeeId = currentEmployee ? currentEmployee.id : null;
    showLoading();
    try {
        // Черновик создаётся БЕЗ номера: номер выдаётся при сохранении заказа (saveDraftOrder),
        // поэтому брошенные пустые черновики не оставляют дыр в нумерации.
        const { data, error } = await db.from('orders').insert({
            org_id: currentOrgId, customer_id: null, order_date: today, status: 'принят', discount: 0, vat_exempt: false,
            employee_id: employeeId, order_number: null, is_confirmed: false, created_by: employeeId
        }).select().single();
        if (error) throw error;
        const emp = employees.find(e => e.id === data.employee_id);
        const newOrder = {
            id: data.id, customer_id: null, customer: '',
            date: data.order_date, status: data.status, discount: 0,
            vat_exempt: false,
            employee_id: data.employee_id || null, employee: emp ? emp.name : '',
            notes: '', order_number: data.order_number || null,
            due_date: null,
            inventory_pending: false,
            is_confirmed: false,
            created_by: employeeId,
            items: []
        };
        orders.push(newOrder);
        _draftOrderIds.add(newOrder.id);
        displayOrders();
        openOrderDetail(newOrder.id);
        logActivity('order', t('log_order_draft_created'), newOrder.id);
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
    } catch (e) { console.error(e); showDbError(e, t('orders_create_error')); }
    finally { hideLoading(); }
}

async function copyOrder(i) {
    const o = (i && typeof i === 'object') ? i : orders[i];   // v983: отменённый заказ передаётся объектом
    const _cc = o && o.customer_id ? customers.find(c => c.id === o.customer_id) : null;
    if (_cc && _cc.archived_at) { showInfo(t('cust_archived_pick').replace('{name}', _cc.name)); return; }   // v950
    suppressRealtimeFor3s();
    const employeeId = currentEmployee ? currentEmployee.id : null;
    showLoading();
    try {
        // Копия — черновик: номер выдаётся только при нажатии «Сохранить заказ» (saveDraftOrder)
        const { data, error } = await db.from('orders').insert({
            org_id: currentOrgId,
            customer_id: o.customer_id,
            order_date: getLocalDateStr(0),
            status: 'принят',
            discount: o.discount || 0,
            vat_exempt: !!o.vat_exempt,
            employee_id: employeeId,
            order_number: null,
            is_confirmed: false,
            created_by: employeeId
        }).select().single();
        if (error) throw error;

        const emp = employees.find(e => e.id === data.employee_id);
        const copy = {
            id: data.id, customer_id: o.customer_id, customer: o.customer,
            date: data.order_date, status: data.status, discount: Number(data.discount || 0),
            vat_exempt: !!data.vat_exempt,
            employee_id: data.employee_id || null, employee: emp ? emp.name : '',
            order_number: null,
            due_date: null,
            inventory_pending: false,
            is_confirmed: false,
            created_by: employeeId,
            _copyDraft: true,
            items: [],
            materials: []
        };

        // orders.push(copy) — намеренно ДО цикла списания склада ниже: writeOffInventoryForItem()
        // ищет заказ через orders.find(o => o.id === orderId), и если заказа ещё нет в массиве —
        // молча выходит без списания и без единой ошибки. Именно из-за обратного порядка
        // (push после цикла) копия заказа никогда не отражалась на складе — это и был
        // настоящий баг, а не что-то, связанное с рецептами или удалёнными изделиями.
        orders.push(copy);

        // Копируем позиции, фиксируем item_cost по текущим ценам
        if (o.items.length) {
            const rows = o.items.map(it => {
                const prod = products.find(p => p.id === it.product_id);
                const itemCost = prod ? parseFloat((productUnitCost(prod) * it.quantity).toFixed(4)) : null;
                return { org_id: currentOrgId, order_id: copy.id, product_id: it.product_id, quantity: it.quantity, price: it.price, item_cost: itemCost };
            });
            const { data: itemsData, error: itemsErr } = await db.from('order_items').insert(rows).select();
            if (itemsErr) throw itemsErr;
            copy.items = (itemsData || []).map(it => {
                const prod = products.find(p => p.id === it.product_id);
                return { id: it.id, product_id: it.product_id, product: prod ? prod.name : it.product_id, quantity: Number(it.quantity), price: Number(it.price), item_cost: it.item_cost != null ? Number(it.item_cost) : null };
            });

            // Снимок рецепта + списание склада для каждой скопированной позиции.
            // Копия всегда создаётся на сегодня, так что shouldWriteOffNow тут
            // практически всегда true, но проверяем на будущее — если логика
            // создания копии когда-нибудь изменится.
            for (const it of copy.items) {
                const prod = products.find(p => p.id === it.product_id);
                if (!prod) continue;
                const effProd = prod;
                await saveOrderItemIngredients(it.id, effProd, it.quantity);
                if (shouldWriteOffNow(copy.date)) {
                    const actualCost = await writeOffInventoryForItem(effProd, it.quantity, copy.id, it.id);
                    if (actualCost != null && it.item_cost != null && Math.abs(actualCost - it.item_cost) > 0.0001) {
                        await dbMust(db.from('order_items').update({ item_cost: actualCost }).eq('id', it.id));
                        it.item_cost = actualCost;
                    }
                } else if (!copy.inventory_pending) {
                    try {
                        await updateChecked(db.from('orders').update({ inventory_pending: true }).eq('id', copy.id));
                        copy.inventory_pending = true;
                    } catch (e) { console.error('Не удалось отметить inventory_pending:', e); }
                }
            }
            // Материалы, добавленные в исходный заказ вручную, переносятся в копию
            for (const m of (o.materials || [])) {
                try { await _setOrderMaterialQty(copy, m.ingredient_id, Number(m.quantity), m.price != null ? Number(m.price) : 0); }
                catch (e) { console.error('Не удалось скопировать материал заказа:', e); }
            }
        }

        _draftOrderIds.add(copy.id);
        displayOrders();
        openOrderDetail(copy.id);
        logActivity('order', `${t('log_order_copied')} ${orderNumLabel(o)} → ${t('log_new_order')} (${t('delete_label_customer')} «${o.customer}»)`, copy.id);
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
        showInfo(t('orders_copy_hint').replace('{n}', o.order_number || ''));
    } catch (e) { console.error(e); showDbError(e, t('orders_copy_error')); }
    finally { hideLoading(); }
}

// ==================== ЗАКАЗЫ — ДЕТАЛЬНЫЙ ВИД ====================
// Открытие/закрытие детального вида заказа, позиции, сохранение шапки.
// Зависит от: db, orders/customers/products/employees, currentOrderId/currentEmployee,
// orderTotal/orderDiscountAmount/orderVatAmount/orderGrandTotal (money.js),
// formatDateDMY (dates.js), showLoading/hideLoading, logActivity (employees.js),
// svgEdit/svgDelete, fillDetailCustomerSelect, updateProductSelects,
// updateCustomerSelects, openDeleteModal, closeModal, editIndex/editItemIdx (главный скрипт).

function openOrderDetail(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        // v983: отменённый заказ открывается только на просмотр; «вернуться туда, откуда открыли» тут не нужно
        if (findCancelledOrder(orderId)) {
            if (typeof forgetSmartStockReturn === 'function') forgetSmartStockReturn();
            if (typeof forgetDocsReturn === 'function') forgetDocsReturn();
            if (typeof forgetDocs2Return === 'function') forgetDocs2Return();
            openCancelledOrder(orderId);
        }
        return;
    }
    currentOrderId = orderId;
    _orderMatOpenFor = null; // блок «Упаковка» при открытии заказа всегда свёрнут

    // Скрыть список, показать детальный вид
    document.getElementById('ordersList').classList.add('hidden');
    document.getElementById('orderDetail').classList.add('active');
    document.getElementById('orderDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('orderDetail').classList.remove('fade-in'), 300);
    // Переключатель "Карточки/Таблица" бессмысленен внутри самой карточки заказа — прячем
    document.getElementById('ordersViewToggle')?.classList.add('hidden');

    document.getElementById('detailOrderId').textContent = order.order_number
        ? `${t('trash_order_word')} ${order.order_number}`
        : (order.is_demo ? `${t('trash_order_word')} ${t('order_demo_label')}` : t('orders_new_order_title'));

    // Заполнить шапку
    fillDetailCustomerSelect(order.customer);
    if (typeof refreshOrderCreditHint === 'function') refreshOrderCreditHint();   // v949: строка «У клиента аванс …»
    document.getElementById('detailDate').value = order.date || '';
    document.getElementById('detailDateBtnLabel').textContent = order.date ? formatDateDMY(order.date) : '—';
    document.getElementById('detailStatus').value   = order.status;
    renderDetailStatusButton(order.status);
    document.getElementById('detailDiscount').value = (order.discount || 0);
    document.getElementById('detailVatExempt').checked = !!order.vat_exempt;
    document.getElementById('detailVatExemptRow')?.classList.toggle('hidden', !currentOrgProtected);   // «Без НДС» в заказе — только у id1 (30.10.2026)
    document.getElementById('detailNotes').value = order.notes || '';
    fillDetailEmployeeSelect(order.employee_id);
    refreshDetailDue(order);
    updateDetailSaveUi(order);

    if (typeof resetDocChangeState === 'function') resetDocChangeState(orderId);   // v943
    renderDetailItems(order);
    updateProductSelects();
    refreshFab();
    loadOrderPayments(orderId);
    if (typeof refreshDetailDocSummary === 'function') refreshDetailDocSummary(order);
}

function fillDetailEmployeeSelect(selectedId) {
    const sel = document.getElementById('detailEmployee');
    if (!sel) return;
    sel.innerHTML = '<option value="">—</option>';
    employees.filter(e => !e.archived_at || String(e.id) === String(selectedId)).forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        if (selectedId && String(e.id) === String(selectedId)) opt.selected = true;
        sel.appendChild(opt);
    });
    renderDetailEmployeeDropdownList(selectedId);
    const current = employees.find(e => String(e.id) === String(selectedId));
    const lbl = document.getElementById('detailEmployeeBtnLabel');
    if (lbl) lbl.textContent = current ? current.name : '—';
}

// ---- Статус в карточке заказа: свой дропдаун (нейтральный, без цвета) ----

function renderDetailStatusButton(status) {
    const lbl = document.getElementById('detailStatusBtnLabel');
    if (!lbl) return;
    lbl.textContent = orderStatusLabelCap(status);
    document.querySelectorAll('#detailStatusDropdown .status-option').forEach((opt, i) => {
        const optStatus = ['принят', 'в работе', 'выполнен'][i];
        opt.classList.toggle('selected', optStatus === status);
    });
}

function toggleDetailStatusDropdown() {
    const dd = document.getElementById('detailStatusDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) openPortalDropdown(dd, event.currentTarget);
}

function setDetailStatus(status) {
    document.getElementById('detailStatus').value = status;
    renderDetailStatusButton(status);
    closeAllOrderStatusDropdowns();
    saveDetailHeader();
}

// ---- Исполнитель в карточке заказа: свой нейтральный дропдаун (не цветной) ----
function renderDetailEmployeeDropdownList(selectedId) {
    const list = document.getElementById('detailEmployeeDropdown');
    if (!list) return;
    let html = `<div class="status-option${!selectedId ? ' selected' : ''}" onclick="setDetailEmployee('')"><span>—</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    employees.filter(e => !e.archived_at || String(e.id) === String(selectedId)).forEach(e => {
        html += `<div class="status-option${String(e.id) === String(selectedId) ? ' selected' : ''}" onclick="setDetailEmployee('${e.id}')"><span>${escapeHtml(e.name)}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    });
    list.innerHTML = html;
}

function toggleDetailEmployeeDropdown() {
    const dd = document.getElementById('detailEmployeeDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) openPortalDropdown(dd, event.currentTarget);
}

function setDetailEmployee(employeeId) {
    document.getElementById('detailEmployee').value = employeeId;
    const current = employees.find(e => String(e.id) === String(employeeId));
    document.getElementById('detailEmployeeBtnLabel').textContent = current ? current.name : '—';
    renderDetailEmployeeDropdownList(employeeId);
    closeAllOrderStatusDropdowns();
    saveDetailHeader();
}

function onDetailCustomerChange() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const customerName = document.getElementById('detailCustomer').value;
    const cust = customers.find(c => c.name === customerName);
    // Подставить скидку и НДС-статус клиента (но всегда редактируемо)
    if (cust) {
        document.getElementById('detailDiscount').value = cust.discount || 0;
        document.getElementById('detailVatExempt').checked = !!cust.vat_exempt;
    }
    saveDetailHeader();
}

// Черновики заказов, созданные кнопкой "+" в этой сессии и ещё не получившие
// клиента. Если уйти из карточки, не выбрав клиента — черновик тихо удаляется,
// чтобы в базе не копились пустые заказы "(удалённый клиент)".
let _draftOrderIds = new Set();

// Страховка на случай, когда приложение убили (смахнули) на карточке нового заказа:
// список _draftOrderIds живёт только в памяти, и пустой черновик оставался в базе.
// Вызывается один раз после первой загрузки данных. Удаляем только СВОИ черновики:
// не подтверждены, без позиций, не открыты сейчас.
async function cleanupAbandonedDrafts() {
    try {
        const myId = currentEmployee ? currentEmployee.id : null;
        if (!myId) return;
        let stale = orders.filter(o =>
            !o.is_confirmed && o.created_by === myId &&
            (!o.items || o.items.length === 0) &&
            !o.customer_id && !(o.notes && String(o.notes).trim()) && !(o.materials && o.materials.length) &&
            o.id !== currentOrderId && !_draftOrderIds.has(o.id));
        // v967: заказ с внесённой оплатой не трогаем (и при ошибке проверки — тоже)
        if (stale.length) {
            const { data: paid, error: pe } = await db.from('order_payments').select('order_id').in('order_id', stale.map(o => o.id));
            if (pe) { console.error('cleanupAbandonedDrafts: оплаты не проверены, чистку пропускаем', pe); return; }
            const paidIds = new Set((paid || []).map(r => r.order_id));
            stale = stale.filter(o => !paidIds.has(o.id));
        }
        for (const o of stale) {
            const { error } = await db.from('orders').delete().eq('id', o.id);
            if (error) { console.error('Не удалось удалить брошенный черновик:', error); continue; }
            const idx = orders.findIndex(x => x.id === o.id);
            if (idx !== -1) orders.splice(idx, 1);
        }
        if (stale.length) displayOrders();
    } catch (e) { console.error('cleanupAbandonedDrafts:', e); }
}

async function cleanupOrderDraftIfEmpty(orderId) {
    if (!_draftOrderIds.has(orderId)) return;
    _draftOrderIds.delete(orderId);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    const order = orders[idx];
    // Не удаляем если выбран клиент, ИЛИ уже добавлены позиции, ИЛИ заказ подтверждён вручную
    if (order.customer_id || (order.items && order.items.length > 0) || order.is_confirmed) return;
    // Убираем из локального списка сразу — не ждём ответа сервера, иначе пустой заказ
    // успевает мелькнуть в списке, а при медленной сети остаётся в нём
    orders.splice(idx, 1);
    suppressRealtimeFor3s();
    try {
        const { error } = await db.from('orders').delete().eq('id', orderId);
        if (error) throw error;
    } catch (e) { console.error('Не удалось удалить пустой черновик заказа (будет убран при следующем запуске):', e); }
}

// Сохраняет черновик как настоящий заказ: клиент обязателен; номер заказа выдаётся здесь
// и записывается ОДНИМ обновлением вместе с is_confirmed = true (push сотрудникам
// срабатывает на этот переход и берёт номер из той же записи). Возвращает true при успехе.
async function saveDraftOrder(order) {
    if (!order) return false;
    if (isOrderSaved(order)) return true;
    if (!order.customer_id) { showInfo(t('orders_save_need_customer')); return false; }
    // Full: не хватает ингредиентов под этот заказ — предупреждаем, но не блокируем (30.10)
    if (typeof orderStockShortList === 'function') {
        const sh = orderStockShortList(order);
        if (sh.length) {
            const ok = await showConfirm(t('ord_short_title') + '\n\n' + orderStockShortLinesText(sh).join('\n'), { ok: t('ord_short_anyway'), cancel: t('common_back') });
            if (!ok) return false;
        }
    }
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data: num, error: numErr } = await db.rpc('next_order_number', { p_org_id: currentOrgId });
        if (numErr) throw numErr;
        // eq('is_confirmed', false): если заказ уже сохранили с другого устройства, повторно не перезапишем
        const { data: upd, error } = await db.from('orders')
            .update({ order_number: num, is_confirmed: true })
            .eq('id', order.id).eq('is_confirmed', false)
            .select('id, order_number');
        if (error) throw error;
        if (upd && upd.length) {
            order.order_number = upd[0].order_number;
        } else {
            const { data: fresh } = await db.from('orders').select('order_number').eq('id', order.id).single();
            if (fresh && fresh.order_number) order.order_number = fresh.order_number;
        }
        order.is_confirmed = true;
        delete order._copyDraft;
        _draftOrderIds.delete(order.id);
        if (order.id === currentOrderId) {
            const hdr = document.getElementById('detailOrderId');
            if (hdr && order.order_number) hdr.textContent = `${t('trash_order_word')} ${order.order_number}`;
            updateDetailSaveUi(order);
        }
        logActivity('order', `${t('log_order_saved')} ${order.order_number || '#' + order.id}`, order.id);
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
        return true;
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); return false; }
    finally { hideLoading(); }
}

// Кнопка "Сохранить заказ" в шапке карточки заказа — явное действие владельца: сохраняет
// даже заказ без позиций (приняли заказ по телефону, позиции внесут позже).
// Если в пекарне есть другие сотрудники, а позиций нет — переспрашиваем: им уйдёт push.
async function confirmOrderManually() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || isOrderSaved(order)) return;
    if (!order.customer_id) { showInfo(t('orders_save_need_customer')); return; }
    if ((!order.items || order.items.length === 0) && orderTeamHasOthers()) {
        const ok = await showConfirm(t('orders_save_empty_team_confirm'), { ok: t('orders_btn_save'), cancel: t('common_cancel') });
        if (!ok) return;
    }
    await saveDraftOrder(order);
}

// Мягко удаляет черновик с позициями (в корзину, склад возвращается, как при обычном удалении).
async function discardDraftOrder(order) {
    if (!(await orderDeleteGuard(order.id))) return false; // v977: черновик с оплатой тоже не удаляется
    suppressRealtimeFor3s();
    showLoading();
    try {
        await reverseInventoryForOrder(order.id);
        await updateChecked(db.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', order.id));
        const idx = orders.findIndex(o => o.id === order.id);
        if (idx !== -1) orders.splice(idx, 1);
        _draftOrderIds.delete(order.id);
        return true;
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); return false; }
    finally { hideLoading(); }
}

// Что делать с черновиком при выходе из карточки кнопкой «Назад».
// true — можно выходить, false — остаёмся в карточке.
async function resolveDraftOnLeave(order) {
    if (!order || isOrderSaved(order)) return true;
    const hasClient = !!order.customer_id;
    const hasItems = !!(order.items && order.items.length > 0);
    // Копия заказа: не сохраняем молча — спрашиваем (сохранить / удалить копию)
    if (order._copyDraft) {
        const save = await showConfirm(t('orders_copy_leave_confirm'), { ok: t('orders_btn_save'), cancel: t('orders_btn_delete') });
        if (save) return await saveDraftOrder(order);
        return await discardDraftOrder(order);
    }
    if (!hasClient && !hasItems) return true; // пустой черновик удалит cleanupOrderDraftIfEmpty
    if (hasClient && hasItems) return await saveDraftOrder(order);
    if (hasClient && !hasItems) {
        const save = await showConfirm(t('orders_leave_empty_confirm'), { ok: t('orders_btn_save'), cancel: t('orders_btn_delete') });
        if (save) {
            if (orderTeamHasOthers()) {
                const ok = await showConfirm(t('orders_save_empty_team_confirm'), { ok: t('orders_btn_save'), cancel: t('common_cancel') });
                if (!ok) return false;
            }
            return await saveDraftOrder(order);
        }
        // Удалить пустой черновик с клиентом — без позиций, склад не затронут
        _draftOrderIds.add(order.id);
        order.customer_id = null; order.customer = '';
        return true;
    }
    // позиции есть, клиента нет
    const stay = await showConfirm(t('orders_leave_no_customer_confirm'), { ok: t('orders_btn_pick_customer'), cancel: t('orders_btn_delete_draft') });
    if (stay) return false;
    return await discardDraftOrder(order);
}

async function closeOrderDetail() {
    const leavingId = currentOrderId;
    const leavingOrder = leavingId !== null ? orders.find(o => o.id === leavingId) : null;
    if (leavingOrder && !(await resolveDraftOnLeave(leavingOrder))) return;
    currentOrderId = null;
    document.getElementById('ordersList').classList.remove('hidden');
    document.getElementById('orderDetail').classList.remove('active');
    document.getElementById('ordersViewToggle')?.classList.remove('hidden');
    positionOrdersViewToggle();
    if (leavingId !== null) await cleanupOrderDraftIfEmpty(leavingId);
    displayOrders();
    refreshFab();
    // Заказ открыли из блока «Умный склад» карточки позиции — возвращаемся в карточку (inventory.js, 22.10)
    if (typeof stockCardReturnPending === 'function' && stockCardReturnPending()) await returnToStockCard();
    // Заказ открыли из просмотра документа — возвращаемся в этот просмотр (documents.js, 22.10)
    else if (typeof docsReturnPending === 'function' && docsReturnPending()) await returnToDocsPreview();
    // Заказ открыли со страницы нового раздела «Документы» — возвращаемся на эту страницу (documents2.js, 1.11)
    else if (typeof docs2ReturnPending === 'function' && docs2ReturnPending()) await returnToDocs2();
}

// Сброс детального вида заказа без повторной перерисовки списка
// (используется при переключении на ДРУГУЮ вкладку — список заказов
// перерисовывать не нужно, раз мы туда не идём).
async function closeOrderDetailSilent() {
    const leavingId = currentOrderId;
    currentOrderId = null;
    const list = document.getElementById('ordersList');
    const detail = document.getElementById('orderDetail');
    if (list) list.classList.remove('hidden');
    if (detail) detail.classList.remove('active');
    if (leavingId !== null) await cleanupOrderDraftIfEmpty(leavingId);
}


// Удаление заказа прямо из его карточки (переиспользует стандартное окно
// подтверждения — openDeleteModal/confirmDelete, как и удаление из списка).
// ==================== КОРЗИНА УДАЛЁННЫХ ЗАКАЗОВ ====================

// Корзина удалённых заказов — страница (22.10; было окно). Открывается из Настроек,
// «Назад» — обратно в Настройки по цепочке страниц. После «Восстановить» / «Удалить навсегда»
// остаёмся в корзине: список перечитывается, сверху короткая заметка.
const TRASH_KEEP_DAYS = 30;
async function openOrdersTrash() {
    closeModal();
    openAppPage('ordersTrashPage');
    _trashNote('');
    await loadOrdersTrash(true);
}

async function loadOrdersTrash(withCleanup) {
    const content = document.getElementById('ordersTrashContent');
    showLoading(t('trash_loading'));
    try {
        // Автоочистка — физически удаляем заказы старше 30 дней
        if (withCleanup) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - TRASH_KEEP_DAYS);
            // v977: стираем заказы без оплат и документов (статус не важен); остальные остаются в корзине
            try {
                const { data: old, error: oe } = await db.from('orders').select('id')
                    .not('deleted_at', 'is', null).lt('deleted_at', cutoff.toISOString())
                    .is('inv_no', null).is('dn_no', null).is('consolidated_invoice_id', null);
                if (oe) throw oe;
                let ids = (old || []).map(r => r.id);
                for (let i = 0; i < ids.length; i += 100) {
                    const part = ids.slice(i, i + 100);
                    const { data: paid, error: pe } = await db.from('order_payments').select('order_id').in('order_id', part);
                    if (pe) throw pe;
                    const paidSet = new Set((paid || []).map(r => r.order_id));
                    const free = part.filter(x => !paidSet.has(x));
                    if (free.length) await dbMust(db.from('orders').delete().in('id', free));
                }
            } catch (e) { console.error('Не удалось очистить старые заказы из корзины:', e); }
        }

        // Загружаем оставшиеся удалённые заказы
        const { data, error } = await db.from('orders')
            .select('id, customer_id, order_date, status, notes, deleted_at, order_number, inv_no, dn_no, consolidated_invoice_id, cancelled_at')
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false });
        if (error) throw error;

        if (!data || !data.length) {
            content.innerHTML = `<p class="text-xs text-gray-400 text-center py-4">${t('trash_empty')}</p>`;
            return;
        }
        // v981: заказы с оплатой или документом не стираются — вместо оставшихся дней пишем «хранится»
        const paidIds = new Set();
        for (let i = 0; i < data.length; i += 100) {
            const { data: paid, error: pe } = await db.from('order_payments').select('order_id').in('order_id', data.slice(i, i + 100).map(r => r.id));
            if (pe) throw pe;
            (paid || []).forEach(r => paidIds.add(r.order_id));
        }
        const consIds = [...new Set(data.map(r => r.consolidated_invoice_id).filter(Boolean))];
        if (consIds.length && typeof _payLoadConsNumbers === 'function') await _payLoadConsNumbers(consIds);
        const thisYear = String(new Date().getFullYear());
        const dayMs = 24 * 3600 * 1000;
        let html = `<div class="st-head trash-grid"><span>${escapeHtml(t('trash_col_date'))}</span><span>${escapeHtml(t('trash_col_num'))}</span><span>${escapeHtml(t('trash_col_customer'))}</span><span>${escapeHtml(t('trash_col_left'))}</span></div><div class="ot-island">`;
        data.forEach(o => {
            const cust = customers.find(c => c.id === o.customer_id);
            const custName = cust ? cust.name : t('trash_unknown_customer');
            const d = String(o.order_date || '');
            const dateShort = d.length >= 10 ? (d.slice(8, 10) + '.' + d.slice(5, 7) + (d.slice(0, 4) !== thisYear ? '.' + d.slice(2, 4) : '')) : '—';
            const orderDate = formatDateDMY(o.order_date || o.date);
            const orderNum = o.order_number || `#${o.id}`;
            const left = Math.max(0, Math.ceil((new Date(o.deleted_at).getTime() + TRASH_KEEP_DAYS * dayMs - Date.now()) / dayMs));
            const docs = orderDocLabels(o);
            if (o.consolidated_invoice_id) docs.push(t('order_blk_doc_cons') + ' ' + (typeof _payConsNumber === 'function' ? _payConsNumber(o.consolidated_invoice_id) : ''));
            const keptNote = docs.length ? t('trash_kept_docs').replace('{list}', docs.join(', ')) : (paidIds.has(o.id) ? t('trash_kept_pay') : '');
            const cxMark = o.cancelled_at ? t('cancel_trash_mark') : '';   // v983
            html += `<div class="st-row trash-grid" ${dataAction('openTrashOrderActions', [o.id, cxMark ? custName + ' · ' + cxMark : custName, orderDate, orderNum, keptNote])}>
                <span class="st-num">${dateShort}</span>
                <span class="st-num">${escapeHtml(orderNum)}</span>
                <span class="st-name">${escapeHtml(custName)}${cxMark ? ` <span style="color:#8b3a3a; font-size:11px;">· ${escapeHtml(cxMark)}</span>` : ''}</span>
                <span class="st-num${!keptNote && left <= 3 ? ' trash-left-warn' : ''}">${escapeHtml(keptNote ? t('trash_kept') : t('trash_days_left').replace('{n}', left))}</span>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
    } catch(e) {
        console.error(e);
        showInfo(t('orders_trash_load_error'));
    } finally {
        hideLoading();
    }
}

// Короткая заметка над списком корзины (исчезает сама)
let _trashNoteTimer = null;
function _trashNote(text) {
    const el = document.getElementById('ordersTrashNote');
    if (!el) return;
    clearTimeout(_trashNoteTimer);
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
    if (text) _trashNoteTimer = setTimeout(() => el.classList.add('hidden'), 5000);
}

function openTrashOrderActions(orderId, custName, orderDate, orderNum, keptNote) {
    const modal = document.getElementById('trashOrderActionsModal');
    const title = document.getElementById('trashOrderActionsTitle');
    const restoreBtn = document.getElementById('trashRestoreBtn');
    const deleteBtn  = document.getElementById('trashDeleteBtn');
    if (!modal) return;

    title.textContent = `${t('trash_order_word')} ${orderNum} · ${custName} · ${orderDate}`;
    const note = document.getElementById('trashKeptNote');
    if (note) { note.textContent = keptNote || ''; note.classList.toggle('hidden', !keptNote); }
    deleteBtn.classList.toggle('hidden', !!keptNote);

    // Переназначаем обработчики каждый раз (избегаем накопления listener-ов)
    restoreBtn.onclick = async () => {
        modal.style.display = 'none';
        await restoreOrder(orderId, orderNum);
    };
    deleteBtn.onclick = async () => {
        modal.style.display = 'none';
        // В вопросе — номер заказа, а не внутренний id (22.10)
        const ok = await showConfirm(`${t('trash_delete_confirm_prefix')}${orderNum}${t('trash_delete_confirm_suffix')}`);
        if (ok) await permanentDeleteOrder(orderId, orderNum);
    };

    modal.style.display = 'flex';
}

// v969: после восстановления из корзины заново списывает склад (позиции + упаковка), чтобы остатки совпали.
// Не делает ничего, если списание отложено (inventory_pending — подхватит штатный механизм) или если по заказу
// остались несторнированные «расход»-строки (значит, склад не возвращали — повторно списывать нельзя).
async function rewriteOffRestoredOrder(orderId) {
    try {
        const order = orders.find(o => o.id === orderId);
        if (!order || order.inventory_pending) return;
        const { data: rows, error } = await db.from('inventory')
            .select('id, type, ingredient_id, semi_finished_id, order_item_id')
            .eq('order_id', orderId).in('type', ['расход', 'сторно']);
        if (error) throw error;
        if (openExpenseRows(dropKeptRows(rows, await orderKeptStockIds(orderId))).length) return; // v978
        for (const it of (order.items || [])) {
            const prod = products.find(p => p.id === it.product_id);
            if (!prod) continue;
            const actualCost = await writeOffInventoryForItem(prod, it.quantity, order.id, it.id);
            if (actualCost != null && Math.abs(actualCost - (it.item_cost || 0)) > 0.0001) {
                await dbMust(db.from('order_items').update({ item_cost: actualCost }).eq('id', it.id));
                it.item_cost = actualCost;
            }
        }
        for (const m of (order.materials || [])) {
            if (!(Number(m.quantity) > 0)) continue;
            const cost = await writeOffOrderMaterialStock(order, m.ingredient_id, m.quantity);
            if (Math.abs(cost - (Number(m.cost) || 0)) > 0.0001) {
                await dbMust(db.from('order_materials').update({ cost }).eq('id', m.id));
                m.cost = cost;
            }
        }
        if (typeof loadInventory === 'function') await loadInventory();
    } catch (e) {
        console.error('Не удалось заново списать склад восстановленного заказа:', e);
        showInfo(t('trash_restore_stock_error'));
    }
}

async function restoreOrder(orderId, orderNum) {
    const num = orderNum || `#${orderId}`;
    if (!hasPermission('can_delete')) {
        closeModal();
        showInfo(t('orders_no_permission_action'));
        return;
    }
    suppressRealtimeFor3s();
    showLoading();
    try {
        await updateChecked(db.from('orders').update({ deleted_at: null }).eq('id', orderId));
        closeModal();
        await loadAllData();
        await rewriteOffRestoredOrder(orderId); // v969: если склад возвращали — списываем заново; если оставили списанным — не трогаем
        try { await cancelOrderLosses(orderId); } // v977: заказ вернулся — убираем его из потерь
        catch (e) { console.error(e); hideLoading(); await showInfo(t('trash_loss_cancel_error')); }
        logActivity('order', `${t('trash_order_word')} ${num} ${t('log_restored_from_trash')}`);
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
        hideLoading();
        if (isAppPageOpen('ordersTrashPage')) { await loadOrdersTrash(false); _trashNote(t('trash_restored_note').replace('{n}', num)); }
        else await showInfo(`${t('trash_order_word')} ${num} ${t('orders_restored')}.`);
    } catch(e) { console.error(e); showDbError(e, t('orders_restore_error')); }
    finally { hideLoading(); }
}

// ==================== СКЛАД И ПОТЕРИ ПРИ УДАЛЕНИИ ЗАКАЗА (v977) ====================
// Номер заказа для журнала. Внутренний id не показываем: он общий для всех пекарен.
function orderLogNum(order) {
    return order && order.order_number ? '№' + order.order_number : t('log_draft_mark');
}

// «Расход»-строки склада по заказу, которые ещё не сторнированы. При ошибке запроса — исключение.
async function orderOpenStockRows(orderId) {
    const { data, error } = await db.from('inventory')
        .select('id, type, ingredient_id, semi_finished_id, order_item_id')
        .eq('order_id', orderId).in('type', ['расход', 'сторно']);
    if (error) throw error;
    return openExpenseRows(dropKeptRows(data, await orderKeptStockIds(orderId))); // v978
}

// Отменяет действующие записи о потерях заказа (восстановление из корзины)
async function cancelOrderLosses(orderId) {
    await dbMust(db.from('order_losses').update({ cancelled_at: new Date().toISOString() })
        .eq('org_id', currentOrgId).eq('order_id', orderId).eq('reason', 'order_deleted').is('cancelled_at', null)); // v978: потери по позициям остаются
}

// v978: потеря по удалённой позиции/упаковке. inventory_ids — строки склада, которые больше нельзя возвращать
// (для демо-заказа сумма 0, но строки всё равно помечаются). Возвращает { id, amount }.
async function savePositionLoss(order, info) {
    const amount = order.is_demo ? 0 : Math.max(0, Math.round((Number(info.amount) || 0) * 100) / 100);
    const { data, error } = await db.from('order_losses').insert({
        org_id: currentOrgId, order_id: order.id, order_number: order.order_number || null,
        loss_date: getLocalDateStr(0), amount, reason: info.itemId ? 'item_deleted' : 'material_deleted',
        order_item_id: info.itemId || null, ingredient_id: info.ingredientId || null, item_name: info.name || null,
        inventory_ids: info.rows.map(r => r.id),
        created_by: currentEmployee ? currentEmployee.id : null
    }).select('id').single();
    if (error) throw error;
    return { id: data.id, amount };
}
async function cancelLossById(id) {
    await dbMust(db.from('order_losses').update({ cancelled_at: new Date().toISOString() }).eq('id', id));
}

// ==================== v978: ИЗМЕНЕНИЕ ЗАКАЗА С ОПЛАТОЙ ИЛИ ДОКУМЕНТОМ ====================
// Проверка по базе. При ошибке запроса — исключение.
async function orderMoneyState(orderId) {
    const [o, p] = await Promise.all([
        db.from('orders').select('inv_no, dn_no, consolidated_invoice_id').eq('id', orderId).single(),
        db.from('order_payments').select('amount').eq('order_id', orderId)
    ]);
    if (o.error || p.error || !o.data) throw (o.error || p.error || new Error('order not found'));
    const docs = [];
    if (o.data.inv_no) docs.push(t('order_blk_doc_inv').replace('{n}', String(o.data.inv_no)));
    if (o.data.dn_no) docs.push(t('order_blk_doc_dn').replace('{n}', String(o.data.dn_no)));
    const cid = o.data.consolidated_invoice_id;
    if (cid) {
        if (typeof _payLoadConsNumbers === 'function') await _payLoadConsNumbers([cid]);
        const num = typeof _payConsNumber === 'function' ? _payConsNumber(cid) : '…';
        docs.push(t('order_blk_doc_cons') + (num !== '…' ? ' ' + num : ''));
    }
    const payCount = (p.data || []).length;
    const paid = Math.round((p.data || []).reduce((s, x) => s + Number(x.amount), 0) * 100) / 100;
    return { payCount, paid, docs, locked: payCount > 0 || docs.length > 0 };
}
function orderChangeWarning(st, oldTotal, newTotal) {
    const lines = [t('chg_warn_head')];
    if (st.payCount) lines.push('• ' + t('chg_warn_paid').replace('{sum}', formatMoney(st.paid)));
    if (st.docs.length) lines.push('• ' + t('chg_warn_docs').replace('{list}', st.docs.join(', ')));
    lines.push('• ' + t('chg_warn_total').replace('{old}', formatMoney(oldTotal)).replace('{new}', formatMoney(newTotal)));
    const over = Math.round((st.paid - newTotal) * 100) / 100;
    if (st.payCount && over > 0.004) lines.push('', t('chg_warn_overpaid').replace('{sum}', formatMoney(over)));
    if (st.docs.length) lines.push('', t('chg_warn_doc_note'));
    return lines.join('\n');
}
// Перед сохранением правки: true — можно сохранять. Спрашиваем, только если меняется сумма и есть оплата/документ.
async function confirmOrderTotalChange(order, patched, modalId) {
    const oldTotal = orderGrandTotal(order), newTotal = orderGrandTotal(Object.assign({}, order, patched));
    if (Math.abs(newTotal - oldTotal) <= 0.004) return true;
    let st;
    showLoading();
    try { st = await orderMoneyState(order.id); }
    catch (e) { console.error(e); hideLoading(); await showInfo(t('error_save_check_connection')); return false; }
    hideLoading();
    if (!st.locked) return true;
    const modal = modalId ? document.getElementById(modalId) : null;
    if (modal) modal.style.display = 'none';
    const ok = await showConfirm(orderChangeWarning(st, oldTotal, newTotal), { ok: t('common_save') });
    if (!ok && modal) modal.style.display = 'flex';
    return ok;
}
// Перед удалением позиции/упаковки. null — удалять нельзя (причина показана); иначе { warn, hasStock }.
async function preparePositionDelete(order, id, type) {
    const item = type === 'item' ? order.items[id] : null;
    const mat = type === 'ordmat' ? (order.materials || []).find(m => m.ingredient_id === id) : null;
    if (!item && !mat) { delDiag('D9', type + ' ' + id); return null; }
    showLoading();
    try {
        const st = await orderMoneyState(order.id);
        if (item && st.locked && order.items.length <= 1) { hideLoading(); showInfo(t('pos_last_blocked')); return null; }
        let warn = '';
        if (st.locked) {
            const patched = item ? { items: order.items.filter(x => x !== item) } : { materials: order.materials.filter(x => x !== mat) };
            const oldTotal = orderGrandTotal(order), newTotal = orderGrandTotal(Object.assign({}, order, patched));
            if (item || Math.abs(newTotal - oldTotal) > 0.004) warn = orderChangeWarning(st, oldTotal, newTotal);
        }
        // Черновик (ещё не сохранён) и отложенное списание — вопрос о складе не задаём
        const hasStock = !!order.is_confirmed && !(item && order.inventory_pending)
            && (await positionStockRows(order.id, item ? item.id : null, item ? null : id)).length > 0;
        return { warn, hasStock };
    } catch (e) { console.error(e); hideLoading(); delDiag('D8', String((e && e.message) || e)); return null; }
    finally { hideLoading(); }
}

// Продукты остались списанными: записываем стоимость в потери. Запись переживает стирание заказа.
// Демо-заказы в потери не пишем. Возвращает сумму.
async function saveOrderLoss(order) {
    const amount = Math.round((Number(orderCost(order)) || 0) * 100) / 100;
    if (order.is_demo) return amount;
    await cancelOrderLosses(order.id); // на случай, если прошлая запись осталась действующей
    await dbMust(db.from('order_losses').insert({
        org_id: currentOrgId, order_id: order.id, order_number: order.order_number || null,
        loss_date: getLocalDateStr(0), amount, reason: 'order_deleted',
        created_by: currentEmployee ? currentEmployee.id : null
    }));
    return amount;
}

// ==================== ПРАВИЛА УДАЛЕНИЯ ЗАКАЗА (v968, изменены в v977 и v981) ====================
// Граница — оплата: заказ без записей об оплате удаляется (в корзину) в любом статусе.
// v981: счёт и накладная не мешают убрать заказ в корзину, но не дают стереть его навсегда (forever).
// Заказ из сводного счёта — сначала отменить этот счёт.
// Проверка идёт по базе, а не по памяти. null — не удалось проверить (считаем «нельзя»).
async function orderDeleteBlockers(orderId, forever) {
    try {
        const [o, p] = await Promise.all([
            db.from('orders').select('inv_no, dn_no, consolidated_invoice_id').eq('id', orderId).single(),
            db.from('order_payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
        ]);
        if (o.error || p.error || !o.data) return null;
        const r = [];
        if ((p.count || 0) > 0) r.push(t('order_blk_pay').replace('{n}', String(p.count)));
        const cid = o.data.consolidated_invoice_id;
        if (cid) {
            if (typeof _payLoadConsNumbers === 'function') await _payLoadConsNumbers([cid]);
            const num = typeof _payConsNumber === 'function' ? _payConsNumber(cid) : '…';
            r.push(t('order_blk_cons_first').replace('{n}', num));
        }
        if (forever) {
            const docs = orderDocLabels(o.data);
            if (docs.length) r.push(t('order_blk_docs').replace('{list}', docs.join(', ')));
        }
        return r;
    } catch (e) { console.error(e); return null; }
}

// Подписи выставленных документов заказа (без сводного)
function orderDocLabels(o) {
    const docs = [];
    if (o.inv_no) docs.push(t('order_blk_doc_inv').replace('{n}', String(o.inv_no)));
    if (o.dn_no) docs.push(t('order_blk_doc_dn').replace('{n}', String(o.dn_no)));
    return docs;
}

// true — удалять можно; иначе показывает причину и возвращает false
async function orderDeleteGuard(orderId, forever) {
    showLoading();
    let bl;
    try { bl = await orderDeleteBlockers(orderId, forever); } finally { hideLoading(); }
    if (bl === null) { await showInfo(t('error_save_check_connection')); return false; }
    if (bl.length) { await showInfo(t('order_del_blocked_head') + '\n\n' + bl.map(x => '• ' + x).join('\n')); return false; }
    return true;
}

async function permanentDeleteOrder(orderId, orderNum) {
    const num = orderNum || `#${orderId}`;
    if (!hasPermission('can_delete')) {
        closeModal();
        showInfo(t('ing_no_delete_permission'));
        return;
    }
    if (!(await orderDeleteGuard(orderId, true))) return; // заказ с оплатой или документом навсегда не стираем
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { error } = await db.from('orders').delete().eq('id', orderId);
        if (error) throw error;
        closeModal();
        logActivity('order', `${t('trash_order_word')} ${num} ${t('orders_deleted_forever')}`);
        hideLoading();
        if (isAppPageOpen('ordersTrashPage')) { await loadOrdersTrash(false); _trashNote(t('trash_deleted_note').replace('{n}', num)); }
        else await showInfo(`${t('trash_order_word')} ${num} ${t('orders_deleted_forever')}.`);
    } catch(e) { console.error(e); showInfo(t('error_delete_generic')); }
    finally { hideLoading(); }
}

function deleteCurrentOrder() {
    const idx = orders.findIndex(o => o.id === currentOrderId);
    if (idx === -1) return;
    const order = orders[idx];
    openDeleteModal(idx, 'order', `${t('delete_label_order_of')} «${order.customer}»`);
}

// Переход из карточки заказа в карточку его клиента (раздел "Клиенты")
// Клиент, созданный из заказа с пустым именем: после заполнения карточки привязывается к заказу
// (см. closeCustomerDetail в customers.js).
let _attachCustomerAfterCard = null;
// id клиента, выбранного точно (а не по имени) — используется saveDetailHeader вместо поиска по имени
let _pendingCustomerPickId = null;

// Привязывает клиента к открытой карточке заказа: подставляет имя, скидку и НДС клиента и сохраняет.
async function attachCustomerToOrder(cust) {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || !cust) return;
    document.getElementById('detailCustomer').value = cust.name;
    document.getElementById('detailDiscount').value = cust.discount || 0;
    document.getElementById('detailVatExempt').checked = !!cust.vat_exempt;
    _pendingCustomerPickId = cust.id;
    try { await saveDetailHeader(); } finally { _pendingCustomerPickId = null; }
}

// Верхняя строка «+ Новый клиент» в списке выбора клиента заказа.
// С введённым именем создаёт клиента сразу, без имени — открывает пустую карточку.
// Если такой клиент уже есть, предупреждает и предлагает выбрать его или изменить имя.
async function createCustomerFromOrder(typedName) {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const input = document.getElementById('detailCustomer');
    const name = String(typedName || '').replace(/\s+/g, ' ').trim();
    if (name) {
        const dup = findCustomerByName(name);
        if (dup && dup.archived_at) {   // v950: такой клиент есть в архиве — предлагаем восстановить
            const restore = await showConfirm(t('cust_archived_dup_confirm').replace('{name}', dup.name),
                { ok: t('cust_restore_btn'), cancel: t('customers_change_name') });
            if (restore) { await restoreCustomerById(dup.id); await attachCustomerToOrder(dup); }
            else if (input) { input.value = name; input.focus(); }
            return;
        }
        if (dup) {
            const useExisting = await showConfirm(
                t('customers_duplicate_confirm').replace('{name}', dup.name),
                { ok: t('customers_use_existing'), cancel: t('customers_change_name') });
            if (useExisting) await attachCustomerToOrder(dup);
            else if (input) { input.value = name; input.focus(); }
            return;
        }
    }
    suppressRealtimeFor3s();
    showLoading();
    let newCust;
    try {
        const { data, error } = await db.from('customers').insert({ org_id: currentOrgId, name, contact: '', discount: 0, vat_exempt: false, entity_type: 'individual' }).select().single();
        if (error) throw error;
        newCust = { id: data.id, name, contact: '', discount: 0, vat_exempt: false, entity_type: 'individual' };
        customers.push(newCust);
        if (!name) _draftCustomerIds.add(newCust.id);
        logActivity('customer', `${t('log_customer_draft_created')} ${name ? '«' + name + '»' : '№' + newCust.id}`);
    } catch (e) { console.error(e); showDbError(e, t('customers_create_error')); return; }
    finally { hideLoading(); }

    if (name) await attachCustomerToOrder(newCust);
    else _attachCustomerAfterCard = { orderId: order.id, custId: newCust.id };

    // Пустой черновик заказа не должен удалиться при уходе в карточку клиента
    _draftOrderIds.delete(order.id);
    _draftGuardBypass = true; try { showTab('customers'); } finally { _draftGuardBypass = false; }
    openCustomerDetail(newCust.id);
    if (!name) document.getElementById('cdSaveNewBtn')?.classList.remove('hidden'); // v972: новая карточка — «Сохранить», а не «Удалить» (как при создании из вкладки «Клиенты»)
    _customerOpenedFromOrderId = order.id;
    displayCustomers();
}

function goToCustomerFromOrder() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || !order.customer_id) { showInfo(t('orders_no_customer_specified')); return; }
    _draftGuardBypass = true; try { showTab('customers'); } finally { _draftGuardBypass = false; }
    openCustomerDetail(order.customer_id);
    // Запоминаем ПОСЛЕ openCustomerDetail — та сама сбрасывает этот флаг в начале
    // (см. customers.js), чтобы не унаследовать чужой "хвост" от прошлого перехода.
    _customerOpenedFromOrderId = order.id;
}

async function saveDetailHeader() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const customerName = document.getElementById('detailCustomer').value.trim();
    const date     = document.getElementById('detailDate').value;
    const status   = document.getElementById('detailStatus').value;
    const discount = parseFloat(document.getElementById('detailDiscount').value) || 0;
    const vatExempt = currentOrgProtected ? document.getElementById('detailVatExempt').checked : false;
    const notes = document.getElementById('detailNotes').value;
    const employeeIdRaw = document.getElementById('detailEmployee').value;
    const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;

    // Клиента переподбираем только если поле реально изменилось (а не на каждое
    // сохранение любого другого поля) — иначе правка статуса/НДС/скидки ломалась бы,
    // если по любой причине (например, пустое имя клиента в базе) поле "Клиент"
    // не совпадает 1-в-1 с текущим списком клиентов.
    let custId = order.customer_id;
    let custName = order.customer;
    if (_pendingCustomerPickId != null || customerName !== (order.customer || '')) {
        const cust = _pendingCustomerPickId != null
            ? customers.find(c => c.id === _pendingCustomerPickId)
            : customers.find(c => c.name === customerName);
        if (cust && cust.archived_at && cust.id !== order.customer_id) {   // v950: клиент в архиве — выбрать нельзя
            showInfo(t('cust_archived_pick').replace('{name}', cust.name));
            document.getElementById('detailCustomer').value = order.customer || '';
            return;
        }
        if (!cust) {
            showInfo(t('orders_customer_not_found').replace('{name}', customerName));
            document.getElementById('detailCustomer').value = order.customer || ''; // откатываем поле
            return;
        }
        custId = cust.id;
        custName = cust.name;
    }

    // Запоминаем прежние значения — на случай отката при ошибке сохранения, и для журнала
    const old = {
        customer_id: order.customer_id, customer: order.customer, date: order.date, status: order.status,
        discount: order.discount, vat_exempt: order.vat_exempt, employee_id: order.employee_id,
        employee: order.employee, notes: order.notes || '', inventory_pending: order.inventory_pending
    };

    // ── Применяем изменения сразу, не дожидаясь ответа сервера ──────────────
    const emp = employees.find(e => e.id === employeeId);
    order.customer_id = custId;
    order.customer    = custName;
    order.date        = date;
    order.status      = status;
    order.discount    = discount;
    order.vat_exempt  = vatExempt;
    order.employee_id = employeeId;
    order.employee    = emp ? emp.name : '';
    order.notes       = notes;
    renderDetailItems(order); // пересчитывает и перерисовывает итоги/скидку/НДС
    refreshDetailDue(order);   // автосрок зависит от даты заказа и клиента
    if (old.customer_id !== order.customer_id && typeof refreshOrderCreditHint === 'function') refreshOrderCreditHint();   // v949: аванс нового клиента

    try {
        await updateChecked(db.from('orders').update({
            customer_id: custId, order_date: date, status, discount, vat_exempt: vatExempt, employee_id: employeeId, notes
        }).eq('id', order.id));

        // Дата заказа могла пересечь порог отложенного списания (INVENTORY_PENDING_DAYS) —
        // если да, нужно либо списать склад прямо сейчас, либо сторнировать уже списанное.
        // Это не влияет на то, что уже видит пользователь, поэтому спокойно уходит в фон.
        if (old.date !== order.date && order.items && order.items.length) {
            const nowShould = shouldWriteOffNow(order.date);
            if (nowShould && order.inventory_pending) {
                // Дату придвинули ближе — списываем сейчас то, что раньше откладывали
                for (const it of order.items) {
                    const prod = products.find(p => p.id === it.product_id);
                    if (prod) await writeOffInventoryForItem(prod, it.quantity, order.id, it.id);
                }
                await updateChecked(db.from('orders').update({ inventory_pending: false }).eq('id', order.id));
                order.inventory_pending = false;
            } else if (!nowShould && !order.inventory_pending) {
                // Дату отодвинули далеко вперёд — сторнируем то, что уже успели списать
                await reverseInventoryForOrder(order.id);
                await updateChecked(db.from('orders').update({ inventory_pending: true }).eq('id', order.id));
                order.inventory_pending = true;
            }
        }

        // Журнал: фиксируем только реально изменившиеся поля
        const changes = [];
        if (old.customer !== order.customer) changes.push(`${t('delete_label_customer')} «${old.customer}» → «${order.customer}»`);
        if (old.date !== order.date) changes.push(`${t('history_col_date').toLowerCase()} ${formatDateDMY(old.date)} → ${formatDateDMY(order.date)}`);
        if (old.status !== order.status) changes.push(`${t('customers_col_status').toLowerCase()} «${orderStatusLabel(old.status)}» → «${orderStatusLabel(order.status)}»`);
        if (old.discount !== order.discount) changes.push(`${t('customers_discount_word').toLowerCase()} ${old.discount}% → ${order.discount}%`);
        if ((old.employee || '') !== (order.employee || '')) changes.push(`${t('orders_master').toLowerCase()} «${old.employee || '—'}» → «${order.employee || '—'}»`);
        if (old.notes !== order.notes) changes.push(t('log_comment_changed'));
        if (changes.length) logActivity('order', `${t('log_order_changed')} ${orderLogNum(order)}: ${changes.join(', ')}`, order.id);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        // ── Откат: возвращаем прежние значения и в объекте, и на самой форме ──
        Object.assign(order, old);
        document.getElementById('detailCustomer').value = old.customer || '';
        document.getElementById('detailDate').value = old.date || '';
        document.getElementById('detailDateBtnLabel').textContent = old.date ? formatDateDMY(old.date) : '—';
        document.getElementById('detailStatus').value = old.status;
        renderDetailStatusButton(old.status);
        document.getElementById('detailDiscount').value = old.discount;
        document.getElementById('detailVatExempt').checked = old.vat_exempt;
        document.getElementById('detailNotes').value = old.notes;
        document.getElementById('detailEmployee').value = old.employee_id || '';
        document.getElementById('detailEmployeeBtnLabel').textContent = old.employee || '—';
        renderDetailItems(order);
        refreshDetailDue(order);
        showInfo(t('error_save_check_connection'));
    }
}

function renderDetailItems(order) {
    if (order && order.id === currentOrderId && typeof renderDetailDocSummary === 'function') renderDetailDocSummary(order);   // v943: плашка «заказ изменён после документа»
    if (order && order.id === currentOrderId && typeof renderPayments === 'function' && _orderPaymentsFor === order.id) renderPayments();   // v945: пересчёт блока оплаты и плашка «изменён после оплаты»
    const tbody = document.getElementById('detailItemsBody');
    tbody.innerHTML = '';
    if (!order.items || !order.items.length) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" class="text-center text-xs text-gray-400 py-2">${t('orders_no_items_hint')}</td>`;
        tbody.appendChild(row);
    } else {
        order.items.forEach((item, i) => {
            const total = formatMoney(item.quantity * item.price);
            const prod = products.find(p => p.id === item.product_id);
            const unitLabel = prod && prod.unit ? unitAbbrev(prod.unit) : '';
            const row = document.createElement('tr');
            row.className = 'border-b cursor-pointer';
            row.onclick = () => openEditItemModal(i);
            row.innerHTML = `
                <td class="p-0.5 table-text">${escapeHtml(item.product)}</td>
                <td class="p-0.5 table-text text-center whitespace-nowrap">${item.quantity}${unitLabel ? ' ' + unitLabel : ''}</td>
                <td class="p-0.5 table-text text-center whitespace-nowrap">${formatMoney(item.price)}</td>
                <td class="p-0.5 table-text text-center font-medium whitespace-nowrap">${total}</td>
                <td class="p-0.5 text-center" onclick="event.stopPropagation()">
                    ${hasPermission('can_delete') ? svgDelete(`deleteItem(${i})`) : ''}
                </td>`;
            tbody.appendChild(row);
        });
    }
    renderOrderMaterials(order);
    // Итого
    const totQty    = (order.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
    const subtotal  = orderTotal(order);
    const discPct   = order.discount || 0;
    const discAmt   = orderDiscountAmount(order);
    const vatAmt    = orderVatAmount(order);
    const grand     = orderGrandTotal(order);

    document.getElementById('detailItemsCount').textContent   = totQty;
    const itemsSumEl = document.getElementById('orderItemsSummary');
    if (itemsSumEl) itemsSumEl.textContent = (order.items || []).length + ' ' + nWord((order.items || []).length, 'ordmat_item') + ' · ' + totQty + ' ' + t('unit_pcs') + '.';
    document.getElementById('detailSubtotal').textContent     = formatMoney(subtotal);
    document.getElementById('detailDiscountPct').textContent  = discPct;
    document.getElementById('detailDiscountAmount').textContent = '-' + formatMoney(discAmt);
    document.getElementById('detailVatAmount').textContent    = formatMoney(vatAmt);
    const _vatLbl = document.getElementById('detailVatLabel');
    if (_vatLbl) _vatLbl.textContent = vatWordLabel();
    // Строка НДС — только если к заказу применяется НДС (плательщик НДС и дата не раньше «с даты»); у id1 — по ставке, как раньше (v934)
    const _vatRow = document.getElementById('detailVatRow');
    if (_vatRow) _vatRow.style.display = (hasVat() && (currentOrgProtected || !orderVatExempt(order))) ? '' : 'none';
    document.getElementById('detailTotal').textContent        = formatMoney(grand);

    // Скрыть строку скидки если скидки нет
    document.getElementById('detailDiscountRow').style.display = discPct > 0 ? '' : 'none';

    // Себестоимость и прибыль (от суммы после скидки, без НДС)
    const cost   = orderCost(order);
    const profit = orderProfit(order);
    const afterDiscount = orderAfterDiscount(order);
    const profitPct = afterDiscount > 0 ? (profit / afterDiscount * 100) : 0;

    const costEl = document.getElementById('detailCost');
    const profitEl = document.getElementById('detailProfit');
    const profitPctEl = document.getElementById('detailProfitPct');
    if (costEl) costEl.textContent = formatMoney(cost);
    if (profitEl) {
        profitEl.textContent = formatMoney(profit);
        profitEl.style.color = profit >= 0 ? '#4f6349' : '#c0685c';
        profitEl.className = 'font-semibold';
    }
    if (profitPctEl) profitPctEl.textContent = profitPct.toFixed(1);
    if (typeof updateOrderStockWarn === 'function') updateOrderStockWarn();
}

let _addingItem = false; // защита от двойного срабатывания (pointerup + повторное касание)
async function addItemToOrder() {
    if (_addingItem) return;
    // Закрываем все календари/выпадающие списки — открытый невидимый слой мог перехватывать нажатия
    if (typeof closeAllCalendarPopups === 'function') closeAllCalendarPopups();
    if (typeof closeAllOrderStatusDropdowns === 'function') closeAllOrderStatusDropdowns();
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) {
        // раньше здесь был тихий выход — кнопка просто "не работала" без объяснений
        console.error('addItemToOrder: заказ не найден, currentOrderId =', currentOrderId);
        showInfo(t('error_save_check_connection'));
        return;
    }
    const productName = document.getElementById('newItemProduct').value;
    const quantity = parseFloat(document.getElementById('newItemQty').value);
    const price    = parseFloat(document.getElementById('newItemPrice').value);
    if (!productName || isNaN(quantity) || quantity <= 0 || isNaN(price)) {
        showInfo(t('orders_fill_product_qty_price')); return;
    }
    const prod = products.find(p => p.name === productName && !p.archived_at);
    if (!prod) { showInfo(t('orders_product_not_found')); return; }
    const effProd = prod;
    const itemCost = parseFloat((productUnitCost(effProd) * quantity).toFixed(4));

    _addingItem = true;
    showLoading();
    try {
        const { data, error } = await db.from('order_items').insert({
            org_id: currentOrgId,
            order_id: order.id, product_id: prod.id, quantity, price: parseFloat(price.toFixed(2)),
            item_cost: itemCost
        }).select().single();
        if (error) throw error;
        order.items.push({ id: data.id, product_id: prod.id, product: prod.name, quantity: Number(data.quantity), price: Number(data.price), item_cost: itemCost });

        // Фиксируем снимок рецепта с ценами на момент создания позиции —
        // это нужно всегда, независимо от того, спишем ли склад сейчас или позже
        // Снимок рецепта и списание склада независимы — выполняем одновременно
        const snapshotPromise = saveOrderItemIngredients(data.id, effProd, Number(data.quantity));

        if (order.inventory_pending) {
            // Заказ, отложенный до 21.10 и ещё не списанный: новую позицию не списываем
            // отдельно — processPendingInventory спишет весь заказ разом и снимет флаг
            // (иначе эта позиция списалась бы дважды).
            await snapshotPromise;
            if (typeof processPendingInventory === 'function') await processPendingInventory();
        } else if (shouldWriteOffNow(order.date)) {
            const [actualCost] = await Promise.all([
                writeOffInventoryForItem(effProd, Number(data.quantity), order.id, data.id),
                snapshotPromise
            ]);
            if (actualCost != null && Math.abs(actualCost - itemCost) > 0.0001) {
                await dbMust(db.from('order_items').update({ item_cost: actualCost }).eq('id', data.id));
                const pushedItem = order.items.find(it => it.id === data.id);
                if (pushedItem) pushedItem.item_cost = actualCost;
            }
        } else if (!order.inventory_pending) {
            await snapshotPromise;
            // Заказ далеко вперёд — списание отложено до момента, когда до него
            // останется INVENTORY_PENDING_DAYS дней (см. processPendingInventory)
            try {
                await updateChecked(db.from('orders').update({ inventory_pending: true }).eq('id', order.id));
                order.inventory_pending = true;
            } catch (e) { console.error('Не удалось отметить inventory_pending:', e); }
        }

        await snapshotPromise; // на случай ветки без ожидания выше
        renderDetailItems(order);
        logActivity('item', `${t('log_position_added')} ${t('log_to_order')} ${orderLogNum(order)}: «${prod.name}» × ${quantity}`, order.id);
        // Сбросить поля
        document.getElementById('newItemProduct').value = '';
        document.getElementById('newItemQty').value    = '';
        document.getElementById('newItemPrice').value  = '';
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    }
    finally { _addingItem = false; hideLoading(); }
}

function autoFillNewItemPrice() {
    const name = document.getElementById('newItemProduct').value;
    const p = products.find(pr => pr.name === name && !pr.archived_at);
    if (p) {
        document.getElementById('newItemPrice').value = p.price.toFixed(2);
        const qtyField = document.getElementById('newItemQty');
        if (p.unit === 'kg') qtyField.placeholder = t('orders_kg_placeholder');
        else if (p.unit === 'pcs') qtyField.placeholder = t('unit_pcs');
        else qtyField.placeholder = '1';
    }
}

function openEditItemModal(itemIdx) {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    editItemIdx = itemIdx;
    const item = order.items[itemIdx];

    // Подставить текущее значение в поле поиска изделия
    const sel = document.getElementById('editItemProduct');
    updateProductSelects();
    sel.value = item.product;
    document.getElementById('editItemQty').value   = item.quantity;
    document.getElementById('editItemPrice').value = item.price.toFixed(2);
    document.getElementById('editItemModal').style.display = 'flex';
}

function autoFillEditItemPrice() {
    const name = document.getElementById('editItemProduct').value;
    const p = products.find(pr => pr.name === name && !pr.archived_at);
    if (p) document.getElementById('editItemPrice').value = p.price.toFixed(2);
}

let _savingItemEdit = false;
async function saveItemEdit() {
    if (_savingItemEdit) return;
    _savingItemEdit = true;
    try { await _saveItemEdit(); } finally { _savingItemEdit = false; }
}
async function _saveItemEdit() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || editItemIdx === null) return;
    const productName = document.getElementById('editItemProduct').value;
    const quantity = parseFloat(document.getElementById('editItemQty').value);
    const price    = parseFloat(document.getElementById('editItemPrice').value);
    if (!productName || isNaN(quantity) || quantity <= 0 || isNaN(price)) {
        showInfo(t('common_fill_correctly')); return;
    }
    const _curItem = order.items[editItemIdx];
    // v969: изделие, уже стоящее в позиции, можно править, даже если оно позже ушло в архив
    const prod = products.find(p => p.name === productName && (!p.archived_at || (_curItem && p.id === _curItem.product_id)));
    if (!prod) { showInfo(t('orders_product_not_found')); return; }
    const idx = editItemIdx;
    const item = order.items[idx];
    const oldDesc = `«${item.product}» × ${item.quantity}`;
    // v978: заказ с оплатой или документом — предупреждаем до изменения суммы
    const patchedItems = order.items.map((x, i) => i === idx ? Object.assign({}, x, { product_id: prod.id, product: prod.name, quantity, price: parseFloat(price.toFixed(2)) }) : x);
    if (!(await confirmOrderTotalChange(order, { items: patchedItems }, 'editItemModal'))) return;
    if (editItemIdx !== idx || order.items[idx] !== item) { closeModal(); return; }
    suppressRealtimeFor3s();

    showLoading();
    try {
        // Если склад по этой позиции уже был списан — сторнируем его точно
        // (по order_item_id, независимо от того, менялся ли рецепт с тех пор),
        // и удаляем старый снимок рецепта. Если списание ещё отложено
        // (inventory_pending), сторнировать нечего — новое количество само
        // подхватится позже в processPendingInventory().
        if (!order.inventory_pending) {
            await reverseInventoryForOrderItem(item.id);
        }
        await dbMust(db.from('order_item_ingredients').delete().eq('order_item_id', item.id));

        const effProd = prod;
        const itemCost = parseFloat((productUnitCost(effProd) * quantity).toFixed(4));
        await updateChecked(db.from('order_items').update({
            product_id: prod.id, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost
        }).eq('id', item.id));
        order.items[editItemIdx] = { id: item.id, product_id: prod.id, product: prod.name, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost };

        // Новый снимок рецепта — нужен всегда, независимо от того, спишем ли склад сейчас
        const snapPromise = saveOrderItemIngredients(item.id, effProd, quantity);
        if (!order.inventory_pending) {
            const [actualCost] = await Promise.all([
                writeOffInventoryForItem(effProd, quantity, order.id, item.id),
                snapPromise
            ]);
            if (actualCost != null && Math.abs(actualCost - itemCost) > 0.0001) {
                await dbMust(db.from('order_items').update({ item_cost: actualCost }).eq('id', item.id));
                order.items[editItemIdx].item_cost = actualCost;
            }
        }
        await snapPromise;

        renderDetailItems(order);
        closeModal();
        logActivity('item', `${t('log_position_changed')} ${t('log_in_order')} ${orderLogNum(order)}: ${oldDesc} → «${prod.name}» × ${quantity}`, order.id);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// v980 (диагностика): удаление позиции/упаковки не должно останавливаться молча — показываем код причины
function delDiag(code, detail) {
    console.error('delete diag', code, detail || '');
    showInfo(t('del_diag').replace('{code}', code + (detail ? ' · ' + detail : '')));
}
function deleteItem(itemIdx) {
    try {
        const order = orders.find(o => o.id === currentOrderId);
        if (!order) { delDiag('D1', 'order ' + currentOrderId); return; }
        const item = order.items[itemIdx];
        if (!item) { delDiag('D2', itemIdx + '/' + order.items.length); return; }
        openDeleteModal(itemIdx, 'item', `${t('delete_label_position')} «${item.product}»`);
    } catch (e) { delDiag('D8', String((e && e.message) || e)); }
}

// ==================== ДЕТАЛИЗАЦИЯ СЕБЕСТОИМОСТИ ЗАКАЗА ====================
async function openOrderCostBreakdown() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    showLoading(t('orders_loading_breakdown'));
    try {
        const orderItemIds = (order.items || []).map(it => it.id);
        const ordMats = (order.materials || []).filter(m => Number(m.quantity) > 0);
        if (!orderItemIds.length && !ordMats.length) { hideLoading(); await showInfo(t('orders_no_items_in_order')); return; }

        let data = [];
        if (orderItemIds.length) {
            const res = await db
                .from('order_item_ingredients')
                .select('ingredient_name, quantity, unit, unit_price, total_cost')
                .in('order_item_id', orderItemIds);
            if (res.error) throw res.error;
            data = res.data || [];
        }

        // Объединяем одинаковые ингредиенты по всему заказу
        const merged = {}; // key = ingredient_name
        (data || []).forEach(row => {
            const key = row.ingredient_name;
            if (!merged[key]) {
                merged[key] = { name: row.ingredient_name, qty: 0, unit: row.unit, unit_price: Number(row.unit_price), total: 0 };
            }
            merged[key].qty   += Number(row.quantity);
            merged[key].total += Number(row.total_cost);
        });

        // Упаковка заказа (order_materials): фактическая стоимость списания
        ordMats.forEach(m => {
            const ing = ingredients.find(x => x.id === m.ingredient_id);
            const q = Number(m.quantity), c = Number(m.cost) || 0;
            const key = '\u0000mat' + m.ingredient_id;
            merged[key] = { name: ing ? ing.name : '', qty: q, unit: ing ? ing.unit : '', unit_price: q > 0 ? c / q : 0, total: c };
        });
        const rows = Object.values(merged).sort((a, b) => b.total - a.total);
        const matsCost = ordMats.reduce((s, m) => s + (Number(m.cost) || 0), 0);
        const grandCost = (order.items || []).reduce((s, it) => s + (it.item_cost != null ? Number(it.item_cost) : 0), 0) + matsCost;
        const grandIngCost = rows.reduce((s, r) => s + r.total, 0);

        if (!rows.length) {
            hideLoading();
            await showInfo(t('orders_breakdown_unavailable'));
            return;
        }

        let html = '<table class="w-full stats-table table-clean" style="table-layout:fixed;">';
        html += '<thead><tr style="background-color:#e3e8df;"><th class="p-1 text-xs text-left" style="width:40%;">' + t('inv_col_ingredient') + '</th><th class="p-1 text-xs text-right" style="width:20%;">' + t('inv_col_quantity') + '</th><th class="p-1 text-xs text-right" style="width:20%;">' + t('orders_price_per_unit_short') + '</th><th class="p-1 text-xs text-right" style="width:20%;">' + t('stats_col_sum') + '</th></tr></thead><tbody>';
        rows.forEach(r => {
            const unitLabel = unitAbbrev(r.unit);
            html += `<tr class="border-b">
                <td class="p-0.5 table-text" style="word-break:break-word;">${escapeHtml(r.name)}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${r.qty.toFixed(2)} ${unitLabel}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${formatMoney(r.unit_price, 4)}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${formatMoney(r.total, 4)}</td>
            </tr>`;
        });
        html += `</tbody><tfoot><tr style="background-color:#e3e8df;" class="font-semibold">
            <td class="p-0.5 table-text" colspan="3">${t('orders_total_cost_price')}</td>
            <td class="p-0.5 table-text text-right">${grandCost > 0 ? formatMoney(grandCost) : formatMoney(grandIngCost)}</td>
        </tr></tfoot></table>`;

        document.getElementById('orderCostBreakdownSubtitle').textContent =
            `${t('trash_order_word')} ${order.order_number || '#'+order.id} · ${formatDateDMY(order.date)} · ${order.customer || t('orders_no_customer')}`;
        const content = document.getElementById('orderCostBreakdownContent');
        content.innerHTML = html;
        content.style.cssText = 'max-height:60vh; overflow-y:auto; touch-action:pan-y; overscroll-behavior:contain;';
        // Запрет pan-x для таблицы внутри (иначе глобальное правило блокирует вертикальный скролл)
        const table = content.querySelector('table');
        if (table) table.style.touchAction = 'pan-y';

        document.getElementById('orderCostBreakdownModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        await showInfo(t('orders_breakdown_load_error'));
    } finally { hideLoading(); }
}

// Рекурсивно собирает список ингредиентов изделия (раскрывая полуфабрикаты).
// qty_factor — множитель из родительского рецепта (с учётом размера партии п/ф).
function collectIngredients(recipeItems, itemQty, qtyFactor, result) {
    recipeItems.forEach(ri => {
        if (ri.semi_finished_id) {
            // Полуфабрикат — раскрываем рекурсивно
            const sf = semiFinished.find(s => s.id === ri.semi_finished_id);
            if (!sf || !sf.ingredients || !sf.ingredients.length) return;
            // Сколько единиц п/ф используется на партию изделия
            const sfUnitsUsed = Number(ri.quantity) * itemQty * qtyFactor;
            // Масштаб: ri.quantity / sf.batch_size (сколько партий п/ф нужно)
            const sfFactor = Number(ri.quantity) / Number(sf.batch_size || 1);
            collectIngredients(sf.ingredients, itemQty, qtyFactor * sfFactor, result);
        } else if (ri.ingredient_id) {
            // Прямой ингредиент
            const ing = ingredients.find(i => i.id === ri.ingredient_id);
            if (!ing) return;
            const unitPrice = ing.package_size ? ing.package_price / ing.package_size : 0;
            const totalQty  = Number(ri.quantity) * itemQty * qtyFactor;
            // Если ингредиент уже есть (через другой п/ф) — суммируем
            const existing = result.find(r => r.ingredient_id === ing.id);
            if (existing) {
                existing.quantity   += totalQty;
                existing.total_cost += unitPrice * totalQty;
            } else {
                result.push({
                    ingredient_id:    ing.id,
                    ingredient_name:  ing.name,
                    quantity:         totalQty,
                    unit:             ing.unit,
                    unit_price:       parseFloat(unitPrice.toFixed(6)),
                    total_cost:       parseFloat((unitPrice * totalQty).toFixed(4))
                });
            }
        }
    });
}

// ==================== МАТЕРИАЛЫ ЗАКАЗА (v917, упрощено в v921) ====================
// Материалы (упаковка со склада) добавляются ТОЛЬКО в заказ (order_materials): количество на весь
// заказ, списание со склада без привязки к позиции. Цена подставляется из ingredients.sale_price и
// её можно изменить: цена > 0 — строка идёт в счёт и выручку (orderBillItems), цена 0 — материал
// списывается и входит в себестоимость заказа, но клиенту не выставляется.

let _orderMatOpenFor = null; // заказ, у которого блок «Упаковка» раскрыт (v935: по умолчанию свёрнут)
function toggleOrderMatBlock() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    _orderMatOpenFor = (_orderMatOpenFor === order.id) ? null : order.id;
    renderOrderMaterials(order);
}

// Подставить цену продажи выбранного материала в строку ввода
function _ordMatPrefillPrice() {
    const inp = document.getElementById('newOrdMat');
    const pr = document.getElementById('newOrdMatPrice');
    if (!inp || !pr) return;
    const ing = activeMaterials().find(x => x.name === inp.value.trim());
    if (ing) pr.value = Number(ing.sale_price) > 0 ? ing.sale_price : '';
}

function renderOrderMaterials(order) {
    const wrap = document.getElementById('orderMatWrap');
    const panel = document.getElementById('orderMatPanel');
    const body = document.getElementById('orderMatBody');
    if (!wrap || !panel || !body) return;
    const rows = (order.materials || []).slice().sort((x, y) => {
        const ix = ingredients.find(i => i.id === x.ingredient_id), iy = ingredients.find(i => i.id === y.ingredient_id);
        return ((ix && ix.name) || '').localeCompare((iy && iy.name) || '');
    });
    const open = _orderMatOpenFor === order.id;
    wrap.classList.remove('hidden');
    panel.classList.toggle('hidden', !open);
    const chev = document.getElementById('orderMatChev');
    if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
    const sumEl = document.getElementById('orderMatSummary');
    if (sumEl) {
        const billed = rows.reduce((s, m) => s + (Number(m.price) > 0 ? Number(m.quantity || 0) * Number(m.price) : 0), 0);
        sumEl.textContent = rows.length === 0 ? t('ordmat_sum_none')
            : rows.length + ' ' + nWord(rows.length, 'ordmat_item') + (billed > 0 ? ' · ' + formatMoney(billed) : '');
    }
    body.innerHTML = '';
    const qEl = document.getElementById('newOrdMatQty');
    if (qEl && (qEl.value === '0' || qEl.value === '0.00')) qEl.value = ''; // чтобы был виден серый «1»
    const fmt = q => String(Math.round(Number(q) * 100) / 100);
    rows.forEach(m => {
        const ing = ingredients.find(x => x.id === m.ingredient_id);
        const tr = document.createElement('tr');
        tr.className = 'border-b';
        tr.style.cursor = 'pointer';
        tr.onclick = () => openEditOrderMatModal(m.ingredient_id);
        const gr = Number(m.price) > 0 ? '' : ' style="color:#9a978c;"'; // цена 0 — в счёт не выставляется
        tr.innerHTML = `
            <td class="p-0.5 table-text"${gr}>${escapeHtml(ing ? ing.name : '')}</td>
            <td class="p-0.5 table-text text-center whitespace-nowrap"${gr}>${fmt(m.quantity)} ${escapeHtml(ing ? unitAbbrev(ing.unit) : '')}</td>
            <td class="p-0.5 table-text text-center whitespace-nowrap"${gr}>${Number(m.price) > 0 ? formatMoney(m.price) : '0'}</td>
            <td class="p-0.5 table-text text-center font-medium whitespace-nowrap"${gr}>${Number(m.price) > 0 ? formatMoney(Math.round(Number(m.quantity || 0) * Number(m.price) * 100) / 100) : '0'}</td>
            <td class="p-0.5 text-center" onclick="event.stopPropagation()">${hasPermission('can_delete') ? svgDelete(`deleteOrderMat(${m.ingredient_id})`) : ''}</td>`;
        body.appendChild(tr);
    });
    // Выбор: только материалы со склада; при выборе подставляется цена продажи
    setupSearchDropdown('newOrdMat', 'newOrdMatDropdown', () =>
        activeMaterials().map(m => m.name).sort((x, y) => x.localeCompare(y)));
    const nm = document.getElementById('newOrdMat');
    if (nm) { nm.oninput = _ordMatPrefillPrice; nm.onchange = _ordMatPrefillPrice; nm.onblur = () => setTimeout(_ordMatPrefillPrice, 150); }
}

// Записать количество и цену материала в заказе: вернуть прежнее списание и списать новое.
// price: число (0 — в счёт не выставляется); undefined — не менять.
async function _setOrderMaterialQty(order, ingredientId, newQty, price) {
    if (!order.materials) order.materials = [];
    const cur = order.materials.find(m => m.ingredient_id === ingredientId);
    if (cur) await reverseOrderMaterialStock(order, ingredientId);
    if (!(newQty > 0)) {
        if (cur) {
            await dbMust(db.from('order_materials').delete().eq('id', cur.id));
            order.materials = order.materials.filter(m => m !== cur);
        }
        return;
    }
    const cost = await writeOffOrderMaterialStock(order, ingredientId, newQty);
    if (cur) {
        const upd = { quantity: newQty, cost };
        if (price !== undefined) upd.price = price;
        await dbMust(db.from('order_materials').update(upd).eq('id', cur.id));
        cur.quantity = newQty; cur.cost = cost;
        if (price !== undefined) cur.price = price;
    } else {
        const p0 = price !== undefined ? price : 0;
        const { data, error } = await db.from('order_materials')
            .insert({ org_id: currentOrgId, order_id: order.id, ingredient_id: ingredientId, quantity: newQty, cost, price: p0 })
            .select().single();
        if (error) throw error;
        order.materials.push({ id: data.id, ingredient_id: ingredientId, quantity: newQty, cost, price: p0 });
    }
}

async function addOrderMaterial() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const name = document.getElementById('newOrdMat').value.trim();
    const qty = parseFloat(document.getElementById('newOrdMatQty').value);
    const ing = activeMaterials().find(x => x.name === name);
    if (!ing || !(qty > 0)) { showInfo(t('ordmat_choose_and_qty')); return; }
    // Пусто — цена продажи со склада (если не задана — 0); можно ввести свою, в том числе 0
    const priceRaw = parseFloat(document.getElementById('newOrdMatPrice').value);
    const price = priceRaw >= 0 ? parseFloat(priceRaw.toFixed(2)) : (Number(ing.sale_price) > 0 ? Number(ing.sale_price) : 0);
    const cur = (order.materials || []).find(m => m.ingredient_id === ing.id);
    suppressRealtimeFor3s();
    showLoading();
    try {
        await _setOrderMaterialQty(order, ing.id, (cur ? Number(cur.quantity) : 0) + qty, price);
        document.getElementById('newOrdMat').value = '';
        document.getElementById('newOrdMatQty').value = '';
        document.getElementById('newOrdMatPrice').value = '';
        renderOrderMaterials(order);
        renderDetailItems(order);
        logActivity('item', `${t('ordmat_log_added')} ${orderLogNum(order)}: «${ing.name}» × ${qty}`, order.id);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); renderOrderMaterials(order); }
    finally { hideLoading(); }
}

let _editOrdMatId = null;
function openEditOrderMatModal(ingId) {
    const order = orders.find(o => o.id === currentOrderId);
    const m = order && (order.materials || []).find(x => x.ingredient_id === ingId);
    const ing = ingredients.find(x => x.id === ingId);
    if (!m || !ing) return;
    _editOrdMatId = ingId;
    document.getElementById('editOrdMatName').textContent = ing.name;
    document.getElementById('editOrdMatUnit').textContent = unitAbbrev(ing.unit);
    document.getElementById('editOrdMatQty').value = Math.round(Number(m.quantity) * 1e4) / 1e4;
    document.getElementById('editOrdMatPrice').value = Number(m.price) > 0 ? m.price : '';
    document.getElementById('editOrdMatModal').style.display = 'flex';
}
async function saveOrderMatEdit() {
    const order = orders.find(o => o.id === currentOrderId);
    const ingId = _editOrdMatId;
    const m = order && ingId !== null ? (order.materials || []).find(x => x.ingredient_id === ingId) : null;
    const qty = parseFloat(document.getElementById('editOrdMatQty').value);
    if (!m) { closeModal(); return; }
    if (!(qty > 0)) { showInfo(t('common_fill_correctly')); return; }
    const priceRaw = parseFloat(document.getElementById('editOrdMatPrice').value);
    const newPrice = priceRaw > 0 ? parseFloat(priceRaw.toFixed(2)) : 0; // пусто = 0
    closeModal();
    const qtyChanged = Math.abs(qty - Number(m.quantity)) >= 1e-9;
    const priceChanged = newPrice !== (Number(m.price) > 0 ? Number(m.price) : 0);
    if (!qtyChanged && !priceChanged) return; // не менялось
    const patchedMats = order.materials.map(x => x === m ? Object.assign({}, x, { quantity: qty, price: newPrice }) : x);
    if (!(await confirmOrderTotalChange(order, { materials: patchedMats }, null))) return; // v978
    suppressRealtimeFor3s();
    showLoading();
    try {
        if (!qtyChanged) {
            // Меняется только цена: склад не трогаем
            await updateChecked(db.from('order_materials').update({ price: newPrice }).eq('id', m.id));
            m.price = newPrice;
        } else {
            await _setOrderMaterialQty(order, ingId, qty, newPrice);
        }
        renderOrderMaterials(order);
        renderDetailItems(order);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); renderOrderMaterials(order); }
    finally { hideLoading(); }
}
function deleteOrderMat(ingId) {
    const ing = ingredients.find(x => x.id === ingId);
    if (!ing) { delDiag('D12', 'ing ' + ingId); return; }
    openDeleteModal(ingId, 'ordmat', `«${ing.name}»`);
}
async function removeOrderMaterial(order, ingId) {
    suppressRealtimeFor3s();
    await _setOrderMaterialQty(order, ingId, 0);
    renderOrderMaterials(order);
    renderDetailItems(order);
}

// Сохраняет снимок рецепта изделия с текущими ценами ингредиентов
// для конкретной позиции заказа — используется при создании позиции.
// Полуфабрикаты раскрываются рекурсивно до уровня прямых ингредиентов.
async function saveOrderItemIngredients(orderItemId, prod, itemQty) {
    if (!prod || !prod.ingredients || !prod.ingredients.length) return;
    const result = [];
    // qtyFactor = 1 / batch_size изделия (чтобы пересчитать с партии на штуку)
    const qtyFactor = 1 / Number(prod.batch_size || 1);
    collectIngredients(prod.ingredients, itemQty, qtyFactor, result);

    if (!result.length) return;
    const rows = result.map(r => ({
        order_item_id:    orderItemId,
        ingredient_id:    r.ingredient_id,
        ingredient_name:  r.ingredient_name,
        quantity:         parseFloat(r.quantity.toFixed(4)),
        unit:             r.unit,
        unit_price:       r.unit_price,
        total_cost:       parseFloat(r.total_cost.toFixed(4)),
        org_id:           currentOrgId
    }));
    try {
        await dbMust(db.from('order_item_ingredients').insert(rows));
    } catch (e) { console.error('Не удалось сохранить снимок рецепта:', e); showInfo(t('error_save_generic')); }
}

// Пересчитывает снимок рецепта для текущего заказа по актуальному рецепту и ценам.
async function recalcOrderCostBreakdown() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const ok = await showConfirm(t('orders_recalc_confirm'));
    if (!ok) return;

    showLoading(t('orders_recalculating'));
    try {
        const orderItemIds = (order.items || []).map(it => it.id);

        // Удаляем старый снимок
        const { error: delErr } = await db
            .from('order_item_ingredients').delete().in('order_item_id', orderItemIds);
        if (delErr) throw delErr;

        // Сохраняем новый снимок по актуальному рецепту и текущим ценам
        for (const item of order.items) {
            const prod = products.find(p => p.id === item.product_id);
            if (prod) await saveOrderItemIngredients(item.id, prod, item.quantity);
        }

        // Также пересчитываем item_cost
        for (const item of order.items) {
            const prod = products.find(p => p.id === item.product_id);
            if (prod) {
                const newCost = parseFloat((productUnitCost(prod) * item.quantity).toFixed(4));
                try {
                    await updateChecked(db.from('order_items').update({ item_cost: newCost }).eq('id', item.id));
                    item.item_cost = newCost;
                } catch (e) { console.error('Не удалось обновить item_cost:', e); }
            }
        }

        renderDetailItems(order);
        hideLoading();
        await openOrderCostBreakdown(); // перезагружаем детализацию
        logActivity('order', `${t('log_cost_recalculated')} ${orderLogNum(order)} ${t('log_by_current_recipe')}`);
    } catch (e) {
        console.error(e);
        hideLoading();
        await showInfo(t('orders_recalc_error'));
    }
}


// ==================== ОТМЕНА ЗАКАЗА (v983, часть 2) ====================
// Отменённые заказы лежат ОТДЕЛЬНО, в cancelledOrders: так они сами не попадают в текущие заказы, долги,
// производство, склад и статистику (всё это считает по массиву orders). Саму отмену делает функция базы
// rpc_cancel_order — деньги, склад, потери и отметка пишутся одной транзакцией.

function findCancelledOrder(id) { return (typeof cancelledOrders !== 'undefined' ? cancelledOrders : []).find(o => o.id === id) || null; }
function findAnyOrder(id) { return (typeof orders !== 'undefined' ? orders : []).find(o => o.id === id) || findCancelledOrder(id); }
// Для проверок «есть ли у клиента/сотрудника/изделия следы»: действующие вместе с отменёнными
function ordersWithCancelled() { return (typeof orders !== 'undefined' ? orders : []).concat(typeof cancelledOrders !== 'undefined' ? cancelledOrders : []); }

function canShowCancelButton(order) {
    return !!order && hasPermission('can_delete') && isOrderSaved(order);
}

const _cents = v => Math.round((Number(v) || 0) * 100);

// Состояние заказа по базе: оплаты, документы, списанный склад. При ошибке запроса — исключение.
async function cancelOrderState(order) {
    const [o, snap, p] = await Promise.all([
        db.from('orders').select('inv_no, dn_no, consolidated_invoice_id').eq('id', order.id).single(),
        db.from('orders').select('id', { count: 'exact', head: true }).eq('id', order.id).or('invoice_snapshot.not.is.null,delivery_note_snapshot.not.is.null'),
        db.from('order_payments').select('amount').eq('order_id', order.id)
    ]);
    if (o.error || snap.error || p.error || !o.data) throw (o.error || snap.error || p.error || new Error('order not found'));
    const docs = orderDocLabels(o.data);
    if (!docs.length && (snap.count || 0) > 0) docs.push(t('cancel_doc_generic'));
    let cons = null;
    const cid = o.data.consolidated_invoice_id;
    if (cid) {
        if (typeof _payLoadConsNumbers === 'function') await _payLoadConsNumbers([cid]);
        cons = typeof _payConsNumber === 'function' ? _payConsNumber(cid) : '…';
    }
    const paidC = (p.data || []).reduce((s, x) => s + _cents(x.amount), 0);
    const hasStock = (await orderOpenStockRows(order.id)).length > 0;
    // v984: документы не мешают отмене, но о них предупреждаем. Снимок без номера считаем счётом (осторожный вариант).
    const hasDn = !!o.data.dn_no;
    const hasInv = !!o.data.inv_no || (!hasDn && (snap.count || 0) > 0);
    const warns = [];
    if (hasInv) warns.push({ kind: 'inv', label: o.data.inv_no ? t('order_blk_doc_inv').replace('{n}', String(o.data.inv_no)) : t('cancel_doc_generic') });
    if (hasDn) warns.push({ kind: 'dn', label: t('order_blk_doc_dn').replace('{n}', String(o.data.dn_no)) });
    return { docs, cons, warns, hasInv, totalC: _cents(orderGrandTotal(order)), paidC, payCount: (p.data || []).length, hasStock };
}

// Причина, по которой отменять нельзя (null — можно)
function cancelBlockReason(st) {
    if (st.cons !== null) return t('cancel_blk_cons').replace('{n}', st.cons === '…' ? '' : st.cons);
    // v984: в защищённой пекарне (работает банк) заказ с не полностью оплаченным счётом не отменяем — правило приложения
    if (currentOrgProtected && st.hasInv && st.paidC < st.totalC) return t('cancel_blk_unpaid_inv');
    if (st.paidC < 0) return t('cancel_blk_negative');
    return null;
}

let _cancelSt = null;

async function openCancelOrder() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    if (!hasPermission('can_delete')) { showInfo(t('orders_no_permission_action')); return; }
    if (!canShowCancelButton(order)) return;
    showLoading();
    let st;
    try { st = await cancelOrderState(order); }
    catch (e) { console.error(e); hideLoading(); await showInfo(t('error_save_check_connection')); return; }
    hideLoading();
    const reason = cancelBlockReason(st);
    if (reason) { await showInfo(reason); return; }
    _cancelSt = { orderId: order.id, warns: st.warns, paidC: st.paidC, hasStock: st.hasStock, mode: null, split: false, stock: null, method: '', parts: { refund: '', credit: '', retain: '' }, busy: false };
    renderCancelModal();
    document.getElementById('cancelOrderModal').style.display = 'flex';
}

function closeCancelOrder() {
    document.getElementById('cancelOrderModal').style.display = 'none';
    _cancelSt = null;
}

function _cancelOptHtml(selected, onclick, title, hint, disabled) {
    return `<button type="button" class="cancel-opt${selected ? ' selected' : ''}"${disabled ? ' disabled' : ` onclick="${onclick}"`}>
        <b>${escapeHtml(title)}</b>${hint ? `<span>${escapeHtml(hint)}</span>` : ''}</button>`;
}

function renderCancelModal() {
    const s = _cancelSt;
    const order = s && orders.find(o => o.id === s.orderId);
    if (!order) return;
    document.getElementById('cancelOrderTitle').textContent = t('cancel_title').replace('{num}', orderNumLabel(order));
    let html = `<div class="cancel-sub">${escapeHtml(order.customer || t('orders_no_customer'))} · ${escapeHtml(formatDateDMY(order.date))} · ${escapeHtml(formatMoney(orderGrandTotal(order)))}</div>`;
    html += s.warns.map(w => `<div class="cancel-warn">${escapeHtml(_cancelWarnText(w, 'cancel_warn_'))}</div>`).join('');
    if (s.paidC > 0) {
        const noCust = !order.customer_id;
        html += `<div class="cancel-q">${escapeHtml(t('cancel_money_q').replace('{sum}', formatMoney(s.paidC / 100)))}</div>`;
        if (!s.split) {
            html += _cancelOptHtml(s.mode === 'refund', "cancelPickMoney('refund')", t('cancel_opt_refund'), t('cancel_opt_refund_hint'))
                + _cancelOptHtml(s.mode === 'credit', "cancelPickMoney('credit')", t('cancel_opt_credit'), t(noCust ? 'cancel_opt_credit_nocust' : 'cancel_opt_credit_hint'), noCust)
                + _cancelOptHtml(s.mode === 'retain', "cancelPickMoney('retain')", t('cancel_opt_retain'), t('cancel_opt_retain_hint'));
        } else {
            const row = (key, label, disabled) => `<label class="cancel-part"><span>${escapeHtml(label)}</span><input type="text" inputmode="decimal" value="${escapeHtml(s.parts[key])}" ${disabled ? 'disabled' : ''} oninput="cancelPartInput('${key}', this.value)"></label>`;
            html += row('refund', t('cancel_opt_refund')) + row('credit', t('cancel_opt_credit'), noCust) + row('retain', t('cancel_opt_retain'))
                + (noCust ? `<div class="cancel-note">${escapeHtml(t('cancel_opt_credit_nocust'))}</div>` : '')
                + '<div id="cancelRest" class="cancel-rest"></div>';
        }
        html += `<button type="button" class="cancel-link" onclick="cancelToggleSplit()">${escapeHtml(t(s.split ? 'cancel_unsplit_btn' : 'cancel_split_btn'))}</button>`;
        const opt = (v, k) => `<option value="${v}"${s.method === v ? ' selected' : ''}>${escapeHtml(t(k))}</option>`;
        html += `<div id="cancelMethodWrap" class="hidden"><div class="cancel-note">${escapeHtml(t('cancel_method_label'))}</div>
            <select onchange="_cancelSt.method = this.value" class="cancel-select">${opt('', 'cancel_method_choose')}${opt('наличные', 'orders_method_cash')}${opt('карта', 'orders_method_card')}${opt('перевод', 'orders_method_transfer')}</select></div>`;
    } else {
        html += `<div class="cancel-note">${escapeHtml(t('cancel_no_money'))}</div>`;
    }
    if (s.hasStock) {
        html += `<div class="cancel-q">${escapeHtml(t('cancel_stock_q'))}</div>`
            + _cancelOptHtml(s.stock === 'return', "cancelPickStock('return')", t('cancel_stock_return'), t('cancel_stock_return_hint'))
            + _cancelOptHtml(s.stock === 'keep', "cancelPickStock('keep')", t('cancel_stock_keep'), t('cancel_stock_keep_hint'));
    }
    document.getElementById('cancelOrderBody').innerHTML = html;
    cancelError('');
    cancelUpdateDynamic();
}

function _cancelWarnText(w, prefix) {
    const s = t(prefix + w.kind).replace('{doc}', w.label);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function cancelError(text) {
    const el = document.getElementById('cancelOrderError');
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
}
function cancelPickMoney(mode) { if (_cancelSt) { _cancelSt.mode = mode; renderCancelModal(); } }
function cancelPickStock(v) { if (_cancelSt) { _cancelSt.stock = v; renderCancelModal(); } }
function cancelToggleSplit() {
    const s = _cancelSt;
    if (!s) return;
    s.split = !s.split;
    s.mode = null;
    s.parts = { refund: '', credit: '', retain: '' };
    renderCancelModal();
}
// Сумма из поля: пусто → 0; не число, минус или доли цента → null
function _cancelParse(v) {
    const str = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.');
    if (!str) return 0;
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(str)) return null;
    return _cents(str);
}
// Как распределены деньги, в центах: { refund, credit, retain }; null — в поле ошибка
function _cancelAmounts() {
    const s = _cancelSt;
    if (s.split) {
        const a = { refund: _cancelParse(s.parts.refund), credit: _cancelParse(s.parts.credit), retain: _cancelParse(s.parts.retain) };
        return (a.refund === null || a.credit === null || a.retain === null) ? null : a;
    }
    return { refund: s.mode === 'refund' ? s.paidC : 0, credit: s.mode === 'credit' ? s.paidC : 0, retain: s.mode === 'retain' ? s.paidC : 0 };
}
function cancelPartInput(key, value) { if (_cancelSt) { _cancelSt.parts[key] = value; cancelError(''); cancelUpdateDynamic(); } }
function cancelUpdateDynamic() {
    const s = _cancelSt;
    if (!s || !(s.paidC > 0)) return;
    const a = _cancelAmounts();
    const rest = document.getElementById('cancelRest');
    if (rest) {
        const left = a ? s.paidC - a.refund - a.credit - a.retain : null;
        rest.textContent = a ? t(left < 0 ? 'cancel_rest_over' : 'cancel_rest').replace('{sum}', formatMoney(Math.abs(left) / 100)) : t('cancel_err_amount');
        rest.classList.toggle('bad', left !== 0);
    }
    document.getElementById('cancelMethodWrap')?.classList.toggle('hidden', !(a && a.refund > 0));
}

function _cancelMethodLabel(m) {
    const map = { 'наличные': 'orders_method_cash', 'карта': 'orders_method_card', 'перевод': 'orders_method_transfer', cash: 'orders_method_cash', card: 'orders_method_card', transfer: 'orders_method_transfer', 'аванс': 'cancel_method_credit' };
    return map[m] ? t(map[m]) : (m || '');
}

// «Далее»: проверка выбора → итоговое окно → отмена
async function cancelOrderNext() {
    const s = _cancelSt;
    const order = s && orders.find(o => o.id === s.orderId);
    if (!order || s.busy) return;
    let a = { refund: 0, credit: 0, retain: 0 };
    if (s.paidC > 0) {
        if (!s.split && !s.mode) { cancelError(t('cancel_err_choose_money')); return; }
        a = _cancelAmounts();
        if (!a) { cancelError(t('cancel_err_amount')); return; }
        if (a.refund + a.credit + a.retain !== s.paidC) { cancelError(t('cancel_err_sum').replace('{sum}', formatMoney(s.paidC / 100))); return; }
        if (a.credit > 0 && !order.customer_id) { cancelError(t('cancel_opt_credit_nocust')); return; }
        if (a.refund > 0 && !s.method) { cancelError(t('cancel_err_method')); return; }
    }
    if (s.hasStock && !s.stock) { cancelError(t('cancel_err_choose_stock')); return; }

    const lossAmount = s.hasStock && s.stock === 'keep' && !order.is_demo ? Math.round((Number(orderCost(order)) || 0) * 100) / 100 : 0;
    const lines = [t('cancel_sum_head').replace('{num}', orderNumLabel(order)).replace('{cust}', order.customer || t('orders_no_customer')), ''];
    if (a.refund > 0) lines.push('• ' + t('cancel_sum_refund').replace('{sum}', formatMoney(a.refund / 100)).replace('{method}', _cancelMethodLabel(s.method).toLowerCase()));
    if (a.credit > 0) lines.push('• ' + t('cancel_sum_credit').replace('{sum}', formatMoney(a.credit / 100)));
    if (a.retain > 0) lines.push('• ' + t('cancel_sum_retain').replace('{sum}', formatMoney(a.retain / 100)));
    if (!(s.paidC > 0)) lines.push('• ' + t('cancel_no_money'));
    if (s.hasStock) lines.push('• ' + t(s.stock === 'return' ? 'cancel_sum_stock_return' : 'cancel_sum_stock_keep'));
    if (s.warns.length) { lines.push(''); s.warns.forEach(w => lines.push('⚠ ' + _cancelWarnText(w, 'cancel_sum_'))); }
    lines.push('', t('cancel_sum_final'));
    if (currentOrgPlan === 'free' && order.is_confirmed && !order.is_demo) lines.push('', t('cancel_sum_quota'));

    const modal = document.getElementById('cancelOrderModal');
    modal.style.display = 'none';
    const ok = await showConfirm(lines.join('\n'), { ok: t('cancel_btn'), cancel: t('common_back') });
    if (!ok) { if (_cancelSt === s) modal.style.display = 'flex'; return; }
    s.busy = true;
    await runCancelOrder(s, a, lossAmount);
}

async function runCancelOrder(s, a, lossAmount) {
    const order = orders.find(o => o.id === s.orderId);
    if (!order) { _cancelSt = null; return; }
    if (!hasPermission('can_delete')) { _cancelSt = null; showInfo(t('orders_no_permission_action')); return; }
    showLoading();
    let res;
    try {
        // Перепроверка перед самой отменой: пока окно было открыто, могли выставить документ или внести оплату.
        // Правило про неоплаченный счёт в защищённой пекарне действует только здесь, в приложении.
        const st = await cancelOrderState(order);
        const reason = cancelBlockReason(st);
        if (reason || st.paidC !== s.paidC || st.hasStock !== s.hasStock || JSON.stringify(st.warns) !== JSON.stringify(s.warns)) {
            _cancelSt = null; hideLoading();
            await showInfo(reason || t('cancel_err_changed'));
            return;
        }
        suppressRealtimeFor3s();
        const { data, error } = await db.rpc('rpc_cancel_order', {
            p_org_id: currentOrgId,
            p_order_id: order.id,
            p_date: getLocalDateStr(0),
            p_employee_id: currentEmployee ? currentEmployee.id : null,
            p_refund: a.refund / 100,
            p_refund_method: a.refund > 0 ? s.method : null,
            p_to_credit: a.credit / 100,
            p_retain: a.retain / 100,
            p_stock: s.hasStock ? s.stock : null,
            p_loss_amount: lossAmount,
            p_snapshot: _payOrderSnap(order)
        });
        if (error) throw error;
        res = data || {};
    } catch (e) {
        console.error(e);
        _cancelSt = null;
        await loadAllData(true); // ответ мог потеряться уже после отмены — берём правду из базы
        hideLoading();
        const m = String((e && e.message) || '');
        if (m.includes('CANCEL_ACCESS_DENIED') || m.includes('CANCEL_BAD_EMPLOYEE')) await showInfo(t('cancel_err_access'));
        else if (m.includes('CANCEL_ALREADY')) await showInfo(t('cancel_err_already'));
        else if (/CANCEL_(AMOUNT_MISMATCH|STOCK_CHOICE|ORDER_DELETED|NOT_FOUND|PAID_NEGATIVE|IN_CONSOLIDATED|DRAFT)/.test(m)) await showInfo(t('cancel_err_changed'));
        else showDbError(e, t('cancel_err_generic'));
        if (!orders.some(o => o.id === s.orderId) && currentOrderId === s.orderId) _leaveCancelledDetail();
        return;
    }
    _cancelSt = null;

    // Переносим заказ в отменённые сразу, не дожидаясь перезагрузки
    const cur = orders.find(o => o.id === s.orderId) || order;
    const idx = orders.indexOf(cur);
    if (idx !== -1) orders.splice(idx, 1);
    if (!findCancelledOrder(cur.id)) cancelledOrders.push(Object.assign(cur, {
        cancelled_at: new Date().toISOString(),
        cancelled_by: currentEmployee ? currentEmployee.id : null,
        cancel_retained: Number(res.retained || 0),
        inventory_pending: false
    }));
    _leaveCancelledDetail();

    const parts = [];
    if (a.refund > 0) parts.push(t('cancel_log_refund').replace('{sum}', formatMoney(a.refund / 100)));
    if (a.credit > 0) parts.push(t('cancel_log_credit').replace('{sum}', formatMoney(a.credit / 100)));
    if (a.retain > 0) parts.push(t('cancel_log_retain').replace('{sum}', formatMoney(a.retain / 100)));
    if (s.hasStock) parts.push(s.stock === 'return' ? t('log_stock_returned') : (cur.is_demo ? '' : t('log_loss_note').replace('{sum}', formatMoney(Number(res.loss || 0)))));
    const note = parts.filter(Boolean).join(', ');
    logActivity('order', `${t('trash_order_word')} ${orderLogNum(cur)} (${t('delete_label_customer')} «${cur.customer}») ${t('cancel_log_word')}${note ? ': ' + note : ''}`, cur.id);

    await loadAllData(true);
    if (typeof scheduleLoadInventory === 'function') scheduleLoadInventory();
    if (a.credit > 0 && cur.customer_id && typeof loadCustomerBalance === 'function') {
        try { await loadCustomerBalance(cur.customer_id); if (typeof _onCustBalancesChanged === 'function') _onCustBalancesChanged(); }
        catch (e) { console.error(e); }
    }
    if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
    hideLoading();
    await showInfo(t('cancel_done').replace('{num}', orderNumLabel(cur)));
    // Заказ открывали из другого раздела — возвращаемся туда, как после удаления
    if (typeof stockCardReturnPending === 'function' && stockCardReturnPending()) await returnToStockCard();
    else if (typeof docsReturnPending === 'function' && docsReturnPending()) await returnToDocsPreview();
    else if (typeof docs2ReturnPending === 'function' && docs2ReturnPending()) await returnToDocs2();
}

// Закрыть редактируемую карточку заказа, которого больше нет среди действующих
function _leaveCancelledDetail() {
    currentOrderId = null;
    document.getElementById('ordersList').classList.remove('hidden');
    document.getElementById('orderDetail').classList.remove('active');
    if (typeof currentTabId !== 'undefined' && currentTabId === 'orders') {
        document.getElementById('ordersViewToggle')?.classList.remove('hidden');
        if (typeof positionOrdersViewToggle === 'function') positionOrdersViewToggle();
    }
    displayOrders();
    refreshFab();
}

// ---- Список отменённых (фильтр «Отменённые» в «Оплате») ----
function ordersCancelledMode() { return document.getElementById('orderPaymentFilter')?.value === 'cancelled'; }

function _cancelDateLabel(ts) {
    const d = ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// Пункт фильтра есть, только пока есть отменённые заказы (в пекарнях без отмены его не видно)
function refreshCancelledFilterOption() {
    const has = (typeof cancelledOrders !== 'undefined') && cancelledOrders.length > 0;
    const sel = document.getElementById('orderPaymentFilter');
    if (!has && sel && sel.value === 'cancelled') {
        sel.value = '';
        document.querySelectorAll('#orderPaymentDropdown .status-option').forEach((o, i) => o.classList.toggle('selected', i === 0));
        updateOrderFilterButtonsState();
    }
    document.getElementById('orderPayCancelledOption')?.classList.toggle('hidden', !has);
}

function clearCancelledFilter() {
    document.getElementById('orderPaymentFilter').value = '';
    document.querySelectorAll('#orderPaymentDropdown .status-option').forEach((o, i) => o.classList.toggle('selected', i === 0));
    applyOrderFilter();
}

function cancelledListHtml(list) {
    const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map(o => `<div class="cx-row" onclick="openCancelledOrder(${o.id})">
        <div class="cx-line"><span class="cx-name">${escapeHtml(o.customer || t('orders_no_customer'))}</span><span class="cx-sum">${formatMoney(orderGrandTotal(o))}</span></div>
        <div class="cx-line cx-meta"><span>${escapeHtml(orderNumLabel(o))} · ${escapeHtml(formatDateDMY(o.date))}</span><span>${escapeHtml(t('cancel_row_date').replace('{date}', _cancelDateLabel(o.cancelled_at)))}</span></div>
    </div>`).join('');
    return `<div class="cx-head"><span>${escapeHtml(t('cancel_list_head'))}: ${list.length}</span><button type="button" onclick="clearCancelledFilter()">✕ ${escapeHtml(t('dash_clear_filter'))}</button></div>`
        + (rows || `<p class="text-xs text-gray-400 text-center py-4">${t('orders_none_found')}</p>`);
}

// ---- Просмотр отменённого заказа (только чтение) ----
let _cancelViewId = null;

function openCancelledOrder(orderId) {
    if (!findCancelledOrder(orderId)) return;
    _cancelViewId = orderId;
    openAppPage('cancelledOrderPage');
    renderCancelledOrder();
}
(window._appPageOnShow = window._appPageOnShow || {}).cancelledOrderPage = () => renderCancelledOrder();

async function renderCancelledOrder() {
    const id = _cancelViewId;
    const o = findCancelledOrder(id);
    const body = document.getElementById('cancelledOrderBody');
    if (!body) return;
    const delBtn = document.getElementById('cancelledDeleteBtn');
    delBtn.classList.add('hidden');
    if (!o) { body.innerHTML = `<p class="text-xs text-gray-400 text-center py-4">${t('orders_none_found')}</p>`; return; }
    const who = employees.find(e => e.id === o.cancelled_by);
    const tot = _orderTotals(o);
    const bill = orderBillItems(o);
    const line = (l, r, cls) => `<div class="cx-line${cls ? ' ' + cls : ''}"><span>${escapeHtml(l)}</span><span>${escapeHtml(r)}</span></div>`;
    let html = `<div class="cx-badge">${escapeHtml(t('cancel_badge').replace('{date}', _cancelDateLabel(o.cancelled_at)))}${who ? ' · ' + escapeHtml(who.name) : ''}</div>`
        + `<div class="cx-title">${escapeHtml(t('trash_order_word') + ' ' + orderNumLabel(o))}</div>`
        + line(t('customers_col_number_alt'), o.customer || t('orders_no_customer'))
        + line(t('history_col_date'), formatDateDMY(o.date))
        + (o.employee ? line(t('orders_master'), o.employee) : '')
        + (o.notes ? `<div class="cx-notes">${escapeHtml(o.notes)}</div>` : '')
        + '<div class="cx-sec">'
        + bill.map(it => line(`${it.product} × ${it.quantity}`, formatMoney(it.quantity * it.price))).join('')
        + (Number(o.discount) > 0 ? line(t('cancel_view_discount').replace('{n}', String(o.discount)), '−' + formatMoney(tot.discount)) : '')
        + (tot.vat > 0 ? line(t('cancel_view_vat'), formatMoney(tot.vat)) : '')
        + line(t('cancel_view_total'), formatMoney(orderGrandTotal(o)), 'cx-total')
        + '</div>' + _cancelledDocsHtml(o)
        + '<div id="cancelledMoney" class="cx-sec"><span class="cx-meta">…</span></div>';
    body.innerHTML = html;

    try {
        const [p, l] = await Promise.all([
            db.from('order_payments').select('id, amount, method, kind, paid_at').eq('order_id', o.id).order('id'),
            db.from('order_losses').select('amount').eq('org_id', currentOrgId).eq('order_id', o.id).eq('reason', 'order_cancelled').is('cancelled_at', null)
        ]);
        if (p.error || l.error) throw (p.error || l.error);
        if (_cancelViewId !== id) return;
        const box = document.getElementById('cancelledMoney');
        if (!box) return;
        const kinds = { payment: 'cancel_kind_payment', refund: 'cancel_kind_refund', to_credit: 'cancel_kind_to_credit', from_credit: 'cancel_kind_from_credit' };
        let m = '';
        (p.data || []).forEach(r => {
            m += line(`${formatDateDMY(String(r.paid_at || '').slice(0, 10))} · ${t(kinds[r.kind] || 'cancel_kind_payment')}${r.kind === 'to_credit' || r.kind === 'from_credit' ? '' : ' · ' + _cancelMethodLabel(r.method)}`, formatMoney(Number(r.amount)));
        });
        if (!(p.data || []).length) m += `<div class="cx-meta">${escapeHtml(t('cancel_view_no_pay'))}</div>`;
        if (Number(o.cancel_retained) > 0) m += line(t('cancel_view_retained'), formatMoney(o.cancel_retained), 'cx-total');
        if ((l.data || []).length) m += `<div class="cx-meta" style="margin-top:6px;">${escapeHtml(t('cancel_view_stock_kept'))}${hasPermission('can_view_reports') && !o.is_demo ? ': ' + escapeHtml(formatMoney(l.data.reduce((sum, x) => sum + Number(x.amount), 0))) : ''}</div>`;
        const deletable = !(p.data || []).length && !o.inv_no && !o.dn_no && !o.consolidated_invoice_id;
        if (!deletable) m += `<div class="cx-meta" style="margin-top:6px;">${escapeHtml(t('cancel_view_kept_note'))}</div>`;
        box.innerHTML = m;
        delBtn.classList.toggle('hidden', !(deletable && hasPermission('can_delete')));
    } catch (e) {
        console.error(e);
        const box = document.getElementById('cancelledMoney');
        if (box && _cancelViewId === id) box.innerHTML = `<span class="cx-meta">${escapeHtml(t('error_save_check_connection'))}</span>`;
    }
}

// v984: документы отменённого заказа — только посмотреть
function _cancelledDocsHtml(o) {
    const btn = (type, key, num) => `<button type="button" class="cx-doc" onclick="openCancelledDoc(${o.id}, '${type}')">${escapeHtml(t(key).replace('{n}', _formatDocNumber(type, num)))} ›</button>`;
    const list = (o.inv_no ? btn('invoice', 'cancel_open_inv', o.inv_no) : '') + (o.dn_no ? btn('delivery_note', 'cancel_open_dn', o.dn_no) : '');
    return list ? `<div class="cx-sec">${list}<div class="cx-meta" style="margin-top:6px;">${escapeHtml(t('docs_order_cancelled_hint'))}</div></div>` : '';
}

async function openCancelledDoc(orderId, docType) {
    if (!findCancelledOrder(orderId)) return;
    showLoading(t('docs_opening'));
    try {
        const field = snapshotField(docType);
        const { data, error } = await db.from('orders').select(field).eq('id', orderId).single();
        if (error) throw error;
        const snapshot = data && data[field];
        if (!snapshot) throw new Error(t('inv_unknown_error'));
        // fromOrderSummary: «Закрыть» просто убирает просмотр, страница заказа остаётся
        _docPreview = { docType, snapshot, lang: currentLang, readOnly: true, persisted: true, orderId, consolidatedId: null, fromOrderSummary: true };
        _setPreviewReadOnlyUi(true, false);
        renderDocumentPreviewThumbnail();
        document.getElementById('orderDocumentModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
    }
}

async function copyCancelledOrder() {
    const o = findCancelledOrder(_cancelViewId);
    if (!o) return;
    const cc = o.customer_id ? customers.find(c => c.id === o.customer_id) : null;
    if (cc && cc.archived_at) { showInfo(t('cust_archived_pick').replace('{name}', cc.name)); return; }
    closeAllAppPages();
    showTab('orders');
    await copyOrder(o);
}

async function deleteCancelledOrder() {
    const o = findCancelledOrder(_cancelViewId);
    if (!o) return;
    if (!hasPermission('can_delete')) { showInfo(t('ing_no_delete_permission')); return; }
    if (!(await orderDeleteGuard(o.id, true))) return; // оплаты и документы проверяются по базе
    const quota = typeof orderDeleteQuotaNote === 'function' ? orderDeleteQuotaNote(o) : '';
    const ok = await showConfirm(t('cancel_delete_confirm').replace('{num}', orderNumLabel(o)) + (quota ? '\n\n' + quota : ''), { ok: t('common_delete') });
    if (!ok) return;
    showLoading();
    try {
        suppressRealtimeFor3s();
        await updateChecked(db.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', o.id));
        const i = cancelledOrders.findIndex(x => x.id === o.id);
        if (i !== -1) cancelledOrders.splice(i, 1);
        logActivity('order', `${t('trash_order_word')} ${orderLogNum(o)} (${t('delete_label_customer')} «${o.customer}») ${t('log_moved_to_trash')}`);
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
        saveAppSnapshot();
        await closeAppPage(true);
        displayOrders();
        if (document.getElementById('customerDetail')?.classList.contains('active')) {
            const c = customers.find(x => x.id === currentCustomerId);
            if (c) { renderCustomerStats(c); renderCustomerOrders(); updateCustomerDetailButtons(c); }
        }
    } catch (e) { console.error(e); showDbError(e, t('error_delete_generic')); }
    finally { hideLoading(); }
}
