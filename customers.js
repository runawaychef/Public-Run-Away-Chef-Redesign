// ==================== КЛИЕНТЫ ====================
// Список клиентов: отображение, добавление, редактирование (скидка, флажок «Без НДС»).
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), customers/orders (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// svgEdit/svgDelete, updateCustomerSelects, updateStatsCustomerFilter,
// updateOrderCustomerFilter, openDeleteModal, closeModal (главный скрипт).

// Если карточка клиента открыта кнопкой "Карточка клиента" из заказа (goToCustomerFromOrder
// в orders.js) — тут запоминается id этого заказа, чтобы закрытие карточки (кнопкой "Назад"
// в самой карточке или системной кнопкой "Назад" на Android) возвращало именно в заказ,
// а не в список клиентов. Сбрасывается при открытии карточки клиента любым другим путём.
let _customerOpenedFromOrderId = null;

// Заказы клиента с неоплаченным остатком — та же логика сопоставления, что и в
// customerDebt(); от неё же считается задолженность и счётчик на карточке.
function customerUnpaidOrders(c) {
    return orders.filter(o => {
        const matches = o.customer_id != null ? o.customer_id === c.id : o.customer === c.name;
        if (!matches) return false;
        const info = getOrderPaymentStatus(o);
        return (info.grandAmt - info.paidAmt) > 0.01;
    });
}

// «3 неоплаченных заказа» с правильным склонением (ru/uk/lt/en)
function unpaidOrdersLabel(n) {
    const m10 = n % 10, m100 = n % 100;
    let form;
    if (currentLang === 'en') form = n === 1 ? 1 : 5;
    else if (currentLang === 'lt') form = (m10 === 1 && m100 !== 11) ? 1 : (m10 >= 2 && m10 <= 9 && !(m100 >= 11 && m100 <= 19)) ? 2 : 5;
    else form = (m10 === 1 && m100 !== 11) ? 1 : (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) ? 2 : 5;
    return t('cust_unpaid_' + form).replace('{n}', n);
}

function customerDebt(c) {
    let debt = 0;
    orders.forEach(o => {
        const matches = o.customer_id != null ? o.customer_id === c.id : o.customer === c.name;
        if (!matches) return;
        const info = getOrderPaymentStatus(o);
        const owed = info.grandAmt - info.paidAmt;
        if (owed > 0.01) debt += owed;
    });
    return debt;
}

// Сумма всех покупок клиента за всё время — та же логика сопоставления
// заказов, что и в customerDebt() (учитывает и старые заказы, у которых
// клиент привязан по имени, а не по customer_id).
function customerTotalSpent(c) {
    let total = 0;
    orders.forEach(o => {
        const matches = o.customer_id != null ? o.customer_id === c.id : o.customer === c.name;
        if (matches) total += orderGrandTotal(o);
    });
    return total;
}

function displayCustomers() {
    // Сначала клиенты с задолженностью, потом остальные — внутри каждой
    // группы по алфавиту.
    customers.sort((a, b) => {
        const debtDiff = (customerDebt(b) > 0.01 ? 1 : 0) - (customerDebt(a) > 0.01 ? 1 : 0);
        return debtDiff !== 0 ? debtDiff : (a.name||"").localeCompare(b.name||"");
    });
    let warningCount = 0;
    customers.forEach(c => { if (!(c.name && c.name.trim())) warningCount++; });
    const warningEl = document.getElementById('customersNameWarning');
    if (warningEl) warningEl.classList.toggle('hidden', warningCount === 0);
    updateCustomerSelects();
    updateStatsCustomerFilter();
    updateOrderCustomerFilter();
    renderCustomerCards();
    filterCustomersList();
}

// ---- Карточный вид (тот же принцип, что у изделий) ----
function renderCustomerCards() {
    const body = document.getElementById('customerCardsBody');
    if (!body) return;
    let html = '';
    customers.forEach(c => {
        const hasName = !!(c.name && c.name.trim());
        const debt = customerDebt(c);
        const hasDebt = debt > 0.01;
        const unpaidCnt = hasDebt ? customerUnpaidOrders(c).length : 0;
        const stripe = !hasName || hasDebt ? `<div class="stripe" style="background:#c0685c;"></div>` : '';
        const nameText = hasName ? escapeHtml(c.name) : '(имя не указано)';
        const contactText = c.contact && c.contact.trim() ? escapeHtml(c.contact) : '—';
        const orderCnt = orders.filter(o => o.customer_id != null ? o.customer_id === c.id : o.customer === c.name).length;
        const tagList = [];
        if (c.entity_type === 'company' || c.entity_type === 'individual') tagList.push(`<span class="oc-tag">${t(c.entity_type === 'company' ? 'cust_tag_company' : 'cust_tag_individual')}</span>`);
        // Порядок меток (16.10): постоянные признаки (тип, НДС) → условия (скидка) → тревожные (красные) в конце
        if (c.vat_exempt) tagList.push(`<span class="oc-tag">${t('cust_tag_no_vat')}</span>`);
        if (Number(c.discount) > 0) tagList.push(`<span class="oc-tag">${t('cust_tag_discount').replace('{n}', Number(c.discount))}</span>`);
        { const memoTag = memoCustomerTagHtml(c.id); if (memoTag) tagList.push(memoTag); } // памятная дата скоро — перед тревожными
        if (unpaidCnt > 0) tagList.push(`<button type="button" class="oc-tag oc-tag-red" onclick="event.stopPropagation(); openCustomerUnpaidModal(${c.id})">${unpaidOrdersLabel(unpaidCnt)}</button>`);
        html += `
        <div class="order-card" data-name="${escapeHtml((c.name || '').toLowerCase())}" style="cursor:pointer;" onclick="openCustomerDetail(${c.id})">
            ${stripe}
            <div class="order-card-body">
                <div class="oc-name" style="${hasName ? '' : 'color:#a3493d;'}">${nameText}</div>
                <div class="oc-meta" style="margin-top:3px;">${contactText}</div>
                ${stockCardCellsHtml3(
                    [t('cust_cell_orders'), String(orderCnt), '#3c3a34'],
                    [t('cust_cell_total'), formatMoney(customerTotalSpent(c)), '#3c3a34'],
                    [t('cust_cell_debt'), hasDebt ? formatMoney(debt) : '—', hasDebt ? '#c0685c' : '#a29c8c'])}
                ${tagList.length ? `<div class="oc-tags">${tagList.join('')}</div>` : ''}
            </div>
        </div>`;
    });
    body.innerHTML = html;
}

// Три ячейки в серой плашке (тот же вид, что на складе)
function stockCardCellsHtml3(a, b, c) {
    const cell = (x, first) => `<div class="oc-cell${first ? '' : ' oc-cell-sep'}"><div class="oc-cell-lbl">${x[0]}</div><div class="oc-cell-val" style="color:${x[2]};">${x[1]}</div></div>`;
    return `<div class="oc-cells">${cell(a, true)}${cell(b, false)}${cell(c, false)}</div>`;
}

// Окно «Неоплаченные заказы клиента»: заказы сгруппированы по счетам
// (сводный счёт / счёт на один заказ / счёт не выставлен). Номера и даты счетов
// берём из того же списка, что и раздел «Документы» (_docsLoad).
function _unpaidOrderCardHtml(o, alsoInv, issueCol) {
    // Старое имя оставлено; теперь возвращает одну строку таблицы (см. _custOrdersTableHtml)
    return _custOrderRowHtml(o, 'goToOrderFromCustomerUnpaid', { alsoInv, showLeft: true, issueCol });
}

// Строка таблицы заказов клиента: № · Дата · Сумма (точка = оплата) · Статус.
// Та же вёрстка, что у таблицы «Заказы клиента» на странице клиента.
function _custOrderRowHtml(o, onTap, opts) {
    opts = opts || {};
    const statusFlag = { 'принят': 'flag-red', 'в работе': 'flag-yellow', 'выполнен': 'flag-green' };
    const oNum = o.order_number || `#${o.id}`;
    const pay = getOrderPaymentStatus(o);
    const amt = opts.showLeft ? Math.max(0, pay.grandAmt - pay.paidAmt) : pay.grandAmt;
    const cols = opts.issueCol ? 5 : 4;
    const issue = opts.issueCol
        ? `<td class="p-0.5 text-right"><span class="cu-issue-btn" onclick="event.stopPropagation(); openCustomerUnpaidIssue(${o.id})" title="${t('cust_unpaid_issue')}" aria-label="${t('cust_unpaid_issue')}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></svg></span></td>` : '';
    const also = opts.alsoInv
        ? `<tr class="border-b"><td colspan="${cols}" class="p-0.5" style="color:#96712a;font-size:11px;font-weight:600;">${t('cust_unpaid_also_inv').replace('{n}', escapeHtml(opts.alsoInv))}</td></tr>` : '';
    return `<tr class="border-b order-row" onclick="${onTap}(${o.id})">
        <td class="p-0.5 whitespace-nowrap">${escapeHtml(oNum)}</td>
        <td class="p-0.5">${formatDateDMY(o.date)}</td>
        <td class="p-0.5 text-right font-semibold"><span class="inline-block w-2 h-2 rounded-full mr-1" style="background-color:${getPaymentStripeColor(pay)};"></span>${amt.toFixed(2)}</td>
        <td class="p-0.5 text-center"><span class="flag ${statusFlag[o.status] || ''}"></span> ${escapeHtml(orderStatusLabel(o.status))}</td>${issue}
    </tr>${also}`;
}
function _custOrdersTableHtml(rowsHtml, issueCol) {
    const w = issueCol ? [25, 19, 22, 24, 10] : [28, 20, 26, 26];
    return '<table class="w-full table-text table-clean" style="table-layout:fixed;"><thead><tr class="text-xs" style="color:#8a8a82;">'
        + '<th class="p-1 text-left" style="width:' + w[0] + '%;">' + t('customers_col_number') + '</th>'
        + '<th class="p-1 text-left" style="width:' + w[1] + '%;">' + t('customers_col_date') + '</th>'
        + '<th class="p-1 text-right" style="width:' + w[2] + '%;">' + t('customers_col_sum') + '</th>'
        + '<th class="p-1 text-center" style="width:' + w[3] + '%;">' + t('customers_col_status') + '</th>'
        + (issueCol ? '<th style="width:' + w[4] + '%;"></th>' : '')
        + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
}

function _unpaidGroupHtml(opts) {
    const btn = opts.btnLabel
        ? `<button type="button" onclick="${opts.btnAction}" style="margin-top:4px; font-size:12px; font-weight:600; background:${opts.btnBg}; color:${opts.btnColor}; border:0; border-radius:999px; padding:4px 10px;">${opts.btnLabel}</button>` : '';
    return `
    <div style="${opts.boxStyle} border-radius:18px; padding:10px 10px 4px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:2px 4px 8px;">
            <div style="min-width:0;">
                <div style="font-size:14px; font-weight:700; color:${opts.titleColor};">${opts.title}</div>
                <div style="font-size:11.5px; color:#6b675d; margin-top:2px;">${opts.sub}</div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
                <div style="font-size:14px; font-weight:700; color:#c0685c;">${formatMoney(opts.total)}</div>
                ${btn}
            </div>
        </div>
        ${opts.cards}
    </div>`;
}

async function openCustomerUnpaidModal(custId) {
    const c = customers.find(x => x.id === custId);
    if (!c) return;
    const list = customerUnpaidOrders(c).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    showLoading();
    try {
        await _docsLoad();
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    const docByKey = {};
    _docsAll.forEach(d => { docByKey[d.key] = d; });
    const leftOf = o => { const i = getOrderPaymentStatus(o); return Math.max(0, i.grandAmt - i.paidAmt); };

    // Раскладываем заказы: сводный счёт → свой счёт → без счёта
    const groups = [];            // { key, doc, orders }
    const byKey = {};
    const noInv = [];
    list.forEach(o => {
        const consKey = o.consolidated_invoice_id ? 'cons-' + o.consolidated_invoice_id : null;
        const ownKey = 'inv-' + o.id;
        const key = consKey && docByKey[consKey] ? consKey : (docByKey[ownKey] ? ownKey : null);
        if (!key) { noInv.push(o); return; }
        if (!byKey[key]) { byKey[key] = { key, doc: docByKey[key], orders: [] }; groups.push(byKey[key]); }
        byKey[key].orders.push(o);
    });
    groups.sort((a, b) => String(a.doc.date).localeCompare(String(b.doc.date)));

    let html = '';
    groups.forEach(g => {
        const isCons = g.doc.kind === 'cons';
        html += _unpaidGroupHtml({
            boxStyle: 'background:#eef1ea;', titleColor: '#3f5a38',
            title: (isCons ? t('cust_unpaid_cons') + ' ' : t('cust_unpaid_inv') + ' ') + escapeHtml(g.doc.number || ''),
            sub: t('cust_unpaid_from').replace('{d}', formatDateDMY(g.doc.date)),
            total: g.orders.reduce((sum, o) => sum + leftOf(o), 0),
            btnLabel: t('cust_unpaid_open'), btnBg: '#7c9473', btnColor: '#fff',
            btnAction: `openCustomerUnpaidDoc(${custId}, '${g.key}')`,
            cards: _custOrdersTableHtml(g.orders.map(o => {
                const own = isCons ? docByKey['inv-' + o.id] : null;
                return _unpaidOrderCardHtml(o, own ? own.number : '');
            }).join('')),
        });
    });
    if (noInv.length) {
        html += _unpaidGroupHtml({
            boxStyle: 'background:#f6f4ec; border:1px dashed #d9d3c0;', titleColor: '#6b675d',
            title: t('cust_unpaid_none'), sub: t('cust_unpaid_none_sub'),
            total: noInv.reduce((sum, o) => sum + leftOf(o), 0),
            btnLabel: '',
            cards: _custOrdersTableHtml(noInv.map(o => _unpaidOrderCardHtml(o, '', true)).join(''), true),
        });
    }
    document.getElementById('customerUnpaidTitle').textContent = t('cust_unpaid_title');
    document.getElementById('customerUnpaidSub').textContent = (c.name || '') + ' · ' + formatMoney(list.reduce((sum, o) => sum + leftOf(o), 0));
    document.getElementById('customerUnpaidBody').innerHTML = html;
    document.getElementById('customerUnpaidModal').style.display = 'flex';
}

// Открыть счёт из окна: предпросмотр документа в разделе «Документы»
// (кнопка «Закрыть» вернёт в список документов этого клиента)
async function openCustomerUnpaidDoc(custId, key) {
    document.getElementById('customerUnpaidModal').style.display = 'none';
    _docsFilter = { type: 'inv', custId, year: null, month: null, pay: '', q: '' };
    _docsOldOpen = false;
    await openRegistryDoc(key);
}

function openCustomerUnpaidIssue(orderId) {
    document.getElementById('customerUnpaidModal').style.display = 'none';
    openSendDocumentSheet(orderId, 'invoice');
}

function goToOrderFromCustomerUnpaid(orderId) {
    document.getElementById('customerUnpaidModal').style.display = 'none';
    goToOrderFromCustomer(orderId);
}

// ---- Поиск по имени ----
function filterCustomersList() {
    const input = document.getElementById('customerSearchInput');
    const q = input ? input.value.trim().toLowerCase() : '';
    document.getElementById('customerSearchClear')?.classList.toggle('hidden', !q);
    document.getElementById('customerSearchIcon')?.classList.toggle('hidden', !!q);

    let visibleCards = 0;
    document.querySelectorAll('#customerCardsBody .order-card').forEach(card => {
        const match = !q || card.dataset.name.includes(q);
        card.style.display = match ? 'flex' : 'none';
        if (match) visibleCards++;
    });
    document.getElementById('customerCardsEmpty')?.classList.toggle('hidden', visibleCards !== 0);

}

function clearCustomerSearch() {
    const input = document.getElementById('customerSearchInput');
    if (input) input.value = '';
    filterCustomersList();
}

// Кнопка "+": сразу создаёт черновик клиента и открывает его карточку
let _draftCustomerIds = new Set();

async function createDraftCustomerAndOpen() {
    suppressRealtimeFor3s();
    showLoading();
    try {
        const { data, error } = await db.from('customers').insert({ org_id: currentOrgId, name: '', contact: '', discount: 0, vat_exempt: false }).select().single();
        if (error) throw error;
        const newCust = { id: data.id, name: '', contact: '', discount: 0, vat_exempt: false };
        customers.push(newCust);
        _draftCustomerIds.add(newCust.id);
        displayCustomers();
        openCustomerDetail(newCust.id);
        logActivity('customer', `${t('log_customer_draft_created')} №${newCust.id}`);
    } catch (e) { console.error(e); showDbError(e, 'Ошибка создания клиента. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function cleanupCustomerDraftIfEmpty(custId) {
    if (!_draftCustomerIds.has(custId)) return;
    _draftCustomerIds.delete(custId);
    const idx = customers.findIndex(c => c.id === custId);
    if (idx === -1) return;
    if (customers[idx].name && customers[idx].name.trim()) return; // имя вписали — это уже не пустой черновик
    // Убираем из локального списка сразу, не дожидаясь сервера; ошибку удаления проверяем
    // (supabase-js её не бросает, а возвращает) — иначе брошенный черновик оставался в базе молча.
    customers.splice(idx, 1);
    suppressRealtimeFor3s();
    try {
        const { error } = await db.from('customers').delete().eq('id', custId);
        if (error) throw error;
    } catch (e) { console.error('Не удалось удалить пустой черновик клиента (будет убран при следующем запуске):', e); }
}

// Страховка на случай, когда приложение убили на карточке нового клиента: список
// _draftCustomerIds живёт только в памяти, и пустая запись оставалась в базе.
// Вызывается один раз после первой загрузки данных. Удаляем только записи, где
// ВСЁ пусто и нет ни одного заказа — клиентов без имени, но с данными или заказами не трогаем.
async function cleanupAbandonedCustomerDrafts() {
    try {
        const blank = v => !(v && String(v).trim());
        const withOrders = new Set((orders || []).map(o => o.customer_id).filter(x => x != null));
        const stale = customers.filter(c =>
            blank(c.name) && blank(c.contact) && blank(c.email) && blank(c.address) && blank(c.notes) &&
            blank(c.reg_number) && blank(c.vat_code) && blank(c.personal_code) &&
            !Number(c.discount) && !c.vat_exempt &&
            !withOrders.has(c.id) && c.id !== currentCustomerId && !_draftCustomerIds.has(c.id));
        for (const c of stale) {
            const { error } = await db.from('customers').delete().eq('id', c.id);
            if (error) { console.error('Не удалось удалить брошенный черновик клиента:', error); continue; }
            const idx = customers.findIndex(x => x.id === c.id);
            if (idx !== -1) customers.splice(idx, 1);
        }
        if (stale.length) displayCustomers();
    } catch (e) { console.error('cleanupAbandonedCustomerDrafts:', e); }
}

// Массово проставляет текущий НДС-статус клиента во ВСЕХ его существующих заказах.
// Разовое действие по явному запросу — НДС-статус заказа сам по себе не меняется
// задним числом автоматически при смене статуса клиента (см. saveCdHeader).
async function applyVatExemptToAllOrders() {
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;

    const custOrders = orders.filter(o => o.customer_id === cust.id);
    const toUpdate = custOrders.filter(o => !!o.vat_exempt !== !!cust.vat_exempt);

    if (!toUpdate.length) {
        await showInfo(t('customers_vat_already_matches'));
        return;
    }

    const statusLabel = cust.vat_exempt ? t('customers_vat_status_exempt') : t('customers_vat_status_included');
    const orderWord = toUpdate.length === 1 ? t('customers_order_word_one') : t('customers_order_word_many');
    const ok = await showConfirm(`${t('customers_apply_vat_confirm_prefix')} ${statusLabel} ${t('common_to')} ${toUpdate.length} ${orderWord} ${t('customers_of_customer')} «${cust.name}»?\n${t('customers_apply_vat_confirm_suffix')}`);
    if (!ok) return;

    showLoading();
    try {
        const ids = toUpdate.map(o => o.id);
        await updateChecked(db.from('orders').update({ vat_exempt: cust.vat_exempt }).in('id', ids));
        toUpdate.forEach(o => { o.vat_exempt = cust.vat_exempt; });
        logActivity('customer', `${t('log_vat_status_applied')} ${statusLabel} ${t('common_to')} ${toUpdate.length} ${t('customers_order_word_many')} ${t('customers_of_customer')} «${cust.name}»`);
        renderCustomerStats(cust);
        renderCustomerOrders();
        await showInfo(`${t('common_done')}: ${t('customers_orders_updated')} — ${toUpdate.length}.`);
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// Возвращает заказы клиента, отфильтрованные по выбранному в карточке периоду
// (тот же фильтр, что используется для списка заказов клиента).
function getCustomerOrdersForRange(cust) {
    const range = document.getElementById('cdDateRange').value;
    let custOrders = orders.filter(o => o.customer_id === cust.id);
    if (range === 'week' || range === 'month' || range === 'year') {
        const today = orgNowDate();
        let start;
        if (range === 'week') {
            start = getCurrentWeekStart();
        } else if (range === 'year') {
            start = new Date(today.getFullYear(), 0, 1);
        } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        custOrders = custOrders.filter(o => new Date(o.date) >= start);
    } else if (range === 'custom') {
        const from = document.getElementById('cdDateFrom') ? document.getElementById('cdDateFrom').value : '';
        const to   = document.getElementById('cdDateTo')   ? document.getElementById('cdDateTo').value   : '';
        if (from) custOrders = custOrders.filter(o => o.date >= from);
        if (to)   custOrders = custOrders.filter(o => o.date <= to);
    }
    return { range, custOrders };
}

function rangeLabel(range) {
    const map = { all: 'stats_range_all', week: 'stats_range_week', month: 'stats_range_month', year: 'stats_range_year', custom: 'stats_range_custom' };
    return t(map[range] || 'stats_range_all');
}

// ==================== СВОДНЫЙ ОТЧЁТ ПО ИЗДЕЛИЯМ ЗА ПЕРИОД ====================
function openCustomerReportPreview() {
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;
    const { range, custOrders } = getCustomerOrdersForRange(cust);

    if (!custOrders.length) {
        showInfo(t('customers_no_orders_for_report'));
        return;
    }

    // Сводим количество и сумму по каждому изделию за период
    const byProduct = {}; // name -> { qty, sum }
    custOrders.forEach(o => {
        (o.items || []).forEach(it => {
            if (!byProduct[it.product]) byProduct[it.product] = { qty: 0, sum: 0 };
            byProduct[it.product].qty += Number(it.quantity) || 0;
            byProduct[it.product].sum += (Number(it.quantity) || 0) * (Number(it.price) || 0);
        });
    });
    const rows = Object.entries(byProduct).sort((a, b) => b[1].sum - a[1].sum);
    const totalSum = rows.reduce((s, [, v]) => s + v.sum, 0);
    const totalQty = rows.reduce((s, [, v]) => s + v.qty, 0);

    // Финансовая сводка по заказам периода: скидка и НДС считаются по каждому
    // заказу отдельно (у каждого может быть своя скидка/статус НДС) и суммируются.
    const totalDiscount = custOrders.reduce((s, o) => s + orderDiscountAmount(o), 0);
    const totalVat = custOrders.reduce((s, o) => s + orderVatAmount(o), 0);
    const grandTotal = custOrders.reduce((s, o) => s + orderGrandTotal(o), 0);
    const discountPercents = [...new Set(custOrders.map(o => o.discount || 0).filter(d => d > 0))];
    const discountLabel = discountPercents.length === 1 ? ` (${discountPercents[0]}%)` : discountPercents.length > 1 ? ` (${t('customers_discount_varies')})` : '';

    // Диапазон дат для заголовка
    const dates = custOrders.map(o => o.date).sort();
    const periodLabel = dates.length
        ? (dates[0] === dates[dates.length-1] ? formatDateDMY(dates[0]) : `${formatDateDMY(dates[0])} – ${formatDateDMY(dates[dates.length-1])}`)
        : rangeLabel(range);

    let html = `
        <div style="padding:6px;">
            <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 2px;">${escapeHtml(cust.name)}</h2>
            <p style="font-size:11px;color:#6b7280;margin:0 0 12px;">${t('customers_report_title')} · ${rangeLabel(range)} (${periodLabel})</p>
            <table class="table-clean" style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px;">
                <thead><tr style="background:#e3e8df;">
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #e5e7eb;">${t('stats_col_product')}</th>
                    <th style="text-align:right;padding:4px;border-bottom:1px solid #e5e7eb;">${t('inv_col_quantity')}</th>
                    <th style="text-align:right;padding:4px;border-bottom:1px solid #e5e7eb;">${t('stats_col_sum')} (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency})</th>
                </tr></thead><tbody>`;
    rows.forEach(([name, v]) => {
        html += `<tr><td style="padding:4px;border-bottom:1px solid #f3f4f6;">${escapeHtml(name)}</td><td style="text-align:right;padding:4px;border-bottom:1px solid #f3f4f6;">${v.qty}</td><td style="text-align:right;padding:4px;border-bottom:1px solid #f3f4f6;">${v.sum.toFixed(2)}</td></tr>`;
    });
    html += `</tbody>
            <tfoot><tr style="font-weight:700;background:#e3e8df;">
                <td style="padding:4px;">${t('stats_col_total')}</td>
                <td style="text-align:right;padding:4px;">${totalQty}</td>
                <td style="text-align:right;padding:4px;">${totalSum.toFixed(2)}</td>
            </tr></tfoot>
            </table>
            <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-top:10px;">
                <tr><td style="padding:2px 4px;color:#6b7280;">${t('customers_sum_by_items')}</td><td style="text-align:right;padding:2px 4px;">${formatMoney(totalSum)}</td></tr>
                ${totalDiscount > 0 ? `<tr><td style="padding:2px 4px;color:#6b7280;">${t('customers_discount_word')}${discountLabel}</td><td style="text-align:right;padding:2px 4px;color:#c0685c;">−${formatMoney(totalDiscount)}</td></tr>` : ''}
                <tr><td style="padding:2px 4px;color:#6b7280;">${t('customers_vat_word')} (21%)</td><td style="text-align:right;padding:2px 4px;color:#6b7280;">${formatMoney(totalVat)}</td></tr>
                <tr style="font-weight:700;"><td style="padding:4px;border-top:1px solid #e5e7eb;">${t('customers_total_due')}</td><td style="text-align:right;padding:4px;border-top:1px solid #e5e7eb;">${formatMoney(grandTotal)}</td></tr>
            </table>
            <p style="font-size:10px;color:#9ca3af;margin-top:10px;">${t('customers_orders_in_period')}: ${custOrders.length}. ${t('customers_report_footnote')}</p>
        </div>`;

    document.getElementById('customerReportContent').innerHTML = html;
    document.querySelectorAll('#customerReportContent table').forEach(t => t.style.touchAction = 'pan-y');
    document.getElementById('customerReportModal').style.display = 'flex';
}

let _reportPdfInProgress = false;

async function downloadCustomerReportPdf() {
    if (_reportPdfInProgress) return; // защита от повторных нажатий, пока идёт обработка
    _reportPdfInProgress = true;
    const btn = document.getElementById('downloadReportPdfBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = t('customers_pdf_generating_btn'); }

    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) { _reportPdfInProgress = false; if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + t('customers_download_pdf_btn'); } return; }
    const { range, custOrders } = getCustomerOrdersForRange(cust);
    if (!custOrders.length) { _reportPdfInProgress = false; if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + t('customers_download_pdf_btn'); } return; }

    const dates = custOrders.map(o => o.date).sort();
    const periodTag = dates.length
        ? (dates[0] === dates[dates.length-1] ? dates[0] : `${dates[0]}_${dates[dates.length-1]}`)
        : range;
    const safeName = cust.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || t('customers_fallback_name');
    const filename = `${safeName}_${periodTag}.pdf`;
    const periodLabel = dates.length
        ? (dates[0] === dates[dates.length-1] ? formatDateDMY(dates[0]) : `${formatDateDMY(dates[0])} – ${formatDateDMY(dates[dates.length-1])}`)
        : rangeLabel(range);

    // Пересчитываем те же данные, что и в предпросмотре — их не храним отдельно
    // между открытием попапа и нажатием "Скачать", чтобы не рассинхронизироваться,
    // если пользователь успел что-то поменять в заказах, пока попап был открыт.
    const byProduct = {};
    custOrders.forEach(o => {
        (o.items || []).forEach(it => {
            if (!byProduct[it.product]) byProduct[it.product] = { qty: 0, sum: 0 };
            byProduct[it.product].qty += Number(it.quantity) || 0;
            byProduct[it.product].sum += (Number(it.quantity) || 0) * (Number(it.price) || 0);
        });
    });
    const rows = Object.entries(byProduct).sort((a, b) => b[1].sum - a[1].sum);
    const totalSum = rows.reduce((s, [, v]) => s + v.sum, 0);
    const totalQty = rows.reduce((s, [, v]) => s + v.qty, 0);
    const totalDiscount = custOrders.reduce((s, o) => s + orderDiscountAmount(o), 0);
    const totalVat = custOrders.reduce((s, o) => s + orderVatAmount(o), 0);
    const grandTotal = custOrders.reduce((s, o) => s + orderGrandTotal(o), 0);
    const discountPercents = [...new Set(custOrders.map(o => o.discount || 0).filter(d => d > 0))];
    const discountLabel = discountPercents.length === 1 ? ` (${discountPercents[0]}%)` : discountPercents.length > 1 ? ` (${t('customers_discount_varies')})` : '';
    const sym = CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency;

    showLoading(t('customers_pdf_generating'));
    try {
        const pdf = await createPdfDoc();
        const pageW = pdf.internal.pageSize.getWidth();
        const marginX = 14;

        pdf.setFontSize(15); pdf.setFont('Roboto', 'bold');
        pdf.text(cust.name, marginX, 18);
        pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(`${t('customers_report_title')} · ${rangeLabel(range)} (${periodLabel})`, marginX, 24);
        pdf.setTextColor(...PDF_COLORS.textDark);

        pdf.autoTable({
            startY: 30,
            margin: { left: marginX, right: marginX },
            head: [[t('stats_col_product'), t('inv_col_quantity'), `${t('stats_col_sum')} (${sym})`]],
            body: rows.map(([name, v]) => [name, String(v.qty), v.sum.toFixed(2)]),
            foot: [[t('stats_col_total'), String(totalQty), totalSum.toFixed(2)]],
            headStyles: PDF_TABLE_HEAD_STYLE,
            footStyles: { fillColor: PDF_COLORS.sageLight, textColor: PDF_COLORS.textDark, fontStyle: 'bold', font: 'Roboto' },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
            styles: { fontSize: 10, cellPadding: 2.5, font: 'Roboto' },
        });

        let y = pdf.lastAutoTable.finalY + 8;
        const summaryRows = [[t('customers_sum_by_items'), formatMoney(totalSum)]];
        if (totalDiscount > 0) summaryRows.push([`${t('customers_discount_word')}${discountLabel}`, '−' + formatMoney(totalDiscount)]);
        summaryRows.push([`${t('customers_vat_word')} (21%)`, formatMoney(totalVat)]);

        pdf.autoTable({
            startY: y,
            margin: { left: marginX, right: marginX },
            body: summaryRows,
            styles: { fontSize: 10, cellPadding: 1.5, textColor: PDF_COLORS.textGray, font: 'Roboto' },
            columnStyles: { 1: { halign: 'right', textColor: PDF_COLORS.textDark } },
            theme: 'plain',
        });
        y = pdf.lastAutoTable.finalY + 2;
        pdf.setDrawColor(229, 231, 235); pdf.line(marginX, y, pageW - marginX, y);
        y += 6;
        pdf.setFontSize(12); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
        pdf.text(t('customers_total_due'), marginX, y);
        pdf.text(formatMoney(grandTotal), pageW - marginX, y, { align: 'right' });

        y += 10;
        pdf.setFontSize(8.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(`${t('customers_orders_in_period')}: ${custOrders.length}. ${t('customers_report_footnote')}`, marginX, y, { maxWidth: pageW - marginX * 2 });

        await pdfSaveOrShare(pdf, filename);
    } catch (e) {
        console.error(e);
        showInfo(t('customers_pdf_error_prefix') + (e && e.message ? e.message : t('customers_pdf_error_unknown')) + t('customers_pdf_error_suffix'));
    }
    finally {
        hideLoading();
        _reportPdfInProgress = false;
        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + t('customers_download_pdf_btn'); }
    }
}

// ==================== КАРТОЧКА КЛИЕНТА ====================
function openCustomerDetail(custId) {
    currentCustomerId = custId;
    _customerOpenedFromOrderId = null; // сбрасываем — goToCustomerFromOrder выставит заново, если переход именно оттуда
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;

    document.getElementById('customersList').classList.add('hidden');
    document.getElementById('customerDetail').classList.add('active');
    document.getElementById('customerDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('customerDetail').classList.remove('fade-in'), 300);
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('customersSearchBar', 'customersList', 'customerDetail');

    document.getElementById('cdName').value = cust.name;
    document.getElementById('cdContact').value = cust.contact;
    document.getElementById('cdEmail').value = cust.email || '';
    document.getElementById('cdDiscount').value = cust.discount.toFixed(2);
    document.getElementById('cdVatExempt').checked = !!cust.vat_exempt;
    document.getElementById('cdNotes').value = cust.notes || '';
    document.getElementById('cdDateRange').value = 'all';
    document.getElementById('cdDateRangeBtnLabel').textContent = t('stats_range_all');
    document.querySelectorAll('#cdDateRangeDropdown .status-option').forEach((opt, i) => opt.classList.toggle('selected', i === 0));
    document.getElementById('cdCustomDateRange').classList.add('hidden');
    document.getElementById('cdDateFrom').value = '';
    document.getElementById('cdDateTo').value = '';
    document.getElementById('cdAddress').value = cust.address || '';
    document.getElementById('cdRegNumber').value = cust.reg_number || '';
    document.getElementById('cdVatCode').value = cust.vat_code || '';
    document.getElementById('cdPersonalCode').value = cust.personal_code || '';
    document.getElementById('cdPaymentTermDays').value = cust.payment_term_days != null ? cust.payment_term_days : '';
    setCustomerEntityType(cust.entity_type || 'company', /*skipSave*/ true);
    // Реквизиты раскрыты, пока тип лица не выбран (новый клиент); дальше — свёрнуты в строку-итог
    _cdSetRequisitesOpen(!cust.entity_type);
    _cdRenderRequisitesSummary(cust);

    renderCustomerStats(cust);
    renderCustomerOrders();
    refreshFab();
}

// ---- Страница клиента (16.10): блок «Реквизиты и НДС», сводка, заказы ----
function _cdSetRequisitesOpen(open) {
    document.getElementById('cdReqBody')?.classList.toggle('hidden', !open);
    document.getElementById('cdReqBlock')?.classList.toggle('open', !!open);
}
function toggleCdRequisites() {
    const body = document.getElementById('cdReqBody');
    if (body) _cdSetRequisitesOpen(body.classList.contains('hidden'));
}
function _cdRenderRequisitesSummary(cust) {
    const el = document.getElementById('cdReqSummary');
    if (!el || !cust) return;
    const parts = [];
    parts.push(cust.entity_type ? t(cust.entity_type === 'company' ? 'company_entity_company' : 'company_entity_individual') : t('cust_req_type_unset'));
    parts.push(t(cust.vat_exempt ? 'cust_tag_no_vat' : 'cust_req_with_vat'));
    const term = Number(cust.payment_term_days) || 0;
    parts.push(term > 0 ? t('cust_req_term').replace('{n}', term) : t('cust_req_no_term'));
    el.textContent = parts.join(' · ');
}
// ---- Календарь клиента (16.10, шаг 1): то же окно, что в «Заказах», только заказы этого клиента,
// фильтр по мастеру (кто выполнил заказ), нажатие на день — окно дня. Памятные даты — шаг 2.
let _cdCalMaster = 'all';
function _cdCalOrders() {
    return orders.filter(o => o.customer_id === currentCustomerId
        && (typeof isOrderVisible !== 'function' || isOrderVisible(o))
        && (_cdCalMaster === 'all' || String(o.employee_id) === String(_cdCalMaster)));
}
function customerOrderBadgeForDay(y, m, d) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOrders = _cdCalOrders().filter(o => o.date === iso);
    const memos = memoDatesForDay(currentCustomerId, y, m + 1, d);
    const memo = memos.length ? (memos.some(x => !x.past) ? MEMO_GOLD : MEMO_GREY) : null;
    if (!dayOrders.length) return memo ? { memo } : null;
    if (dayOrders.length <= 3) return { dots: dayOrders.map(orderSeverityColor), memo };
    const priority = ['#8b3a3a', '#c0685c', '#d9a441', '#7c9473'];
    const colors = dayOrders.map(orderSeverityColor);
    return { count: dayOrders.length, color: priority.find(p => colors.includes(p)) || '#7c9473', memo };
}
// Строка «Все мастера / имена» — только если заказы клиента выполняли хотя бы два разных мастера
function _cdCalMasterHtml() {
    const ids = [...new Set(orders.filter(o => o.customer_id === currentCustomerId && o.employee_id != null).map(o => String(o.employee_id)))];
    const list = ids.map(id => employees.find(e => String(e.id) === id)).filter(Boolean)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (list.length < 2) return '';
    const pill = (id, label) => `<button type="button" class="cal-master-pill${String(_cdCalMaster) === String(id) ? ' on' : ''}" onclick="setCdCalMaster('${id}')">${escapeHtml(label)}</button>`;
    return `<div class="cal-master-row">${pill('all', t('cust_cal_all_masters'))}${list.map(e => pill(e.id, e.name)).join('')}</div>`;
}
function setCdCalMaster(id) {
    _cdCalMaster = id;
    renderCalendarPopup('globalCalendarPopup');
}
async function openCustomerCalendar(keepMonthIso) {
    if (typeof event !== 'undefined' && event) event.stopPropagation();
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;
    await loadMemoDates();
    const tmp = document.getElementById('cdCalTempDate');
    if (tmp) tmp.value = keepMonthIso || '';
    toggleCustomCalendar('globalCalendarPopup', 'cdCalTempDate', 'cdCalTempLabel', {
        onPick: onCustomerCalDayPicked,
        badge: customerOrderBadgeForDay,
        subtitle: cust.name || '',
        extraHtml: _cdCalMasterHtml,
    });
}
// Окно дня: заказы клиента на этот день (с учётом фильтра по мастеру) и «+ Заказ на этот день»
let _cdDayIso = null;
function onCustomerCalDayPicked(iso) {
    if (!iso) return;
    _cdDayIso = iso;
    const dayOrders = _cdCalOrders().filter(o => o.date === iso);
    const d = new Date(iso + 'T00:00:00');
    document.getElementById('customerDayTitle').textContent = formatDateDMY(iso) + ', ' + calWeekdays()[(d.getDay() + 6) % 7].toLowerCase();
    const memos = memoDatesForDay(currentCustomerId, d.getFullYear(), d.getMonth() + 1, d.getDate());
    document.getElementById('customerDayMemo').innerHTML = memos.length
        ? `<div class="memo-day-box">${memos.map(x => _memoItemHtml(x.m, { past: x.past, onTap: `openMemoEdit(${x.m.id}, 'day')`, whenHtml: `<span style="color:#4f6349;font-weight:600;">${t('memo_edit')}</span>` })).join('')}</div>` : '';
    document.getElementById('customerDayAddMemoBtn').style.display = memos.length ? 'none' : '';
    const body = document.getElementById('customerDayBody');
    body.innerHTML = dayOrders.length ? _custOrdersTableHtml(dayOrders.map(_cdDayOrderHtml).join(''))
        : `<p class="text-xs text-gray-400" style="margin:4px 0 8px;">${t('cust_day_no_orders')}</p>`;
    document.getElementById('customerDayModal').style.display = 'flex';
}
function _cdDayOrderHtml(o) {
    return _custOrderRowHtml(o, 'goToOrderFromCustomerDay');
}
function closeCustomerDay() { document.getElementById('customerDayModal').style.display = 'none'; }
function goToOrderFromCustomerDay(orderId) { closeCustomerDay(); goToOrderFromCustomer(orderId); }
function backToCustomerCalendar() { closeCustomerDay(); openCustomerCalendar(_cdDayIso); }
async function createOrderForCustomerDay() {
    const cust = customers.find(c => c.id === currentCustomerId);
    const iso = _cdDayIso;
    if (!cust || !iso) return;
    closeCustomerDay();
    showTab('orders');
    await createDraftOrderAndOpen();
    if (typeof calSetFieldValue === 'function') calSetFieldValue('detailDate', 'detailDateBtnLabel', iso);
    await attachCustomerToOrder(cust); // сохраняет шапку заказа вместе с датой
}
function addMemoForCustomerDay() {
    const d = new Date(_cdDayIso + 'T00:00:00');
    closeCustomerDay();
    openMemoEdit(null, 'day', { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
}

// ===== Памятные даты клиента (17.10) =====
// Таблица customer_memo_dates: день+месяц, год по желанию, «каждый год / один раз», заметка.
// Значок в календаре — золотое сердечко; прошедшая разовая дата — серое (в списке скрыта).
const MEMO_GOLD = '#c9973a';
const MEMO_GREY = '#c4beb0';
// «Скоро» = в пределах N дней; N — общее для пекарни (organizations.memo_remind_days, 1–30)
function memoRemindDays() { return (typeof currentOrgMemoRemindDays !== 'undefined' && currentOrgMemoRemindDays) || 7; }
let memoDates = [];
let _memoLoaded = null;      // org_id, для которой загружены даты
let _memoEditId = null;      // null — новая дата
let _memoReturn = null;      // 'list' | 'day' — куда вернуться после сохранения
let _memoYearly = true;

async function loadMemoDates(force) {
    if (_memoLoaded === currentOrgId && !force) return;
    const { data, error } = await db.from('customer_memo_dates').select('*').eq('org_id', currentOrgId);
    if (error) { console.error(error); return; }
    memoDates = data || [];
    _memoLoaded = currentOrgId;
    memoRefreshViews();
}

// ===== Напоминания (шаг 3, 17.10): метка в карточке клиента и баннер в «Заказах» =====
// Ближайшие даты в пределах N дней: [{ m, next, n }], по возрастанию
function memoUpcoming(custId) {
    const max = memoRemindDays();
    return memoDates.filter(m => custId == null || m.customer_id === custId)
        .map(m => { const next = memoNextDate(m); return { m, next, n: next ? memoDaysLeft(next) : -1 }; })
        .filter(x => x.next && x.n >= 0 && x.n <= max)
        .sort((a, b) => a.n - b.n || a.m.title.localeCompare(b.m.title));
}
function _memoCap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
// «Сегодня» / «Завтра» / «22.10»
function memoShortWhen(x) {
    if (x.n === 0) return _memoCap(t('memo_today'));
    if (x.n === 1) return _memoCap(t('memo_tomorrow'));
    return formatDateDMY(_memoIso(x.next)).slice(0, 5);
}
// Метка для карточки клиента: «♥ Сегодня», «♥ Завтра», «♥ 22.10 · через 5 дн.», при нескольких — «+1»
function memoCustomerTagHtml(custId) {
    const list = memoUpcoming(custId);
    if (!list.length) return '';
    const x = list[0];
    let txt = '♥ ' + memoShortWhen(x) + (x.n > 1 ? ' · ' + t('memo_in_days').replace('{n}', x.n) : '');
    if (list.length > 1) txt += ' +' + (list.length - 1);
    return `<span class="oc-tag oc-tag-memo">${escapeHtml(txt)}</span>`;
}

// Баннер: выключатель — на устройстве; крестик скрывает показанные даты (ключ «id:дата»)
const MEMO_BANNER_OFF_KEY = 'memo_banner_off';
const MEMO_BANNER_DISMISSED_KEY = 'memo_banner_dismissed';
let _memoBannerExpanded = false;
function memoBannerEnabled() {
    try { return localStorage.getItem(MEMO_BANNER_OFF_KEY) !== '1'; } catch (e) { return true; }
}
function _memoBannerKey(x) { return x.m.id + ':' + _memoIso(x.next); }
function _memoDismissedGet() {
    try { const a = JSON.parse(localStorage.getItem(MEMO_BANNER_DISMISSED_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function renderOrdersMemoBanner() {
    const box = document.getElementById('ordersMemoBanner');
    if (!box) return;
    if (!memoBannerEnabled() || !memoDates.length) { box.innerHTML = ''; return; }
    const list = memoUpcoming(null);
    const dismissed = _memoDismissedGet();
    if (!list.length || list.every(x => dismissed.includes(_memoBannerKey(x)))) { box.innerHTML = ''; return; }
    const shown = _memoBannerExpanded ? list : list.slice(0, 3);
    const rows = shown.map(x => {
        const c = customers.find(cc => cc.id === x.m.customer_id);
        return `<div class="memo-bn-row" onclick="memoBannerOpenCustomer(${x.m.customer_id})">
            <span class="memo-bn-when">${escapeHtml(memoShortWhen(x))}</span>
            <span class="memo-bn-txt">${escapeHtml(x.m.title)}${c && c.name ? ` · <span class="memo-bn-cust">${escapeHtml(c.name)}</span>` : ''}</span>
        </div>`;
    }).join('');
    const more = list.length > 3
        ? `<div class="memo-bn-more" onclick="memoBannerToggleMore()">${escapeHtml(_memoBannerExpanded ? t('memo_banner_less') : t('memo_banner_more').replace('{n}', list.length - 3))}</div>` : '';
    box.innerHTML = `<div class="memo-banner">
        <button type="button" class="memo-bn-x" aria-label="×" onclick="memoBannerDismiss()">×</button>
        <div class="memo-bn-title">♥ ${escapeHtml(t('memo_banner_title'))}</div>
        ${rows}${more}
    </div>`;
}
function memoBannerToggleMore() { _memoBannerExpanded = !_memoBannerExpanded; renderOrdersMemoBanner(); }
function memoBannerDismiss() {
    const today = _memoIso(_memoToday());
    // старые ключи (прошедшие даты) выбрасываем, чтобы список не рос
    const keep = _memoDismissedGet().filter(k => (k.split(':')[1] || '') >= today);
    memoUpcoming(null).forEach(x => { const k = _memoBannerKey(x); if (!keep.includes(k)) keep.push(k); });
    try { localStorage.setItem(MEMO_BANNER_DISMISSED_KEY, JSON.stringify(keep)); } catch (e) { /* без хранилища */ }
    renderOrdersMemoBanner();
}
function memoBannerOpenCustomer(custId) {
    if (!customers.find(c => c.id === custId)) return;
    showTab('customers');
    openCustomerDetail(custId);
}
// Перерисовать всё, что зависит от памятных дат и числа N
function memoRefreshViews() {
    renderOrdersMemoBanner();
    if (currentCustomerId != null && document.getElementById('customerDetail')?.classList.contains('active')) {
        const cust = customers.find(c => c.id === currentCustomerId);
        if (cust) renderCustomerStats(cust);
    }
    if (document.getElementById('customerCardsBody') && Array.isArray(customers)) { renderCustomerCards(); filterCustomersList(); }
}

// Настройки → «Памятные даты»: N (владелец/менеджер) и баннер (это устройство)
function refreshMemoSettingsUI() {
    const sel = document.getElementById('memoRemindDaysSel');
    if (!sel) return;
    if (!sel.options.length) sel.innerHTML = Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    sel.value = String(memoRemindDays());
    const canEdit = typeof hasPermission === 'function' && hasPermission('can_manage_team');
    sel.disabled = !canEdit;
    const hint = document.getElementById('memoRemindDaysHint');
    if (hint) hint.textContent = t(canEdit ? 'memo_set_days_hint' : 'memo_set_days_ro');
    const cb = document.getElementById('memoBannerToggle');
    if (cb) cb.checked = memoBannerEnabled();
    const short = document.getElementById('memoRemindDaysShort');
    if (short) short.textContent = memoRemindDays() + ' ' + t('memo_set_days_unit');
}
async function setMemoRemindDays(val) {
    const n = Math.min(30, Math.max(1, parseInt(val, 10) || 7));
    const prev = memoRemindDays();
    if (n === prev) return;
    try {
        await updateChecked(db.from('organizations').update({ memo_remind_days: n }).eq('id', currentOrgId));
        currentOrgMemoRemindDays = n;
        memoRefreshViews();
    } catch (e) {
        console.error(e);
        showInfo(e && e.code === '42501' ? t('memo_set_days_ro') : t('error_save_check_connection'));
    }
    refreshMemoSettingsUI();
}
function setMemoBannerEnabled(on) {
    try { if (on) localStorage.removeItem(MEMO_BANNER_OFF_KEY); else localStorage.setItem(MEMO_BANNER_OFF_KEY, '1'); } catch (e) { /* без хранилища */ }
    renderOrdersMemoBanner();
}

// Дата памятного дня в году y (29.02 в невисокосный год — 28.02)
function _memoDateInYear(m, y) {
    let day = m.day;
    if (m.month === 2 && day === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) day = 28;
    return new Date(y, m.month - 1, day);
}
function _memoToday() { return new Date(getLocalDateStr(0) + 'T00:00:00'); }
// Ближайшее наступление (Date) или null, если разовая дата уже прошла
function memoNextDate(m) {
    const today = _memoToday();
    if (!m.repeat_yearly) {
        const dt = _memoDateInYear(m, m.year);
        return dt < today ? null : dt;
    }
    let dt = _memoDateInYear(m, today.getFullYear());
    if (dt < today) dt = _memoDateInYear(m, today.getFullYear() + 1);
    return dt;
}
function _memoIso(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function memoDaysLeft(dt) { return Math.round((dt - _memoToday()) / 86400000); }

// Памятные даты клиента на день (y, month 1-12, d): [{ m, past }]
function memoDatesForDay(custId, y, month, d) {
    const today = _memoToday();
    const byCust = custId == null ? () => true
        : Array.isArray(custId) ? m => custId.includes(m.customer_id) : m => m.customer_id === custId;
    return memoDates.filter(byCust).filter(m => {
        if (!m.repeat_yearly && m.year !== y) return false;
        if (m.repeat_yearly && m.year && y < m.year) return false;
        const dt = _memoDateInYear(m, y);
        return dt.getMonth() + 1 === month && dt.getDate() === d;
    }).map(m => ({ m, past: !m.repeat_yearly && _memoDateInYear(m, m.year) < today }));
}

function _memoLocale() { return ({ ru: 'ru-RU', uk: 'uk-UA', lt: 'lt-LT', en: 'en-GB' })[currentLang] || 'en-GB'; }
function _memoMonthName(month) { return new Date(2000, month - 1, 1).toLocaleString(_memoLocale(), { month: 'long' }); }
function _memoDayMonth(m) { return new Date(2000, m.month - 1, m.day).toLocaleDateString(_memoLocale(), { day: 'numeric', month: 'long' }); }
function memoYearsLabel(n) {
    const m10 = n % 10, m100 = n % 100;
    let form;
    if (currentLang === 'en') form = n === 1 ? 1 : 5;
    else if (currentLang === 'lt') form = (m10 === 1 && m100 !== 11) ? 1 : (m10 >= 2 && m10 <= 9 && !(m100 >= 11 && m100 <= 19)) ? 2 : 5;
    else form = (m10 === 1 && m100 !== 11) ? 1 : (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) ? 2 : 5;
    return t('memo_years_' + form).replace('{n}', n);
}
function _memoSubText(m) {
    const parts = [_memoDayMonth(m) + (m.year ? ' ' + m.year : ''), m.repeat_yearly ? t('memo_yearly_short') : t('memo_once_short')];
    if (m.repeat_yearly && m.year) {
        const next = memoNextDate(m);
        if (next && next.getFullYear() > m.year) parts.push(memoYearsLabel(next.getFullYear() - m.year));
    }
    return parts.join(' · ');
}
function _memoHeartSvg(color, size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}" d="M12 21s-7.5-4.6-9.6-9.1C.9 8.6 3 5 6.5 5c2 0 3.5 1.1 5.5 3 2-1.9 3.5-3 5.5-3C21 5 23.1 8.6 21.6 11.9 19.5 16.4 12 21 12 21z"/></svg>`;
}
function _memoItemHtml(m, opts) {
    const past = opts && opts.past;
    return `<div class="memo-item" onclick="${opts.onTap}">
        <div class="memo-item-ic${past ? ' past' : ''}">${_memoHeartSvg(past ? MEMO_GREY : MEMO_GOLD, 16)}</div>
        <div style="min-width:0;">
            <div class="memo-item-t">${escapeHtml(m.title)}</div>
            <div class="memo-item-s">${escapeHtml(_memoSubText(m))}</div>
            ${m.note ? `<div class="memo-item-s" style="font-style:italic;">${escapeHtml(m.note)}</div>` : ''}
        </div>
        <div class="memo-item-when${opts.soon ? ' soon' : ''}">${opts.whenHtml || ''}</div>
    </div>`;
}
function _memoWhenText(n) {
    return n === 0 ? t('memo_today') : n === 1 ? t('memo_tomorrow') : t('memo_in_days').replace('{n}', n);
}

// «Заказы»: памятные даты на день с учётом фильтра «Клиенты» (там выбор хранится по именам)
function ordersMemoDatesForDay(y, month, d) {
    const sel = typeof selectedOrderCustomers !== 'undefined' ? selectedOrderCustomers : [];
    const ids = sel.length ? customers.filter(c => sel.includes(c.name)).map(c => c.id) : null;
    return memoDatesForDay(ids, y, month, d);
}
// Строка над заказами, когда в «Заказах» выбран один день: «♥ Название — Клиент»
function ordersDayMemoStripHtml() {
    const rangeEl = document.getElementById('orderDateRangeFilter');
    const from = (document.getElementById('orderDateFrom') || {}).value;
    const to = (document.getElementById('orderDateTo') || {}).value;
    if (!rangeEl || rangeEl.value !== 'custom' || !from || from !== to) return '';
    const dt = new Date(from + 'T00:00:00');
    const list = ordersMemoDatesForDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    if (!list.length) return '';
    return `<div class="memo-day-box" style="margin-bottom:10px;">${list.map(x => {
        const c = customers.find(cc => cc.id === x.m.customer_id);
        return `<div class="memo-item" onclick="openMemoEdit(${x.m.id}, 'orders')">
            <div class="memo-item-ic${x.past ? ' past' : ''}">${_memoHeartSvg(x.past ? MEMO_GREY : MEMO_GOLD, 16)}</div>
            <div style="min-width:0;"><div class="memo-item-t">${escapeHtml(x.m.title)}</div>
            <div class="memo-item-s">${escapeHtml(c ? c.name : '')}</div></div>
        </div>`;
    }).join('')}</div>`;
}

// Список памятных дат клиента (кнопка на странице клиента)
async function openCustomerMemoDates() {
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;
    showLoading();
    await loadMemoDates();
    hideLoading();
    document.getElementById('memoListSub').textContent = cust.name || '';
    renderMemoList();
    document.getElementById('memoListModal').style.display = 'flex';
}
function renderMemoList() {
    const list = memoDates.filter(m => m.customer_id === currentCustomerId)
        .map(m => ({ m, next: memoNextDate(m) }))
        .filter(x => x.next) // прошедшие разовые даты в списке скрыты
        .sort((a, b) => a.next - b.next);
    const body = document.getElementById('memoListBody');
    if (!list.length) {
        body.innerHTML = `<p class="text-xs text-gray-400" style="margin:6px 0 4px;text-align:center;">${t('memo_empty')}</p>`;
        return;
    }
    body.innerHTML = list.map(x => {
        const n = memoDaysLeft(x.next);
        const soon = n <= memoRemindDays();
        const when = soon ? _memoWhenText(n) : formatDateDMY(_memoIso(x.next));
        return _memoItemHtml(x.m, { onTap: `openMemoEdit(${x.m.id}, 'list')`, soon, whenHtml: escapeHtml(when) });
    }).join('');
}
function closeMemoList() { document.getElementById('memoListModal').style.display = 'none'; }

// Окно «Памятная дата»: preset — {day, month, year} для новой даты из календаря
function openMemoEdit(id, ret, preset) {
    const m = id != null ? memoDates.find(x => x.id === id) : null;
    // Из «Заказов» дата открывается без страницы клиента — клиента берём из самой даты
    const cust = customers.find(c => c.id === (m ? m.customer_id : currentCustomerId));
    if (!cust) return;
    _memoEditId = m ? m.id : null;
    _memoReturn = ret || null;
    if (ret === 'list') closeMemoList();
    if (ret === 'day') closeCustomerDay();
    const sel = document.getElementById('memoMonth');
    sel.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${escapeHtml(_memoMonthName(i + 1))}</option>`).join('');
    const today = _memoToday();
    document.getElementById('memoEditSub').textContent = cust.name || '';
    document.getElementById('memoTitle').value = m ? m.title : '';
    document.getElementById('memoDay').value = m ? m.day : (preset ? preset.day : today.getDate());
    sel.value = String(m ? m.month : (preset ? preset.month : today.getMonth() + 1));
    // Год из календаря подставляем только для разовой даты — по умолчанию «каждый год» без года
    document.getElementById('memoYear').value = m && m.year ? m.year : '';
    document.getElementById('memoNote').value = m && m.note ? m.note : '';
    _memoPresetYear = preset ? preset.year : null;
    memoSetYearly(m ? m.repeat_yearly : true);
    document.getElementById('memoDeleteBtn').style.display = m ? '' : 'none';
    document.getElementById('memoEditModal').style.display = 'flex';
}
let _memoPresetYear = null;
function memoPickChip(key) { document.getElementById('memoTitle').value = t(key); }
function memoSetYearly(on) {
    _memoYearly = !!on;
    document.getElementById('memoSegYearly').classList.toggle('on', _memoYearly);
    document.getElementById('memoSegOnce').classList.toggle('on', !_memoYearly);
    // Разовая дата требует год — подставим год дня из календаря или текущий
    const yEl = document.getElementById('memoYear');
    if (!_memoYearly && !yEl.value) yEl.value = _memoPresetYear || _memoToday().getFullYear();
    memoUpdateHint();
}
// Значения формы → объект или текст ошибки
function _memoReadForm() {
    const title = document.getElementById('memoTitle').value.trim();
    const day = parseInt(document.getElementById('memoDay').value, 10);
    const month = parseInt(document.getElementById('memoMonth').value, 10);
    const yRaw = document.getElementById('memoYear').value.trim();
    const year = yRaw ? parseInt(yRaw, 10) : null;
    const note = document.getElementById('memoNote').value.trim();
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!(day >= 1 && day <= maxDay)) return { err: t('memo_err_date') };
    if (yRaw && !(year >= 1900 && year <= 2100)) return { err: t('memo_err_date') };
    if (year && month === 2 && day === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) && !_memoYearly) return { err: t('memo_err_date') };
    if (!_memoYearly && !year) return { err: t('memo_err_year') };
    return { title, day, month, year, repeat_yearly: _memoYearly, note: note || null };
}
function memoUpdateHint() {
    const el = document.getElementById('memoHint');
    const f = _memoReadForm();
    const next = f.err ? null : memoNextDate(f);
    if (!next) { el.style.display = 'none'; return; }
    const n = memoDaysLeft(next);
    el.innerHTML = '♥ ' + escapeHtml(t('memo_next').replace('{d}', formatDateDMY(_memoIso(next))).replace('{w}', _memoWhenText(n)));
    el.style.display = '';
}
function closeMemoEdit() {
    document.getElementById('memoEditModal').style.display = 'none';
    const ret = _memoReturn;
    _memoReturn = null;
    if (ret === 'list') { renderMemoList(); document.getElementById('memoListModal').style.display = 'flex'; }
    else if (ret === 'orders' && typeof displayOrders === 'function') displayOrders();
    else if (ret === 'day' && _cdDayIso) onCustomerCalDayPicked(_cdDayIso); // окно дня уже с этой датой
}
async function saveMemoEdit() {
    const f = _memoReadForm();
    if (!f.title) { showInfo(t('memo_err_title')); return; }
    if (f.err) { showInfo(f.err); return; }
    showLoading();
    try {
        if (_memoEditId != null) {
            const { data, error } = await db.from('customer_memo_dates').update(f).eq('id', _memoEditId).select().single();
            if (error) throw error;
            const i = memoDates.findIndex(x => x.id === _memoEditId);
            if (i >= 0) memoDates[i] = data;
        } else {
            const { data, error } = await db.from('customer_memo_dates')
                .insert(Object.assign({ org_id: currentOrgId, customer_id: currentCustomerId }, f)).select().single();
            if (error) throw error;
            memoDates.push(data);
        }
        memoRefreshViews();
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    closeMemoEdit();
}
async function deleteMemoEdit() {
    const m = memoDates.find(x => x.id === _memoEditId);
    if (!m) return;
    const ok = await showConfirm(t('memo_delete_confirm').replace('{t}', m.title));
    if (!ok) return;
    showLoading();
    const { error } = await db.from('customer_memo_dates').delete().eq('id', m.id);
    hideLoading();
    if (error) { console.error(error); showInfo(t('error_save_check_connection')); return; }
    memoDates = memoDates.filter(x => x.id !== m.id);
    memoRefreshViews();
    closeMemoEdit();
}

async function closeCustomerDetail() {
    const leavingId = currentCustomerId;
    currentCustomerId = null;
    document.getElementById('customersList').classList.remove('hidden');
    document.getElementById('customerDetail').classList.remove('active');
    if (typeof positionStickySearchBar === 'function') positionStickySearchBar('customersSearchBar', 'customersList', 'customerDetail');
    if (leavingId !== null) await cleanupCustomerDraftIfEmpty(leavingId);
    displayCustomers();
    refreshFab();

    // Если карточка была открыта кнопкой "Карточка клиента" из заказа — возвращаемся
    // именно в этот заказ (он всё ещё "активен" внутри вкладки Заказы, просто скрыт
    // переключением вкладки), а не в список клиентов, который сейчас показали выше.
    if (_customerOpenedFromOrderId !== null) {
        const returnOrderId = _customerOpenedFromOrderId;
        _customerOpenedFromOrderId = null;
        showTab('orders');
        // На случай если карточка заказа почему-то уже закрыта к этому моменту —
        // открываем её заново, а не оставляем список заказов пустым экраном.
        if (!document.getElementById('orderDetail')?.classList.contains('active') && typeof openOrderDetail === 'function') {
            openOrderDetail(returnOrderId);
        }
        // Клиент создан из заказа с пустым именем: имя вписали в карточке — привязываем к заказу
        if (typeof _attachCustomerAfterCard !== 'undefined' && _attachCustomerAfterCard && _attachCustomerAfterCard.orderId === returnOrderId) {
            const pending = _attachCustomerAfterCard;
            _attachCustomerAfterCard = null;
            _draftOrderIds.add(returnOrderId);
            const c = customers.find(x => x.id === pending.custId);
            if (c && c.name && currentOrderId === returnOrderId) attachCustomerToOrder(c);
        }
    }
}

// Удаление клиента прямо из его карточки (то же окно подтверждения, что и из списка)
function deleteCurrentCustomer() {
    const idx = customers.findIndex(c => c.id === currentCustomerId);
    if (idx === -1) return;
    const cust = customers[idx];
    openDeleteModal(idx, 'customer', `${t('delete_label_customer')} «${cust.name || t('customers_no_name_fallback')}»`);
}

let _customerEntityType = 'company';

function setCustomerEntityType(type, skipSave) {
    _customerEntityType = type;
    const isCompany = type === 'company';

    document.getElementById('cdCompanyFields').classList.toggle('hidden', !isCompany);
    document.getElementById('cdIndividualFields').classList.toggle('hidden', isCompany);

    const companyBtn    = document.getElementById('cdEntityCompanyBtn');
    const individualBtn = document.getElementById('cdEntityIndividualBtn');
    companyBtn.classList.toggle('active', isCompany);
    individualBtn.classList.toggle('active', !isCompany);

    if (!skipSave) saveCdHeader();
}

async function saveCdHeader() {
    suppressRealtimeFor3s();
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;
    const name     = document.getElementById('cdName').value.trim();
    const contact  = document.getElementById('cdContact').value.trim();
    const email    = document.getElementById('cdEmail').value.trim();
    const discount = parseFloat(document.getElementById('cdDiscount').value) || 0;
    const vatExempt = document.getElementById('cdVatExempt').checked;
    const notes    = document.getElementById('cdNotes').value.trim();
    const address     = document.getElementById('cdAddress').value.trim();
    const regNumber   = document.getElementById('cdRegNumber').value.trim();
    const vatCode     = document.getElementById('cdVatCode').value.trim();
    const personalCode = document.getElementById('cdPersonalCode').value.trim();
    const paymentTermRaw = document.getElementById('cdPaymentTermDays').value;
    const paymentTermDays = paymentTermRaw === '' ? null : Math.max(0, parseInt(paymentTermRaw, 10) || 0);
    const entityType  = _customerEntityType;
    if (!name) { showInfo(t('customers_name_required')); return; }
    // Защита от дубликатов: имя нового или переименованного клиента не должно совпадать с чужим
    const dupCust = findCustomerByName(name, cust.id);
    if (dupCust) {
        showInfo(t('customers_duplicate_name').replace('{name}', dupCust.name));
        document.getElementById('cdName').focus();
        return;
    }
    const oldName = cust.name;
    showLoading();
    try {
        await updateChecked(db.from('customers').update({
            name, contact, email: email || null, discount: parseFloat(discount.toFixed(2)), vat_exempt: vatExempt, notes,
            address, reg_number: regNumber, vat_code: vatCode, personal_code: personalCode, entity_type: entityType,
            payment_term_days: paymentTermDays
        }).eq('id', cust.id));
        cust.name = name; cust.contact = contact; cust.email = email || null; cust.discount = parseFloat(discount.toFixed(2)); cust.vat_exempt = vatExempt; cust.notes = notes;
        cust.address = address; cust.reg_number = regNumber; cust.vat_code = vatCode; cust.personal_code = personalCode; cust.entity_type = entityType;
        cust.payment_term_days = paymentTermDays;
        orders.forEach(o => { if (o.customer_id === cust.id) o.customer = name; });
        logActivity('customer', `${t('log_customer_changed')} «${oldName}»${oldName !== name ? ` → «${name}»` : ''}`);
        renderCustomerStats(cust);
        renderCustomerOrders();
        _cdRenderRequisitesSummary(cust);
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo(t('error_save_check_connection')); }
    finally { hideLoading(); }
}

// Мини-итоги "за всё время" — не зависят от фильтра по дате под ними
function renderCustomerStats(cust) {
    const custOrders = orders.filter(o => o.customer_id === cust.id);
    // Сводка (16.10, вариант А): те же ячейки, что в карточке клиента в списке — Заказов / Сумма заказов /
    // Задолженность, под ними красная метка «N неоплаченных заказов» (открывает окно по счетам)
    const debt = customerDebt(cust);
    const hasDebt = debt > 0.01;
    const unpaidCnt = hasDebt ? customerUnpaidOrders(cust).length : 0;
    const cellsEl = document.getElementById('cdStatsCells');
    if (cellsEl) cellsEl.innerHTML = stockCardCellsHtml3(
        [t('cust_cell_orders'), String(custOrders.length), '#3c3a34'],
        [t('cust_cell_total'), formatMoney(customerTotalSpent(cust)), '#3c3a34'],
        [t('cust_cell_debt'), hasDebt ? formatMoney(debt) : '—', hasDebt ? '#c0685c' : '#a29c8c']);
    const hasOrders = custOrders.length > 0;
    // Памятные даты в окне N дней (17.10): строка над ячейками (все даты) + золотая метка перед красной
    const upcoming = memoUpcoming(cust.id);
    const stripEl = document.getElementById('cdMemoStrip');
    if (stripEl) stripEl.innerHTML = upcoming.length
        ? `<div class="memo-day-box" style="margin:10px 0 0;">${upcoming.map(x =>
            _memoItemHtml(x.m, { onTap: `openMemoEdit(${x.m.id}, 'detail')`, soon: true, whenHtml: escapeHtml(_memoWhenText(x.n)) })).join('')}</div>` : '';
    // Метка памятной даты здесь не нужна — дублировала строку выше (17.10); в списке клиентов метка остаётся
    const tags = [];
    if (unpaidCnt > 0) tags.push(`<button type="button" class="oc-tag oc-tag-red" onclick="openCustomerUnpaidModal(${cust.id})">${unpaidOrdersLabel(unpaidCnt)}</button>`);
    const tagsEl = document.getElementById('cdStatsTags');
    if (tagsEl) tagsEl.innerHTML = tags.length ? `<div class="oc-tags">${tags.join('')}</div>` : '';
    // У клиента без заказов ячейки и список заказов пусты — скрываем их; кнопки «Календарь» и «Памятные даты» остаются
    if (cellsEl) cellsEl.classList.toggle('hidden', !hasOrders);
    const btns = document.getElementById('cdStatsBtns');
    if (btns) btns.style.marginTop = hasOrders ? '8px' : '0';
    document.getElementById('cdStatsBlock')?.classList.remove('hidden');
    document.getElementById('cdOrdersBlock')?.classList.toggle('hidden', !hasOrders);
}

// Список заказов клиента с фильтром по периоду (Весь период/Неделя/Месяц/Год)
// CD_DATE_RANGE_LABELS заменён общей функцией rangeLabel() выше — тот же набор ключей.

function toggleCdDateRangeDropdown() {
    const dd = document.getElementById('cdDateRangeDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) openPortalDropdown(dd, event.currentTarget);
}

function setCdDateRange(range) {
    document.getElementById('cdDateRange').value = range;
    document.getElementById('cdDateRangeBtnLabel').textContent = rangeLabel(range);
    document.querySelectorAll('#cdDateRangeDropdown .status-option').forEach(opt => opt.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    closeAllOrderStatusDropdowns();
    document.getElementById('cdCustomDateRange').classList.toggle('hidden', range !== 'custom');
    if (range === 'custom') {
        event.stopPropagation();
        toggleCustomCalendarRange('globalCalendarPopup', 'cdDateFrom', 'cdDateTo', 'cdDateRangeFromLabel', 'cdDateRangeToLabel', { onApply: function () { renderCustomerOrders(); } });
    } else {
        renderCustomerOrders();
    }
}

function renderCustomerOrders() {
    const cust = customers.find(c => c.id === currentCustomerId);
    const container = document.getElementById('cdOrdersList');
    if (!cust || !container) return;

    const range = document.getElementById('cdDateRange').value;
    let custOrders = orders.filter(o => o.customer_id === cust.id);

    if (range === 'week' || range === 'month' || range === 'year') {
        const today = orgNowDate();
        let startStr;
        if (range === 'week') {
            startStr = getCurrentWeekStartStr();
        } else if (range === 'year') {
            startStr = `${today.getFullYear()}-01-01`;
        } else {
            startStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
        }
        custOrders = custOrders.filter(o => o.date >= startStr);
    } else if (range === 'custom') {
        const from = document.getElementById('cdDateFrom') ? document.getElementById('cdDateFrom').value : '';
        const to   = document.getElementById('cdDateTo')   ? document.getElementById('cdDateTo').value   : '';
        if (from) custOrders = custOrders.filter(o => o.date >= from);
        if (to)   custOrders = custOrders.filter(o => o.date <= to);
    }

    custOrders.sort((a, b) => b.date.localeCompare(a.date));

    if (!custOrders.length) {
        container.innerHTML = `<p class="text-xs text-gray-400">${t('customers_no_orders_period')}</p>`;
        return;
    }

    const statusFlag = { 'принят': 'flag-red', 'в работе': 'flag-yellow', 'выполнен': 'flag-green' };
    let html = '<table class="w-full table-text table-clean" style="table-layout:fixed;"><thead><tr style="background-color:#e3e8df;" class="text-xs"><th class="p-1 text-left" style="width:28%;">' + t('customers_col_number') + '</th><th class="p-1 text-left" style="width:20%;">' + t('customers_col_date') + '</th><th class="p-1 text-right" style="width:28%;">' + t('customers_col_sum') + ' (' + (CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency) + ')</th><th class="p-1 text-center" style="width:24%;">' + t('customers_col_status') + '</th></tr></thead><tbody>';
    custOrders.forEach(o => {
        const oNum = o.order_number || `#${o.id}`;
        const payInfo = getOrderPaymentStatus(o);
        html += `<tr class="border-b order-row" onclick="goToOrderFromCustomer(${o.id})">
            <td class="p-0.5 whitespace-nowrap">${escapeHtml(oNum)}</td>
            <td class="p-0.5">${formatDateDMY(o.date)}</td>
            <td class="p-0.5 text-right font-semibold"><span class="inline-block w-2 h-2 rounded-full mr-1" style="background-color:${getPaymentStripeColor(payInfo)};"></span>${orderGrandTotal(o).toFixed(2)}</td>
            <td class="p-0.5 text-center"><span class="flag ${statusFlag[o.status] || ''}"></span> ${escapeHtml(orderStatusLabel(o.status))}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
    // Видно до 5 заказов, остальные — прокруткой внутри списка
    container.style.maxHeight = 'none';
    const rows = container.querySelectorAll('tbody tr');
    if (rows.length > 5) {
        const top = container.getBoundingClientRect().top;
        const h = Math.ceil(rows[4].getBoundingClientRect().bottom - top);
        if (h > 0) container.style.maxHeight = h + 'px';
    }
}
