// ==================== ЗАКАЗЫ ====================
// Список заказов: отображение, группировка по неделям/месяцам, фильтры,
// создание и копирование заказа.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), orders/customers/products/employees (главный скрипт),
// orderGrandTotal (money.js), formatDateDMY/getMondayOf/MONTH_NAMES_RU (dates.js),
// showLoading/hideLoading, logActivity (employees.js), currentEmployee (employees.js),
// svgEdit/svgDelete/svgCopy, openOrderDetail, updateTotals (главный скрипт).

// ---- Список заказов ----

function displayOrders() {
    const today    = getLocalDateStr(0);
    const tomorrow = getLocalDateStr(1);
    const dayAfter = getLocalDateStr(2);
    // Заказ считается "срочным" (попадает в самый верх карточного списка, за
    // разделительной линией) если он на сегодня/завтра/послезавтра и ещё не выполнен.
    function isUrgentOrder(o) {
        return (o.date === today || o.date === tomorrow || o.date === dayAfter) && o.status !== 'выполнен';
    }

    // ---- Табличный вид: как и раньше, с фильтрами ----
    const filteredOrders = getFilteredOrdersForList();
    const sorted = [...filteredOrders].sort((a, b) => new Date(b.date) - new Date(a.date));
    const tbody = document.getElementById('orderTableBody');
    tbody.innerHTML = '';

    let currentMonthKey = null; // 'YYYY-MM' — календарный месяц самого заказа
    let currentWeekKey  = null; // 'YYYY-MM-DD' понедельника — неделя всегда целая, Пн–Вс

    function localStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    // Неделя и месяц — независимые понятия. Неделя всегда целая (Пн–Вс, не режется
    // границей месяца) — так недельный итог сохраняет смысл (полный производственный
    // цикл). Месяц считается строго по календарной дате заказа и закрывается там, где
    // реально заканчивается — даже если это происходит посреди недельного блока.
    function keysFor(order) {
        const d = new Date(order.date);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const weekKey  = localStr(getMondayOf(d));
        return { monthKey, weekKey };
    }

    function appendWeekSummary(weekKey) {
        const monday = new Date(weekKey + 'T00:00:00');
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        const weekTotals = calcGroupTotals(sorted, o => keysFor(o).weekKey === weekKey);
        const weekLabel = formatDateDMY(localStr(monday)) + ' – ' + formatDateDMY(localStr(sunday));
        const weekRow = document.createElement('tr');
        weekRow.innerHTML = `<td colspan="6" class="text-xs font-medium p-0.5" style="background-color:#7c9473; color:#fff;">
            Неделя ${weekLabel} — ${weekTotals.count} зак., ${weekTotals.qty} шт., ${formatMoney(weekTotals.sum)}
        </td>`;
        tbody.appendChild(weekRow);
    }

    function appendMonthSummary(monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const monthTotals = calcGroupTotals(sorted, o => keysFor(o).monthKey === monthKey);
        const monthLabel = `${MONTH_NAMES_RU[m - 1]} ${y}`;
        const monthRow = document.createElement('tr');
        monthRow.innerHTML = `<td colspan="6" class="text-xs font-semibold p-0.5.5" style="background-color:#d9a441; color:#fff;">
            Итого за ${monthLabel} — ${monthTotals.count} зак., ${monthTotals.qty} шт., ${formatMoney(monthTotals.sum)}
        </td>`;
        tbody.appendChild(monthRow);
    }

    function appendSpacer() {
        const spacerRow = document.createElement('tr');
        spacerRow.innerHTML = `<td colspan="6" class="p-0.5.5 border-b border-gray-300"></td>`;
        tbody.appendChild(spacerRow);
    }

    sorted.forEach((order) => {
        const { monthKey, weekKey } = keysFor(order);

        const monthChanged = currentMonthKey !== null && monthKey !== currentMonthKey;
        const weekChanged  = currentWeekKey  !== null && weekKey  !== currentWeekKey;

        // Месяц закрывается сам по себе, независимо от недели — может попасть
        // прямо посреди недельного блока.
        if (monthChanged) {
            appendMonthSummary(currentMonthKey);
        }
        // Неделя закрывается только когда реально меняется сама неделя.
        if (weekChanged) {
            appendWeekSummary(currentWeekKey);
            appendSpacer();
        }

        currentMonthKey = monthKey;
        currentWeekKey  = weekKey;

        const realIdx = orders.indexOf(order);
        const total = formatMoney(orderGrandTotal(order));
        const itemsCount = order.items ? order.items.length : 0;
        let flagClass = 'flag';
        if (order.status === 'принят')    flagClass += ' flag-red';
        else if (order.status === 'в работе') flagClass += ' flag-yellow';
        else if (order.status === 'выполнен') flagClass += ' flag-green';

        // Статус оплаты — цветная точка рядом с суммой (не оплачен/частично/оплачен/просрочен)
        const payInfo = getOrderPaymentStatus(order);
        let payDotTitle = 'Не оплачен';
        if (payInfo.status === 'partial') payDotTitle = 'Частично оплачен';
        else if (payInfo.status === 'paid') payDotTitle = 'Оплачен';
        if (payInfo.overdue) payDotTitle += ' · просрочен';
        const payDot = `<span class="inline-block w-2 h-2 rounded-full mr-1" style="background-color:${getPaymentStripeColor(payInfo)};" title="${payDotTitle}"></span>`;

        const isMerged = order.notes && order.notes.includes('⚠ объединён, требует проверки');
        const row = document.createElement('tr');
        row.className = 'order-row border-b' + (isMerged ? ' bg-red-50' : '');
        row.innerHTML = `
            <td class=" p-0.5 table-text whitespace-nowrap${isMerged ? ' text-red-700 font-semibold' : ''}" onclick="openOrderDetail(${order.id})">${formatDateDMY(order.date)}${isMerged ? ' ⚠' : ''}</td>
            <td class=" p-0.5 table-text" onclick="openOrderDetail(${order.id})">${escapeHtml(order.customer)}</td>
            <td class=" p-0.5 table-text text-center" onclick="openOrderDetail(${order.id})">${itemsCount}</td>
            <td class=" p-0.5 table-text font-medium whitespace-nowrap" onclick="openOrderDetail(${order.id})">${payDot}${total}</td>
            <td class=" p-0.5 text-center" onclick="openOrderDetail(${order.id})"><span class="${flagClass}"></span></td>
            <td class=" p-0.5 text-center">
                ${hasPermission('can_delete') ? svgDeleteSafe('openDeleteModal', [realIdx, 'order', `заказ клиента «${order.customer}»`]) : ''}
                ${svgCopy(`copyOrder(${realIdx})`)}
            </td>`;
        tbody.appendChild(row);
    });

    // Закрываем последнюю неделю и месяц (таблица)
    if (currentWeekKey !== null) {
        appendWeekSummary(currentWeekKey);
        appendMonthSummary(currentMonthKey);
    }

    // ---- Карточный вид: полный список без фильтров, своя группировка ----
    const cardsBody = document.getElementById('orderCardsBody');
    if (cardsBody) {
        const sortedAll = [...orders].sort((a, b) => new Date(b.date) - new Date(a.date));
        const activeOrders = sortedAll.filter(o => o.status !== 'выполнен');
        const doneOrders   = sortedAll.filter(o => o.status === 'выполнен');

        function urgentDividerHtml() {
            return `<div class="oc-urgent-divider"><span>Остальные заказы</span></div>`;
        }
        function sectionDividerHtml(label, iconSvg) {
            return `<div class="oc-section-divider"><span class="label">${iconSvg}${label}</span></div>`;
        }

        let cardsHtml = '';

        if (activeOrders.length) {
            cardsHtml += sectionDividerHtml('Заказы в работе',
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>');

            // Разделитель: срочные заказы (сегодня/завтра/послезавтра, не выполненные)
            // не дублируются отдельным блоком, а просто отделяются линией от остальных,
            // как только в потоке встречается первый "несрочный" заказ.
            let inUrgentZone = true, urgentCount = 0;
            activeOrders.forEach(order => {
                const urgent = isUrgentOrder(order);
                if (inUrgentZone) {
                    if (urgent) { urgentCount++; }
                    else {
                        if (urgentCount > 0) cardsHtml += urgentDividerHtml();
                        inUrgentZone = false;
                    }
                }
                cardsHtml += renderOrderCard(order);
            });
        }

        if (doneOrders.length) {
            cardsHtml += sectionDividerHtml('Выполненные',
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>');
            doneOrders.forEach(order => { cardsHtml += renderDoneOrderCard(order); });
        }

        cardsBody.innerHTML = cardsHtml || `<p class="text-xs text-gray-400 text-center py-4">Заказов не найдено</p>`;
    }

    updateTotals(filteredOrders);

    // Пересчитываем позицию переключателя вида при каждой перерисовке списка —
    // не полагаемся на одноразовый расчёт при входе, который мог сработать
    // до того, как реальная раскладка страницы устоялась.
    if (typeof positionOrdersViewToggle === 'function') {
        requestAnimationFrame(positionOrdersViewToggle);
    }
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

// Позиции заказа теперь показываются во всех карточках без исключения.
function renderOrderCard(order) {
    const payInfo = getOrderPaymentStatus(order);
    const stripeColor = getPaymentStripeColor(payInfo);
    const statusColor = ORDER_STATUS_COLORS[order.status] || ORDER_STATUS_COLORS['принят'];
    const oNum = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const total = formatMoney(orderGrandTotal(order));

    let payLine = '';
    if (payInfo.status === 'partial' || payInfo.overdue) {
        const pending = Math.max(0, payInfo.grandAmt - payInfo.paidAmt);
        payLine = `<div class="oc-pay-line"><span style="color:#4f6349">${formatMoney(payInfo.paidAmt)} оплачено</span> · <span style="color:#c0685c">${formatMoney(pending)} осталось</span></div>`;
    }
    const overdueLine = payInfo.overdue ? `<div class="oc-pay-line" style="color:#8b3a3a; font-weight:700;">Просрочен платёж</div>` : '';

    let itemsLine = '';
    if (order.items && order.items.length) {
        itemsLine = `<div class="oc-items">` +
            order.items.map(it => `<div class="oc-item-row"><span class="oc-item-name">· ${escapeHtml(it.product)}</span><span class="oc-item-qty">${it.quantity} шт.</span></div>`).join('') +
            `</div>`;
    }

    const statusOptions = ORDER_STATUS_LIST.map(s => `
        <div class="status-option${s === order.status ? ' selected' : ''}" onclick="event.stopPropagation(); quickSetOrderStatus(${order.id}, '${s}')">
            <span><span class="dot" style="background:${ORDER_STATUS_COLORS[s]}"></span> ${s.charAt(0).toUpperCase() + s.slice(1)}</span>
            <svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
        </div>`).join('');

    return `
    <div class="order-card" id="orderCard-${order.id}">
        <div class="order-card-tap" onclick="openOrderDetail(${order.id})">
            <div class="stripe" style="background:${stripeColor}"></div>
            <div class="order-card-body">
                <div class="oc-row">
                    <span class="oc-name">${escapeHtml(order.customer || '(без клиента)')}</span>
                    <span class="oc-sum">${total}</span>
                </div>
                <div class="oc-row" style="margin-top:3px;">
                    <span class="oc-meta">${formatDateDMY(order.date)} · ${escapeHtml(oNum)}</span>
                    <div style="position:relative;" onclick="event.stopPropagation();">
                        <button class="status-btn" style="background:${statusColor};" onclick="toggleOrderStatusDropdown(${order.id})">
                            ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
                        </button>
                        <div class="status-dropdown" id="statusDropdown-${order.id}">${statusOptions}</div>
                    </div>
                </div>
                ${payLine}
                ${overdueLine}
                ${itemsLine}
            </div>
        </div>
    </div>`;
}

function closeAllOrderStatusDropdowns() {
    document.querySelectorAll('.status-dropdown.open').forEach(d => d.classList.remove('open'));
}
// Закрываем дропдаун статуса при тапе где угодно ещё на странице.
document.addEventListener('click', closeAllOrderStatusDropdowns);

// Компактная приглушённая карточка выполненного заказа. Полоса оплаты и кнопка
// статуса не нужны (заказ закрыт) — вместо них маленькая зелёная галочка.
// Разворачивается стрелкой в углу до обычного вида (с позициями), тап по самой
// карточке по-прежнему открывает полную карточку заказа.
function renderDoneOrderCard(order) {
    const payInfo = getOrderPaymentStatus(order);
    const stripeColor = getPaymentStripeColor(payInfo);
    const oNum = order.order_number ? ('№' + order.order_number) : ('#' + order.id);
    const total = formatMoney(orderGrandTotal(order));

    let itemsLine = '';
    if (order.items && order.items.length) {
        itemsLine = order.items.map(it => `<div class="oc-item-row"><span class="oc-item-name">· ${escapeHtml(it.product)}</span><span class="oc-item-qty">${it.quantity} шт.</span></div>`).join('');
    }

    return `
    <div class="order-card done-card muted" id="orderCard-${order.id}">
        <div class="stripe" style="background:${stripeColor}; display:none;" data-role="stripe"></div>
        <div class="order-card-tap" onclick="handleDoneCardTap(event, ${order.id})">
            <div class="order-card-body" style="padding-right:34px;">
                <div class="oc-row">
                    <span class="oc-name">${escapeHtml(order.customer || '(без клиента)')}</span>
                    <span class="oc-sum">${total}</span>
                </div>
                <div class="oc-meta">${formatDateDMY(order.date)} · ${escapeHtml(oNum)}</div>
                <div class="oc-items" data-role="items" style="display:none;">${itemsLine}</div>
            </div>
        </div>
        <div class="expand-btn" onclick="event.stopPropagation(); toggleDoneCardExpand(${order.id})" title="Развернуть">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </div>
    </div>`;
}

function handleDoneCardTap(e, orderId) {
    if (e.target.closest('.expand-btn')) return;
    openOrderDetail(orderId);
}

function toggleDoneCardExpand(orderId) {
    const card = document.getElementById('orderCard-' + orderId);
    if (!card) return;
    const expanded = card.classList.toggle('expanded');
    card.classList.toggle('muted', !expanded);
    card.querySelector('[data-role="stripe"]').style.display = expanded ? '' : 'none';
    card.querySelector('[data-role="items"]').style.display = expanded ? 'block' : 'none';
}

function toggleOrderStatusDropdown(orderId) {
    const dd = document.getElementById('statusDropdown-' + orderId);
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) dd.classList.add('open');
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
        logActivity('order', `Заказ ${oNum}: статус «${oldStatus}» → «${newStatus}»`, orderId);
    } catch (e) {
        order.status = oldStatus; // откат при ошибке сети/сохранения
        displayOrders();
        showInfo('Не удалось изменить статус. Проверьте соединение и попробуйте ещё раз.');
    }
}

// Переключатель "Карточки / Таблица" — верхний правый угол экрана.
function setOrdersViewMode(mode) {
    document.getElementById('orderCardsWrap')?.classList.toggle('hidden', mode !== 'cards');
    document.getElementById('orderTableWrap')?.classList.toggle('hidden', mode !== 'table');
    document.getElementById('orderFiltersPanel')?.classList.toggle('hidden', mode !== 'table');
    document.getElementById('ordersViewBtnCards')?.classList.toggle('active', mode === 'cards');
    document.getElementById('ordersViewBtnTable')?.classList.toggle('active', mode === 'table');
    // В карточном виде фильтрация не применяется — сбрасываем на "все заказы",
    // чтобы при возврате в таблицу не оставалось путаницы, что именно отфильтровано.
    if (mode === 'cards') displayOrders();
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
    const shouldShow = (typeof currentTabId === 'undefined' || currentTabId === 'orders') && !isOrderDetailOpen;
    toggle.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) return;

    const headerCard = document.querySelector('#appStickyHeader .bg-white');
    const list = document.getElementById('ordersList');
    if (!headerCard || !list) return;

    const GAP = 40; // желаемое расстояние между шапкой и первой карточкой
    list.style.paddingTop = GAP + 'px';

    const headerBottom = headerCard.getBoundingClientRect().bottom;
    const toggleHeight  = toggle.offsetHeight;
    // +10px — сдвиг чуть ниже геометрического центра зазора (по просьбе, "на глаз" смотрится лучше)
    toggle.style.top = Math.round(headerBottom + GAP / 2 - toggleHeight / 2 + 6) + 'px';
}
window.addEventListener('resize', positionOrdersViewToggle);

// Считает сумму (с НДС) и общее кол-во изделий по подмножеству заказов, отобранных predicate
function calcGroupTotals(allOrders, predicate) {
    let sum = 0, qty = 0, count = 0;
    allOrders.forEach(o => {
        if (predicate(o)) {
            sum += orderGrandTotal(o);
            qty += (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
            count++;
        }
    });
    return { sum, qty, count };
}

// Статус оплаты заказа — единая логика для цветной точки в списке и для фильтра "Оплата",
// чтобы они никогда не расходились между собой.
function getOrderPaymentStatus(order) {
    const paidAmt = _orderPaidTotals[order.id] || 0;
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
    const overdue = !!order.due_date && order.due_date < today && status !== 'paid';
    return { paidAmt, grandAmt, status, overdue };
}

// ---- Фильтры списка заказов ----

let selectedOrderCustomers = []; // пусто = все клиенты

function getFilteredOrdersForList() {
    const dateRange = document.getElementById('orderDateRangeFilter') ? document.getElementById('orderDateRangeFilter').value : 'all';
    const dateFrom  = document.getElementById('orderDateFrom') ? document.getElementById('orderDateFrom').value : '';
    const dateTo    = document.getElementById('orderDateTo')   ? document.getElementById('orderDateTo').value   : '';
    const employeeFilter = document.getElementById('orderEmployeeFilter') ? document.getElementById('orderEmployeeFilter').value : '';
    const paymentFilter  = document.getElementById('orderPaymentFilter')  ? document.getElementById('orderPaymentFilter').value  : '';
    let filtered = [...orders];
    if (selectedOrderCustomers.length > 0) filtered = filtered.filter(o => selectedOrderCustomers.includes(o.customer));
    if (employeeFilter) filtered = filtered.filter(o => String(o.employee_id) === employeeFilter);
    if (paymentFilter) {
        filtered = filtered.filter(o => {
            const info = getOrderPaymentStatus(o);
            return paymentFilter === 'overdue' ? info.overdue : info.status === paymentFilter;
        });
    }
    if (dateRange === 'week' || dateRange === 'month') {
        const today = new Date();
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

// Проверяет все заказы с отложенным списанием (inventory_pending = true) — если до
// даты заказа осталось ≤ INVENTORY_PENDING_DAYS дней, списывает склад и снимает флаг.
// Вызывается при каждой загрузке данных (loadAllData), чтобы отложенные заказы
// "дозревали" сами, без участия пользователя.
async function processPendingInventory() {
    const pending = orders.filter(o => o.inventory_pending && shouldWriteOffNow(o.date));
    if (!pending.length) return;
    for (const order of pending) {
        for (const it of (order.items || [])) {
            const prod = products.find(p => p.id === it.product_id);
            if (prod) await writeOffInventoryForItem(prod, it.quantity, order.id, it.id);
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
    customers.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(c => {
        const selected = selectedOrderCustomers.includes(c.name);
        const row = document.createElement('div');
        row.className = 'status-option' + (selected ? ' selected' : '');
        row.style.justifyContent = 'flex-start';
        row.style.gap = '4px';
        row.style.padding = '9px 6px';
        row.dataset.fn = 'onOrderCustomerFilterChange';
        row.dataset.args = JSON.stringify([c.name]);
        row.innerHTML = `<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span>${escapeHtml(c.name)}</span>`;
        list.appendChild(row);
    });
    updateOrderFilterLabel();
}

function updateOrderEmployeeFilter() {
    const sel = document.getElementById('orderEmployeeFilter');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Все исполнители</option>';
    employees.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        if (String(e.id) === prev) opt.selected = true;
        sel.appendChild(opt);
    });
    renderOrderEmployeeFilterList();
}

function renderOrderEmployeeFilterList() {
    const list = document.getElementById('orderEmployeeFilterList');
    if (!list) return;
    const current = document.getElementById('orderEmployeeFilter').value;
    let html = `<div class="status-option${current === '' ? ' selected' : ''}" onclick="setOrderEmployeeFilter('')"><span>Все мастера</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    employees.forEach(e => {
        html += `<div class="status-option${String(e.id) === current ? ' selected' : ''}" onclick="setOrderEmployeeFilter('${e.id}')"><span>${escapeHtml(e.name)}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
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
    if (range !== 'custom') closeAllFilterDropdowns();
    applyOrderFilter();
}

function setOrderPaymentFilter(status) {
    document.getElementById('orderPaymentFilter').value = status;
    document.querySelectorAll('#orderPaymentDropdown .status-option').forEach(o => o.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    closeAllFilterDropdowns();
    applyOrderFilter();
}

function toggleFilterDropdown(id) {
    document.querySelectorAll('.filter-dropdown').forEach(d => { if (d.id !== id) d.classList.add('hidden'); });
    document.getElementById(id).classList.toggle('hidden');
}

function closeAllFilterDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.add('hidden'));
}

function toggleAllOrderCustomersFilter() {
    selectedOrderCustomers = [];
    updateOrderCustomerFilter();
    displayOrders();
}

function onOrderCustomerFilterChange(name) {
    if (selectedOrderCustomers.includes(name)) {
        selectedOrderCustomers = selectedOrderCustomers.filter(n => n !== name);
    } else {
        selectedOrderCustomers.push(name);
    }
    updateOrderCustomerFilter();
    displayOrders();
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

function applyOrderFilter() {
    displayOrders();
}

// Закрытие любой открытой панели фильтра заказов по клику снаружи её самой
document.addEventListener('click', function(e) {
    document.querySelectorAll('.filter-dropdown:not(.hidden)').forEach(dropdown => {
        const wrapper = dropdown.closest('.relative');
        if (wrapper && !wrapper.contains(e.target)) dropdown.classList.add('hidden');
    });
});

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
        // Номер заказа выдаёт база данных (атомарно, без риска дублей при одновременном создании)
        const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: currentOrgId });
        if (numErr) throw numErr;
        const orderNumber = orderNumberData;

        const { data, error } = await db.from('orders').insert({
            org_id: currentOrgId, customer_id: null, order_date: today, status: 'принят', discount: 0, vat_exempt: false,
            employee_id: employeeId, order_number: orderNumber
        }).select().single();
        if (error) throw error;
        const emp = employees.find(e => e.id === data.employee_id);
        const newOrder = {
            id: data.id, customer_id: null, customer: '',
            date: data.order_date, status: data.status, discount: 0,
            vat_exempt: false,
            employee_id: data.employee_id || null, employee: emp ? emp.name : '',
            notes: '', order_number: data.order_number || orderNumber,
            due_date: null,
            inventory_pending: false,
            items: []
        };
        orders.push(newOrder);
        _draftOrderIds.add(newOrder.id);
        displayOrders();
        openOrderDetail(newOrder.id);
        logActivity('order', `Создан черновик заказа №${newOrder.id}`, newOrder.id);
    } catch (e) { console.error(e); showDbError(e, 'Ошибка создания заказа. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function copyOrder(i) {
    suppressRealtimeFor3s();
    const o = orders[i];
    const employeeId = currentEmployee ? currentEmployee.id : null;
    showLoading();
    try {
        const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: currentOrgId });
        if (numErr) throw numErr;
        const orderNumber = orderNumberData;

        const { data, error } = await db.from('orders').insert({
            org_id: currentOrgId,
            customer_id: o.customer_id,
            order_date: new Date().toISOString().split('T')[0],
            status: 'принят',
            discount: o.discount || 0,
            vat_exempt: !!o.vat_exempt,
            employee_id: employeeId,
            order_number: orderNumber
        }).select().single();
        if (error) throw error;

        const emp = employees.find(e => e.id === data.employee_id);
        const copy = {
            id: data.id, customer_id: o.customer_id, customer: o.customer,
            date: data.order_date, status: data.status, discount: Number(data.discount || 0),
            vat_exempt: !!data.vat_exempt,
            employee_id: data.employee_id || null, employee: emp ? emp.name : '',
            order_number: data.order_number || orderNumber,
            due_date: null,
            inventory_pending: false,
            items: []
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
                await saveOrderItemIngredients(it.id, prod, it.quantity);
                if (shouldWriteOffNow(copy.date)) {
                    await writeOffInventoryForItem(prod, it.quantity, copy.id, it.id);
                } else if (!copy.inventory_pending) {
                    try {
                        await updateChecked(db.from('orders').update({ inventory_pending: true }).eq('id', copy.id));
                        copy.inventory_pending = true;
                    } catch (e) { console.error('Не удалось отметить inventory_pending:', e); }
                }
            }
        }

        displayOrders();
        openOrderDetail(copy.id);
        logActivity('order', `Скопирован заказ №${o.id} → новый заказ №${copy.id} (клиент «${o.customer}»)`, copy.id);
    } catch (e) { console.error(e); showDbError(e, 'Ошибка копирования заказа. Проверьте подключение.'); }
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
    currentOrderId = orderId;
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Скрыть список, показать детальный вид
    document.getElementById('ordersList').classList.add('hidden');
    document.getElementById('orderDetail').classList.add('active');
    document.getElementById('orderDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('orderDetail').classList.remove('fade-in'), 300);
    // Переключатель "Карточки/Таблица" бессмысленен внутри самой карточки заказа — прячем
    document.getElementById('ordersViewToggle')?.classList.add('hidden');

    const _oNum = order.order_number || `#${orderId}`;
    document.getElementById('detailOrderId').textContent = `Заказ ${_oNum}`;

    // Заполнить шапку
    fillDetailCustomerSelect(order.customer);
    document.getElementById('detailDate').value     = order.date;
    document.getElementById('detailStatus').value   = order.status;
    renderDetailStatusButton(order.status);
    document.getElementById('detailDiscount').value = (order.discount || 0);
    document.getElementById('detailVatExempt').checked = !!order.vat_exempt;
    document.getElementById('detailNotes').value = order.notes || '';
    fillDetailEmployeeSelect(order.employee_id);

    // Показываем кнопку "Проверен" только для объединённых заказов
    const checkedBtn = document.getElementById('markCheckedBtn');
    if (checkedBtn) {
        const isMerged = order.notes && order.notes.includes('⚠ объединён, требует проверки');
        checkedBtn.classList.toggle('hidden', !isMerged);
    }

    renderDetailItems(order);
    updateProductSelects();
    refreshFab();
    loadOrderPayments(orderId);
}

function fillDetailEmployeeSelect(selectedId) {
    const sel = document.getElementById('detailEmployee');
    if (!sel) return;
    sel.innerHTML = '<option value="">—</option>';
    employees.forEach(e => {
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
    lbl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
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
    if (!isOpen) dd.classList.add('open');
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
    employees.forEach(e => {
        html += `<div class="status-option${String(e.id) === String(selectedId) ? ' selected' : ''}" onclick="setDetailEmployee('${e.id}')"><span>${escapeHtml(e.name)}</span><svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>`;
    });
    list.innerHTML = html;
}

function toggleDetailEmployeeDropdown() {
    const dd = document.getElementById('detailEmployeeDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) dd.classList.add('open');
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

async function cleanupOrderDraftIfEmpty(orderId) {
    if (!_draftOrderIds.has(orderId)) return;
    _draftOrderIds.delete(orderId);
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    const order = orders[idx];
    // Не удаляем если выбран клиент ИЛИ уже добавлены позиции
    if (order.customer_id || (order.items && order.items.length > 0)) return;
    try {
        await db.from('orders').delete().eq('id', orderId);
        orders.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик заказа:', e); }
}

async function closeOrderDetail() {
    const leavingId = currentOrderId;
    currentOrderId = null;
    document.getElementById('ordersList').classList.remove('hidden');
    document.getElementById('orderDetail').classList.remove('active');
    document.getElementById('ordersViewToggle')?.classList.remove('hidden');
    positionOrdersViewToggle();
    if (leavingId !== null) await cleanupOrderDraftIfEmpty(leavingId);
    displayOrders();
    refreshFab();
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

// Снимает пометку "⚠ объединён, требует проверки" после того как заказ проверен
async function markOrderChecked() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const newNotes = (order.notes || '')
        .replace(' | ⚠ объединён, требует проверки', '')
        .replace('⚠ объединён, требует проверки', '')
        .trim();
    showLoading();
    try {
        await updateChecked(db.from('orders').update({ notes: newNotes }).eq('id', order.id));
        order.notes = newNotes;
        document.getElementById('detailNotes').value = newNotes;
        document.getElementById('markCheckedBtn').classList.add('hidden');
        displayOrders(); // убираем красную подсветку в списке
        logActivity('order', `Заказ №${order.id} проверен после объединения`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// Удаление заказа прямо из его карточки (переиспользует стандартное окно
// подтверждения — openDeleteModal/confirmDelete, как и удаление из списка).
// ==================== КОРЗИНА УДАЛЁННЫХ ЗАКАЗОВ ====================

async function openOrdersTrash() {
    closeModal();
    showLoading('Загружаю корзину...');
    try {
        // Автоочистка — физически удаляем заказы старше 30 дней
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        await db.from('orders')
            .delete()
            .not('deleted_at', 'is', null)
            .lt('deleted_at', cutoff.toISOString());

        // Загружаем оставшиеся удалённые заказы
        const { data, error } = await db.from('orders')
            .select('id, customer_id, order_date, status, notes, deleted_at, order_number')
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false });

        hideLoading();

        if (error) throw error;

        const content = document.getElementById('ordersTrashContent');
        if (!data || !data.length) {
            content.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Корзина пуста</p>';
        } else {
            let html = '<table class="w-full text-xs"><thead><tr class="bg-gray-100"><th class="p-1 text-left">Дата заказа</th><th class="p-1 text-left">Клиент</th><th class="p-1 text-left">Удалён</th></tr></thead><tbody>';
            data.forEach(o => {
                const cust = customers.find(c => c.id === o.customer_id);
                const custName = cust ? cust.name : '(неизвестно)';
                const deletedDate = new Date(o.deleted_at).toLocaleDateString('ru-LT');
                const orderDate = formatDateDMY(o.order_date || o.date);
                const orderNum = o.order_number || `#${o.id}`;
                html += `<tr class="border-b cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                    onclick="openTrashOrderActions(${o.id}, '${escapeHtml(custName)}', '${orderDate}', '${escapeHtml(orderNum)}')">
                    <td class="p-0.5">${orderDate}</td>
                    <td class="p-0.5">${escapeHtml(custName)}</td>
                    <td class="p-0.5 text-gray-400">${deletedDate}</td>
                </tr>`;
            });
            html += '</tbody></table>';
            content.innerHTML = html;
        }
        document.getElementById('ordersTrashModal').style.display = 'flex';
    } catch(e) {
        hideLoading();
        console.error(e);
        showInfo('Ошибка загрузки корзины.');
    }
}

function openTrashOrderActions(orderId, custName, orderDate, orderNum) {
    const modal = document.getElementById('trashOrderActionsModal');
    const title = document.getElementById('trashOrderActionsTitle');
    const restoreBtn = document.getElementById('trashRestoreBtn');
    const deleteBtn  = document.getElementById('trashDeleteBtn');
    if (!modal) return;

    title.textContent = `Заказ ${orderNum} · ${custName} · ${orderDate}`;

    // Переназначаем обработчики каждый раз (избегаем накопления listener-ов)
    restoreBtn.onclick = async () => {
        modal.style.display = 'none';
        await restoreOrder(orderId);
    };
    deleteBtn.onclick = async () => {
        modal.style.display = 'none';
        const ok = await showConfirm(`Удалить заказ №${orderId} навсегда? Это действие нельзя отменить.`);
        if (ok) await permanentDeleteOrder(orderId);
    };

    modal.style.display = 'flex';
}

async function restoreOrder(orderId) {
    if (!hasPermission('can_delete')) {
        closeModal();
        showInfo('У вас нет права на это действие. Обратитесь к владельцу пекарни.');
        return;
    }
    suppressRealtimeFor3s();
    showLoading();
    try {
        await updateChecked(db.from('orders').update({ deleted_at: null }).eq('id', orderId));
        closeModal();
        await loadAllData();
        logActivity('order', `Заказ №${orderId} восстановлен из корзины`);
        await showInfo(`Заказ №${orderId} восстановлен.`);
    } catch(e) { console.error(e); showInfo('Ошибка восстановления.'); }
    finally { hideLoading(); }
}

async function permanentDeleteOrder(orderId) {
    if (!hasPermission('can_delete')) {
        closeModal();
        showInfo('У вас нет права на удаление. Обратитесь к владельцу пекарни.');
        return;
    }
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { error } = await db.from('orders').delete().eq('id', orderId);
        if (error) throw error;
        closeModal();
        logActivity('order', `Заказ №${orderId} удалён окончательно`);
        await showInfo(`Заказ №${orderId} удалён окончательно.`);
    } catch(e) { console.error(e); showInfo('Ошибка удаления.'); }
    finally { hideLoading(); }
}

// Формирует текстовую сводку по заказу и открывает системное меню "Поделиться"
// (владелец сам выбирает получателя — клиента, коллегу или просто копирует себе)
function shareOrderInfo() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const oNum = order.order_number || `#${order.id}`;
    const total = (document.getElementById('detailTotal').textContent || '').trim();

    let text = `Заказ ${oNum}\nКлиент: ${order.customer}\nДата: ${formatDateDMY(order.date)}\nСтатус: ${order.status}\n\nПозиции:\n`;
    (order.items || []).forEach(item => {
        text += `• ${item.product} — ${item.quantity} × ${formatMoney(item.price)} = ${formatMoney(item.quantity * item.price)}\n`;
    });
    text += `\nИтого к оплате: ${total}`;

    shareOrCopyText(text);
}

function deleteCurrentOrder() {
    const idx = orders.findIndex(o => o.id === currentOrderId);
    if (idx === -1) return;
    const order = orders[idx];
    openDeleteModal(idx, 'order', `заказ клиента «${order.customer}»`);
}

// Переход из карточки заказа в карточку его клиента (раздел "Клиенты")
function goToCustomerFromOrder() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || !order.customer_id) { showInfo('У этого заказа не указан клиент.'); return; }
    showTab('customers');
    openCustomerDetail(order.customer_id);
}

async function saveDetailHeader() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const customerName = document.getElementById('detailCustomer').value.trim();
    const date     = document.getElementById('detailDate').value;
    const status   = document.getElementById('detailStatus').value;
    const discount = parseFloat(document.getElementById('detailDiscount').value) || 0;
    const vatExempt = document.getElementById('detailVatExempt').checked;
    const notes = document.getElementById('detailNotes').value;
    const employeeIdRaw = document.getElementById('detailEmployee').value;
    const employeeId = employeeIdRaw ? Number(employeeIdRaw) : null;

    // Клиента переподбираем только если поле реально изменилось (а не на каждое
    // сохранение любого другого поля) — иначе правка статуса/НДС/скидки ломалась бы,
    // если по любой причине (например, пустое имя клиента в базе) поле "Клиент"
    // не совпадает 1-в-1 с текущим списком клиентов.
    let custId = order.customer_id;
    let custName = order.customer;
    if (customerName !== (order.customer || '')) {
        const cust = customers.find(c => c.name === customerName);
        if (!cust) {
            showInfo(`Клиент «${customerName}» не найден в списке. Выберите клиента из выпадающего списка.`);
            document.getElementById('detailCustomer').value = order.customer || ''; // откатываем поле
            return;
        }
        custId = cust.id;
        custName = cust.name;
    }

    // Запоминаем прежние значения для журнала
    const old = { customer: order.customer, date: order.date, status: order.status, discount: order.discount, employee: order.employee, notes: order.notes || '' };

    showLoading();
    try {
        await updateChecked(db.from('orders').update({
            customer_id: custId, order_date: date, status, discount, vat_exempt: vatExempt, employee_id: employeeId, notes
        }).eq('id', order.id));
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
        renderDetailItems(order);

        // Дата заказа могла пересечь порог отложенного списания (INVENTORY_PENDING_DAYS) —
        // если да, нужно либо списать склад прямо сейчас, либо сторнировать уже списанное.
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
        if (old.customer !== order.customer) changes.push(`клиент «${old.customer}» → «${order.customer}»`);
        if (old.date !== order.date) changes.push(`дата ${formatDateDMY(old.date)} → ${formatDateDMY(order.date)}`);
        if (old.status !== order.status) changes.push(`статус «${old.status}» → «${order.status}»`);
        if (old.discount !== order.discount) changes.push(`скидка ${old.discount}% → ${order.discount}%`);
        if ((old.employee || '') !== (order.employee || '')) changes.push(`исполнитель «${old.employee || '—'}» → «${order.employee || '—'}»`);
        if (old.notes !== order.notes) changes.push(`комментарий изменён`);
        if (changes.length) logActivity('order', `Изменён заказ №${order.id}: ${changes.join(', ')}`, order.id);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function renderDetailItems(order) {
    const tbody = document.getElementById('detailItemsBody');
    tbody.innerHTML = '';
    if (!order.items || !order.items.length) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" class="text-center text-xs text-gray-400 py-2">Нет позиций. Добавьте изделие ниже.</td>`;
        tbody.appendChild(row);
    } else {
        order.items.forEach((item, i) => {
            const total = formatMoney(item.quantity * item.price);
            const prod = products.find(p => p.id === item.product_id);
            const unitLabel = prod && prod.unit ? (UNIT_PRODUCT_LABELS[prod.unit] || '') : '';
            const row = document.createElement('tr');
            row.className = 'border-b cursor-pointer';
            row.onclick = () => openEditItemModal(i);
            row.innerHTML = `
                <td class="p-0.5 table-text">${escapeHtml(item.product)}</td>
                <td class="p-0.5 table-text text-center">${item.quantity}${unitLabel ? ' ' + unitLabel : ''}</td>
                <td class="p-0.5 table-text text-center">${formatMoney(item.price)}</td>
                <td class="p-0.5 table-text text-center font-medium">${total}</td>
                <td class="p-0.5 text-center" onclick="event.stopPropagation()">
                    ${hasPermission('can_delete') ? svgDelete(`deleteItem(${i})`) : ''}
                </td>`;
            tbody.appendChild(row);
        });
    }
    // Итого
    const totQty    = (order.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0);
    const subtotal  = orderTotal(order);
    const discPct   = order.discount || 0;
    const discAmt   = orderDiscountAmount(order);
    const vatAmt    = orderVatAmount(order);
    const grand     = orderGrandTotal(order);

    document.getElementById('detailItemsCount').textContent   = totQty;
    document.getElementById('detailSubtotal').textContent     = formatMoney(subtotal);
    document.getElementById('detailDiscountPct').textContent  = discPct;
    document.getElementById('detailDiscountAmount').textContent = '-' + formatMoney(discAmt);
    document.getElementById('detailVatAmount').textContent    = formatMoney(vatAmt);
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
}

async function addItemToOrder() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const productName = document.getElementById('newItemProduct').value;
    const quantity = parseFloat(document.getElementById('newItemQty').value);
    const price    = parseFloat(document.getElementById('newItemPrice').value);
    if (!productName || isNaN(quantity) || quantity <= 0 || isNaN(price)) {
        showInfo('Заполните изделие, количество и цену!'); return;
    }
    const prod = products.find(p => p.name === productName);
    if (!prod) { showInfo('Изделие не найдено!'); return; }
    const itemCost = parseFloat((productUnitCost(prod) * quantity).toFixed(4));

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
        await saveOrderItemIngredients(data.id, prod, Number(data.quantity));

        if (shouldWriteOffNow(order.date)) {
            await writeOffInventoryForItem(prod, Number(data.quantity), order.id, data.id);
        } else if (!order.inventory_pending) {
            // Заказ далеко вперёд — списание отложено до момента, когда до него
            // останется INVENTORY_PENDING_DAYS дней (см. processPendingInventory)
            try {
                await updateChecked(db.from('orders').update({ inventory_pending: true }).eq('id', order.id));
                order.inventory_pending = true;
            } catch (e) { console.error('Не удалось отметить inventory_pending:', e); }
        }

        renderDetailItems(order);
        logActivity('item', `Добавлена позиция в заказ №${order.id}: «${prod.name}» × ${quantity}`, order.id);
        // Сбросить поля
        document.getElementById('newItemProduct').value = '';
        document.getElementById('newItemQty').value    = '';
        document.getElementById('newItemPrice').value  = '';
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function autoFillNewItemPrice() {
    const name = document.getElementById('newItemProduct').value;
    const p = products.find(pr => pr.name === name);
    if (p) {
        document.getElementById('newItemPrice').value = p.price.toFixed(2);
        const qtyField = document.getElementById('newItemQty');
        if (p.unit === 'kg') qtyField.placeholder = 'кг, напр. 1.4';
        else if (p.unit === 'pcs') qtyField.placeholder = 'шт';
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
    const p = products.find(pr => pr.name === name);
    if (p) document.getElementById('editItemPrice').value = p.price.toFixed(2);
}

async function saveItemEdit() {
    suppressRealtimeFor3s();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order || editItemIdx === null) return;
    const productName = document.getElementById('editItemProduct').value;
    const quantity = parseFloat(document.getElementById('editItemQty').value);
    const price    = parseFloat(document.getElementById('editItemPrice').value);
    if (!productName || isNaN(quantity) || quantity <= 0 || isNaN(price)) {
        showInfo('Заполните все поля корректно!'); return;
    }
    const prod = products.find(p => p.name === productName);
    if (!prod) { showInfo('Изделие не найдено!'); return; }
    const item = order.items[editItemIdx];
    const oldDesc = `«${item.product}» × ${item.quantity}`;

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
        await db.from('order_item_ingredients').delete().eq('order_item_id', item.id);

        const itemCost = parseFloat((productUnitCost(prod) * quantity).toFixed(4));
        await updateChecked(db.from('order_items').update({
            product_id: prod.id, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost
        }).eq('id', item.id));
        order.items[editItemIdx] = { id: item.id, product_id: prod.id, product: prod.name, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost };

        // Новый снимок рецепта — нужен всегда, независимо от того, спишем ли склад сейчас
        await saveOrderItemIngredients(item.id, prod, quantity);
        if (!order.inventory_pending) {
            await writeOffInventoryForItem(prod, quantity, order.id, item.id);
        }

        renderDetailItems(order);
        closeModal();
        logActivity('item', `Изменена позиция в заказе №${order.id}: ${oldDesc} → «${prod.name}» × ${quantity}`, order.id);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

function deleteItem(itemIdx) {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const item = order.items[itemIdx];
    openDeleteModal(itemIdx, 'item', `позицию «${item.product}»`);
}

// ==================== ДЕТАЛИЗАЦИЯ СЕБЕСТОИМОСТИ ЗАКАЗА ====================
async function openOrderCostBreakdown() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    showLoading('Загружаю детализацию...');
    try {
        const orderItemIds = (order.items || []).map(it => it.id);
        if (!orderItemIds.length) { hideLoading(); await showInfo('В заказе нет позиций.'); return; }

        const { data, error } = await db
            .from('order_item_ingredients')
            .select('ingredient_name, quantity, unit, unit_price, total_cost')
            .in('order_item_id', orderItemIds);
        if (error) throw error;

        // Объединяем одинаковые ингредиенты по всему заказу
        const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
        const merged = {}; // key = ingredient_name
        (data || []).forEach(row => {
            const key = row.ingredient_name;
            if (!merged[key]) {
                merged[key] = { name: row.ingredient_name, qty: 0, unit: row.unit, unit_price: Number(row.unit_price), total: 0 };
            }
            merged[key].qty   += Number(row.quantity);
            merged[key].total += Number(row.total_cost);
        });

        const rows = Object.values(merged).sort((a, b) => b.total - a.total);
        const grandCost = order.items.reduce((s, it) => s + (it.item_cost != null ? Number(it.item_cost) : 0), 0);
        const grandIngCost = rows.reduce((s, r) => s + r.total, 0);

        if (!rows.length) {
            hideLoading();
            await showInfo('Детализация недоступна — рецепты не содержат прямых ингредиентов.');
            return;
        }

        let html = '<table class="w-full stats-table table-clean" style="table-layout:fixed;">';
        html += '<thead><tr style="background-color:#e3e8df;"><th class="p-1 text-xs text-left" style="width:40%;">Ингредиент</th><th class="p-1 text-xs text-right" style="width:20%;">Кол-во</th><th class="p-1 text-xs text-right" style="width:20%;">Цена/ед.</th><th class="p-1 text-xs text-right" style="width:20%;">Сумма</th></tr></thead><tbody>';
        rows.forEach(r => {
            const unitLabel = UNIT_LABELS[r.unit] || r.unit;
            html += `<tr class="border-b">
                <td class="p-0.5 table-text" style="word-break:break-word;">${escapeHtml(r.name)}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${r.qty.toFixed(2)} ${unitLabel}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${formatMoney(r.unit_price, 4)}</td>
                <td class="p-0.5 table-text text-right whitespace-nowrap">${formatMoney(r.total, 4)}</td>
            </tr>`;
        });
        html += `</tbody><tfoot><tr style="background-color:#e3e8df;" class="font-semibold">
            <td class="p-0.5 table-text" colspan="3">Итого себестоимость</td>
            <td class="p-0.5 table-text text-right">${grandCost > 0 ? formatMoney(grandCost) : formatMoney(grandIngCost)}</td>
        </tr></tfoot></table>`;

        document.getElementById('orderCostBreakdownSubtitle').textContent =
            `Заказ ${order.order_number || '#'+order.id} · ${formatDateDMY(order.date)} · ${escapeHtml(order.customer || '(без клиента)')}`;
        const content = document.getElementById('orderCostBreakdownContent');
        content.innerHTML = html;
        content.style.cssText = 'max-height:60vh; overflow-y:auto; touch-action:pan-y; overscroll-behavior:contain;';
        // Запрет pan-x для таблицы внутри (иначе глобальное правило блокирует вертикальный скролл)
        const table = content.querySelector('table');
        if (table) table.style.touchAction = 'pan-y';

        document.getElementById('orderCostBreakdownModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        await showInfo('Ошибка загрузки детализации. Проверьте подключение.');
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
        await db.from('order_item_ingredients').insert(rows);
    } catch (e) { console.error('Не удалось сохранить снимок рецепта:', e); }
}

// Пересчитывает снимок рецепта для текущего заказа по актуальному рецепту и ценам.
async function recalcOrderCostBreakdown() {
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;
    const ok = await showConfirm(
        'Пересчитать детализацию по актуальному рецепту и текущим ценам?\n\nСтарый снимок будет удалён и заменён новым.'
    );
    if (!ok) return;

    showLoading('Пересчитываю...');
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
        logActivity('order', `Пересчитана себестоимость заказа №${order.id} по актуальному рецепту`);
    } catch (e) {
        console.error(e);
        hideLoading();
        await showInfo('Ошибка пересчёта. Проверьте подключение.');
    }
}

function openEditOrderModal(i) {
    editIndex = i;
    const o = orders[i];
    document.getElementById('editOrderCustomer').value = o.customer;
    document.getElementById('editOrderDate').value   = o.date;
    document.getElementById('editOrderStatus').value = o.status;
    document.getElementById('editOrderModal').style.display = 'flex';
}

async function saveOrderEdit() {
    suppressRealtimeFor3s();
    const customerName = document.getElementById('editOrderCustomer').value;
    const date     = document.getElementById('editOrderDate').value;
    const status   = document.getElementById('editOrderStatus').value;
    if (!customerName || !date) { showInfo('Заполните все поля!'); return; }
    const cust = customers.find(c => c.name === customerName);
    if (!cust) { showInfo('Клиент не найден!'); return; }
    const order = orders[editIndex];
    const old = { customer: order.customer, date: order.date, status: order.status };

    showLoading();
    try {
        await updateChecked(db.from('orders').update({
            customer_id: cust.id, order_date: date, status
        }).eq('id', order.id));
        order.customer_id = cust.id;
        order.customer    = cust.name;
        order.date        = date;
        order.status      = status;
        displayOrders(); closeModal();
        const changes = [];
        if (old.customer !== order.customer) changes.push(`клиент «${old.customer}» → «${order.customer}»`);
        if (old.date !== order.date) changes.push(`дата ${formatDateDMY(old.date)} → ${formatDateDMY(order.date)}`);
        if (old.status !== order.status) changes.push(`статус «${old.status}» → «${order.status}»`);
        if (changes.length) logActivity('order', `Изменён заказ №${order.id}: ${changes.join(', ')}`, order.id);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}
