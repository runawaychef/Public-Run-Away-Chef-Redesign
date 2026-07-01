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
    // Блок "На сегодня и завтра"
    const today    = getLocalDateStr(0);
    const tomorrow = getLocalDateStr(1);
    const dayAfter = getLocalDateStr(2);
    const summaryEl = document.getElementById('todaySummary');
    const contentEl = document.getElementById('todaySummaryContent');

    function buildDaySummary(dayOrders, label) {
        if (!dayOrders.length) return '';
        const totalSum = dayOrders.reduce((s, o) => s + orderGrandTotal(o), 0);
        const totalQty = dayOrders.reduce((s, o) => s + (o.items || []).reduce((q, it) => q + Number(it.quantity || 0), 0), 0);
        // Подсчёт статусов
        const countPriniat  = dayOrders.filter(o => o.status === 'принят').length;
        const countVRabote  = dayOrders.filter(o => o.status === 'в работе').length;
        const countVypolnen = dayOrders.filter(o => o.status === 'выполнен').length;
        const statusLabel = '';

        // Разбивка по клиентам с изделиями — кликабельные строки
        let clientLines = '';
        dayOrders.forEach(o => {
            const clientQty = (o.items || []).reduce((q, it) => q + Number(it.quantity || 0), 0);
            const clientSum = orderGrandTotal(o);
            const statusColor = o.status === 'выполнен' ? '#22c55e' : o.status === 'в работе' ? '#d97706' : '#ef4444';
            const statusText  = o.status === 'выполнен' ? 'выполнен' : o.status === 'в работе' ? 'в работе' : 'принят';
            clientLines += `<div class="pl-1 mt-0.5 cursor-pointer hover:bg-indigo-50 rounded px-1 -mx-1 transition-colors" onclick="openOrderDetail(${o.id})">
                <span class="text-indigo-600 font-medium">${escapeHtml(o.customer || '(без клиента)')}:</span> ${clientQty} шт. · ${clientSum.toFixed(2)} € · <span style="color:${statusColor};font-weight:500">${statusText}</span>
            </div>`;
            (o.items || []).forEach(it => {
                clientLines += `<div class="pl-3 text-gray-500">· ${escapeHtml(it.product)} — ${it.quantity} шт.</div>`;
            });
        });

        return `<div class="mb-2 last:mb-0">
            <div class="font-semibold text-indigo-700 mb-0.5">${label}: ${dayOrders.length} зак. · ${totalQty} шт. · ${totalSum.toFixed(2)} €</div>
            ${clientLines}
        </div>`;
    }

    if (summaryEl && contentEl) {
        const todayOrders    = orders.filter(o => o.date === today);
        const tomorrowOrders = orders.filter(o => o.date === tomorrow);
        const dayAfterOrders = orders.filter(o => o.date === dayAfter);
        if (todayOrders.length || tomorrowOrders.length || dayAfterOrders.length) {
            contentEl.innerHTML =
                buildDaySummary(todayOrders, icon('clipboard') + 'Сегодня') +
                buildDaySummary(tomorrowOrders, icon('clipboard') + 'Завтра') +
                buildDaySummary(dayAfterOrders, icon('clipboard') + 'Послезавтра');
            summaryEl.classList.remove('hidden');
        } else {
            summaryEl.classList.add('hidden');
        }
    }
    const filteredOrders = getFilteredOrdersForList();
    const sorted = [...filteredOrders].sort((a, b) => new Date(b.date) - new Date(a.date));
    const tbody = document.getElementById('orderTableBody');
    tbody.innerHTML = '';

    let currentMonthKey = null; // 'YYYY-MM'
    let currentWeekKey  = null; // ISO date понедельника недели

    function localStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    function appendWeekSummary(weekKey) {
        const monday = new Date(weekKey + 'T00:00:00');
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        const weekTotals = calcGroupTotals(sorted, o => {
            const om = getMondayOf(new Date(o.date));
            return localStr(om) === weekKey;
        });
        const weekLabel = formatDateDMY(localStr(monday)) + ' – ' + formatDateDMY(localStr(sunday));
        const weekRow = document.createElement('tr');
        weekRow.innerHTML = `<td colspan="6" class="bg-gray-200 text-gray-700 text-xs font-medium p-0.5">
            Неделя ${weekLabel} — ${weekTotals.count} зак., ${weekTotals.qty} шт., ${weekTotals.sum.toFixed(2)} €
        </td>`;
        tbody.appendChild(weekRow);
    }

    function appendMonthSummary(monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        // Месяц объединяет все недели, чей понедельник попадает в этот месяц
        const monthTotals = calcGroupTotals(sorted, o => {
            const monday = getMondayOf(new Date(o.date));
            return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}` === monthKey;
        });
        const monthLabel = `${MONTH_NAMES_RU[m - 1]} ${y}`;
        const monthRow = document.createElement('tr');
        monthRow.innerHTML = `<td colspan="6" class="bg-gray-700 text-white text-xs font-semibold p-0.5.5">
            Итого за ${monthLabel} — ${monthTotals.count} зак., ${monthTotals.qty} шт., ${monthTotals.sum.toFixed(2)} €
        </td>`;
        tbody.appendChild(monthRow);
    }

    function appendSpacer() {
        const spacerRow = document.createElement('tr');
        spacerRow.innerHTML = `<td colspan="6" class="p-0.5.5 border-b border-gray-300"></td>`;
        tbody.appendChild(spacerRow);
    }

    sorted.forEach((order, idx) => {
        const orderDate = new Date(order.date);
        const monday = getMondayOf(orderDate);
        // Важно: НЕ toISOString() — она даёт UTC, что в UTC+3 сдвигает дату на день назад
        const weekKey = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
        // Месяц группы определяется по месяцу понедельника недели — недели не разбиваются
        const monthKey = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}`;

        const monthChanged = currentMonthKey !== null && monthKey !== currentMonthKey;
        const weekChanged  = currentWeekKey  !== null && weekKey  !== currentWeekKey;

        if (monthChanged || weekChanged) {
            // Закрываем текущую неделю
            appendWeekSummary(currentWeekKey);
            // Если поменялся месяц — закрываем и его, со спейсером
            if (monthChanged) {
                appendMonthSummary(currentMonthKey);
            }
            appendSpacer();
        }

        currentMonthKey = monthKey;
        currentWeekKey  = weekKey;

        const realIdx = orders.indexOf(order);
        const total = orderGrandTotal(order).toFixed(2);
        const itemsCount = order.items ? order.items.length : 0;
        let flagClass = 'flag';
        if (order.status === 'принят')    flagClass += ' flag-red';
        else if (order.status === 'в работе') flagClass += ' flag-yellow';
        else if (order.status === 'выполнен') flagClass += ' flag-green';

        // Статус оплаты — цветная точка рядом с суммой (не оплачен/частично/оплачен)
        const paidAmt = _orderPaidTotals[order.id] || 0;
        const grandAmt = Number(total);
        let payDotColor = 'bg-red-500', payDotTitle = 'Не оплачен';
        if (paidAmt > 0 && paidAmt < grandAmt) { payDotColor = 'bg-amber-400'; payDotTitle = 'Частично оплачен'; }
        else if (paidAmt >= grandAmt && grandAmt > 0) { payDotColor = 'bg-green-500'; payDotTitle = 'Оплачен'; }
        const payDot = `<span class="inline-block w-2 h-2 rounded-full ${payDotColor} mr-1" title="${payDotTitle}"></span>`;

        const isMerged = order.notes && order.notes.includes('⚠ объединён, требует проверки');
        const row = document.createElement('tr');
        row.className = 'order-row border-b' + (isMerged ? ' bg-red-50' : '');
        row.innerHTML = `
            <td class=" p-0.5 text-xs whitespace-nowrap${isMerged ? ' text-red-700 font-semibold' : ''}" onclick="openOrderDetail(${order.id})">${formatDateDMY(order.date)}${isMerged ? ' ⚠' : ''}</td>
            <td class=" p-0.5 text-xs" onclick="openOrderDetail(${order.id})">${escapeHtml(order.customer)}</td>
            <td class=" p-0.5 text-xs text-center" onclick="openOrderDetail(${order.id})">${itemsCount}</td>
            <td class=" p-0.5 text-xs font-medium" onclick="openOrderDetail(${order.id})">${payDot}${total}</td>
            <td class=" p-0.5 text-center" onclick="openOrderDetail(${order.id})"><span class="${flagClass}"></span></td>
            <td class=" p-0.5 text-center">
                ${hasPermission('can_delete') ? svgDelete(`openDeleteModal(${realIdx},'order','заказ клиента «${order.customer}»')`) : ''}
                ${svgCopy(`copyOrder(${realIdx})`)}
            </td>`;
        tbody.appendChild(row);
    });

    // Закрываем последнюю неделю и месяц
    if (currentWeekKey !== null) {
        appendWeekSummary(currentWeekKey);
        appendMonthSummary(currentMonthKey);
    }

    updateTotals(filteredOrders);
}

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

// ---- Фильтры списка заказов ----

let selectedOrderCustomers = []; // пусто = все клиенты

function getFilteredOrdersForList() {
    const dateRange = document.getElementById('orderDateRangeFilter') ? document.getElementById('orderDateRangeFilter').value : 'all';
    const dateFrom  = document.getElementById('orderDateFrom') ? document.getElementById('orderDateFrom').value : '';
    const dateTo    = document.getElementById('orderDateTo')   ? document.getElementById('orderDateTo').value   : '';
    const employeeFilter = document.getElementById('orderEmployeeFilter') ? document.getElementById('orderEmployeeFilter').value : '';
    let filtered = [...orders];
    if (selectedOrderCustomers.length > 0) filtered = filtered.filter(o => selectedOrderCustomers.includes(o.customer));
    if (employeeFilter) filtered = filtered.filter(o => String(o.employee_id) === employeeFilter);
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

function updateOrderCustomerFilter() {
    const list = document.getElementById('orderFilterList');
    if (!list) return;
    list.innerHTML = '';
    customers.sort((a,b)=>(a.name||"").localeCompare(b.name||"")).forEach(c => {
        const checked = selectedOrderCustomers.includes(c.name) ? 'checked' : '';
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 px-1 py-1 text-xs hover:bg-gray-50 rounded';
        label.innerHTML = `<input type="checkbox" value="${c.name}" onchange="onOrderCustomerFilterChange(this)" ${checked}> ${c.name}`;
        list.appendChild(label);
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
}

function toggleOrderFilterDropdown() {
    document.getElementById('orderFilterDropdown').classList.toggle('hidden');
}

function toggleAllOrderCustomersFilter(checkbox) {
    if (checkbox.checked) {
        selectedOrderCustomers = [];
        document.querySelectorAll('#orderFilterList input[type=checkbox]').forEach(cb => cb.checked = false);
    }
    updateOrderFilterLabel();
    displayOrders();
}

function onOrderCustomerFilterChange(checkbox) {
    if (checkbox.checked) {
        if (!selectedOrderCustomers.includes(checkbox.value)) selectedOrderCustomers.push(checkbox.value);
    } else {
        selectedOrderCustomers = selectedOrderCustomers.filter(n => n !== checkbox.value);
    }
    document.getElementById('orderFilterAll').checked = selectedOrderCustomers.length === 0;
    updateOrderFilterLabel();
    displayOrders();
}

function updateOrderFilterLabel() {
    const label = document.getElementById('orderFilterLabel');
    if (!label) return;
    if (selectedOrderCustomers.length === 0) {
        label.textContent = 'Все клиенты';
    } else if (selectedOrderCustomers.length === 1) {
        label.textContent = selectedOrderCustomers[0];
    } else {
        label.textContent = `Выбрано клиентов: ${selectedOrderCustomers.length}`;
    }
}

function toggleOrderDateRange() {
    const range = document.getElementById('orderDateRangeFilter').value;
    document.getElementById('orderCustomDateRange').classList.toggle('hidden', range !== 'custom');
}

function applyOrderFilter() {
    displayOrders();
}

// Закрытие выпадающего списка фильтра заказов по клику снаружи
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('orderFilterDropdown');
    const btn = document.getElementById('orderFilterBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
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
            items: []
        };
        orders.push(newOrder);
        _draftOrderIds.add(newOrder.id);
        displayOrders();
        openOrderDetail(newOrder.id);
        logActivity('order', `Создан черновик заказа №${newOrder.id}`, newOrder.id);
    } catch (e) { console.error(e); showInfo('Ошибка создания заказа. Проверьте подключение.'); }
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
            items: []
        };

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
        }

        orders.push(copy);
        displayOrders();
        openOrderDetail(copy.id);
        logActivity('order', `Скопирован заказ №${o.id} → новый заказ №${copy.id} (клиент «${o.customer}»)`, copy.id);
    } catch (e) { console.error(e); showInfo('Ошибка копирования заказа. Проверьте подключение.'); }
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

    const _oNum = order.order_number || `#${orderId}`;
    document.getElementById('detailOrderId').textContent = `Заказ ${_oNum}`;

    // Заполнить шапку
    fillDetailCustomerSelect(order.customer);
    document.getElementById('detailDate').value     = order.date;
    document.getElementById('detailStatus').value   = order.status;
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
        const { error } = await db.from('orders').update({ notes: newNotes }).eq('id', order.id);
        if (error) throw error;
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
            .select('id, customer_id, order_date, status, notes, deleted_at')
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
                html += `<tr class="border-b cursor-pointer hover:bg-gray-50 active:bg-gray-100"
                    onclick="openTrashOrderActions(${o.id}, '${escapeHtml(custName)}', '${orderDate}')">
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

function openTrashOrderActions(orderId, custName, orderDate) {
    const modal = document.getElementById('trashOrderActionsModal');
    const title = document.getElementById('trashOrderActionsTitle');
    const restoreBtn = document.getElementById('trashRestoreBtn');
    const deleteBtn  = document.getElementById('trashDeleteBtn');
    if (!modal) return;

    const _delNum = order.order_number || `#${orderId}`;
    title.textContent = `Заказ ${_delNum} · ${custName} · ${orderDate}`;

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
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { error } = await db.from('orders')
            .update({ deleted_at: null })
            .eq('id', orderId);
        if (error) throw error;
        closeModal();
        await loadAllData();
        logActivity('order', `Заказ №${orderId} восстановлен из корзины`);
        await showInfo(`Заказ №${orderId} восстановлен.`);
    } catch(e) { console.error(e); showInfo('Ошибка восстановления.'); }
    finally { hideLoading(); }
}

async function permanentDeleteOrder(orderId) {
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
        text += `• ${item.product} — ${item.quantity} × ${item.price.toFixed(2)} € = ${(item.quantity * item.price).toFixed(2)} €\n`;
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
        const { error } = await db.from('orders').update({
            customer_id: custId, order_date: date, status, discount, vat_exempt: vatExempt, employee_id: employeeId, notes
        }).eq('id', order.id);
        if (error) throw error;
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

        // Журнал: фиксируем только реально изменившиеся поля
        const changes = [];
        if (old.customer !== order.customer) changes.push(`клиент «${old.customer}» → «${order.customer}»`);
        if (old.date !== order.date) changes.push(`дата ${formatDateDMY(old.date)} → ${formatDateDMY(order.date)}`);
        if (old.status !== order.status) changes.push(`статус «${old.status}» → «${order.status}»`);
        if (old.discount !== order.discount) changes.push(`скидка ${old.discount}% → ${order.discount}%`);
        if ((old.employee || '') !== (order.employee || '')) changes.push(`исполнитель «${old.employee || '—'}» → «${order.employee || '—'}»`);
        if (old.notes !== order.notes) changes.push(`комментарий изменён`);
        if (changes.length) logActivity('order', `Изменён заказ №${order.id}: ${changes.join(', ')}`, order.id);
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
            const total = (item.quantity * item.price).toFixed(2);
            const prod = products.find(p => p.id === item.product_id);
            const unitLabel = prod && prod.unit ? (UNIT_PRODUCT_LABELS[prod.unit] || '') : '';
            const row = document.createElement('tr');
            row.className = 'border-b';
            row.innerHTML = `
                <td class="p-0.5 text-xs">${escapeHtml(item.product)}</td>
                <td class="p-0.5 text-xs text-center">${item.quantity}${unitLabel ? ' ' + unitLabel : ''}</td>
                <td class="p-0.5 text-xs text-center">${item.price.toFixed(2)}</td>
                <td class="p-0.5 text-xs text-center font-medium">${total}</td>
                <td class="p-0.5 text-center">
                    ${svgEdit(`openEditItemModal(${i})`)}
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
    document.getElementById('detailSubtotal').textContent     = subtotal.toFixed(2) + ' €';
    document.getElementById('detailDiscountPct').textContent  = discPct;
    document.getElementById('detailDiscountAmount').textContent = '-' + discAmt.toFixed(2) + ' €';
    document.getElementById('detailVatAmount').textContent    = vatAmt.toFixed(2) + ' €';
    document.getElementById('detailTotal').textContent        = grand.toFixed(2) + ' €';

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
    if (costEl) costEl.textContent = cost.toFixed(2) + ' €';
    if (profitEl) {
        profitEl.textContent = profit.toFixed(2) + ' €';
        profitEl.className = profit >= 0 ? 'font-semibold text-green-700' : 'font-semibold text-red-600';
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

        // Фиксируем снимок рецепта с ценами на момент создания позиции
        await saveOrderItemIngredients(data.id, prod, Number(data.quantity));
        await writeOffInventoryForItem(prod, Number(data.quantity), order.id);

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
        const itemCost = parseFloat((productUnitCost(prod) * quantity).toFixed(4));
        const { error } = await db.from('order_items').update({
            product_id: prod.id, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost
        }).eq('id', item.id);
        if (error) throw error;
        order.items[editItemIdx] = { id: item.id, product_id: prod.id, product: prod.name, quantity, price: parseFloat(price.toFixed(2)), item_cost: itemCost };
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

        let html = '<table class="w-full stats-table" style="table-layout:fixed;">';
        html += '<thead><tr class="bg-gray-100"><th class="p-1 text-left" style="width:40%;">Ингредиент</th><th class="p-1 text-right" style="width:20%;">Кол-во</th><th class="p-1 text-right" style="width:20%;">Цена/ед.</th><th class="p-1 text-right" style="width:20%;">Сумма</th></tr></thead><tbody>';
        rows.forEach(r => {
            const unitLabel = UNIT_LABELS[r.unit] || r.unit;
            html += `<tr class="border-b">
                <td class="p-0.5" style="word-break:break-word;">${escapeHtml(r.name)}</td>
                <td class="p-0.5 text-right whitespace-nowrap">${r.qty.toFixed(2)} ${unitLabel}</td>
                <td class="p-0.5 text-right whitespace-nowrap">${r.unit_price.toFixed(4)} €</td>
                <td class="p-0.5 text-right whitespace-nowrap">${r.total.toFixed(4)} €</td>
            </tr>`;
        });
        html += `</tbody><tfoot><tr class="bg-gray-50 font-semibold">
            <td class="p-0.5" colspan="3">Итого себестоимость</td>
            <td class="p-0.5 text-right">${grandCost > 0 ? grandCost.toFixed(2) : grandIngCost.toFixed(2)} €</td>
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
        total_cost:       parseFloat(r.total_cost.toFixed(4))
    }));
    rows = rows.map(r => ({ ...r, org_id: currentOrgId }));
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
                const { error } = await db.from('order_items').update({ item_cost: newCost }).eq('id', item.id);
                if (!error) item.item_cost = newCost;
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
        const { error } = await db.from('orders').update({
            customer_id: cust.id, order_date: date, status
        }).eq('id', order.id);
        if (error) throw error;
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
