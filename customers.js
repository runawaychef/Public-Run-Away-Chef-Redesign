// ==================== КЛИЕНТЫ ====================
// Список клиентов: отображение, добавление, редактирование (скидка, флажок «Без НДС»).
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), customers/orders (главный скрипт),
// showLoading/hideLoading, logActivity (employees.js),
// svgEdit/svgDelete, updateCustomerSelects, updateStatsCustomerFilter,
// updateOrderCustomerFilter, openDeleteModal, closeModal (главный скрипт).

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

function displayCustomers() {
    customers.sort((a, b) => (a.name||"").localeCompare(b.name||""));
    const tbody = document.getElementById('customerTableBody');
    tbody.innerHTML = '';
    let warningCount = 0;
    customers.forEach((c, i) => {
        const hasName = !!(c.name && c.name.trim());
        if (!hasName) warningCount++;
        const nameLabel = hasName ? escapeHtml(c.name) : icon('warning', 'w-3 h-3 inline-block align-[-1px] mr-0.5') + '(имя не указано)';
        const debt = customerDebt(c);
        const debtLabel = debt > 0.01
            ? `<span class="text-red-600">${formatMoney(debt)}</span>`
            : `<span class="text-gray-400">—</span>`;
        const row = document.createElement('tr');
        row.className = 'order-row border-b' + (hasName ? '' : ' bg-red-50');
        row.innerHTML = `
            <td class=" p-0.5 table-text ${hasName ? '' : 'text-red-600 font-semibold'}" onclick="openCustomerDetail(${c.id})">${nameLabel}</td>
            <td class=" p-0.5 table-text" onclick="openCustomerDetail(${c.id})">${escapeHtml(c.contact)}</td>
            <td class=" p-0.5 table-text" onclick="openCustomerDetail(${c.id})">${c.discount.toFixed(2)}</td>
            <td class=" p-0.5 table-text" onclick="openCustomerDetail(${c.id})">${debtLabel}</td>`;
        tbody.appendChild(row);
    });
    const warningEl = document.getElementById('customersNameWarning');
    if (warningEl) warningEl.classList.toggle('hidden', warningCount === 0);
    updateCustomerSelects();
    updateStatsCustomerFilter();
    updateOrderCustomerFilter();
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
        logActivity('customer', `Создан черновик клиента №${newCust.id}`);
    } catch (e) { console.error(e); showDbError(e, 'Ошибка создания клиента. Проверьте подключение.'); }
    finally { hideLoading(); }
}

async function cleanupCustomerDraftIfEmpty(custId) {
    if (!_draftCustomerIds.has(custId)) return;
    _draftCustomerIds.delete(custId);
    const idx = customers.findIndex(c => c.id === custId);
    if (idx === -1) return;
    if (customers[idx].name && customers[idx].name.trim()) return; // имя вписали — это уже не пустой черновик
    try {
        await db.from('customers').delete().eq('id', custId);
        customers.splice(idx, 1);
    } catch (e) { console.error('Не удалось удалить пустой черновик клиента:', e); }
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
        await showInfo('У всех заказов этого клиента НДС-статус уже совпадает с текущим.');
        return;
    }

    const statusLabel = cust.vat_exempt ? '«Без НДС»' : '«С НДС»';
    const ok = await showConfirm(`Применить статус ${statusLabel} к ${toUpdate.length} ${toUpdate.length === 1 ? 'заказу' : 'заказам'} клиента «${cust.name}»?\nЭто изменит уже существующие заказы.`);
    if (!ok) return;

    showLoading();
    try {
        const ids = toUpdate.map(o => o.id);
        await updateChecked(db.from('orders').update({ vat_exempt: cust.vat_exempt }).in('id', ids));
        toUpdate.forEach(o => { o.vat_exempt = cust.vat_exempt; });
        logActivity('customer', `Применён НДС-статус ${statusLabel} к ${toUpdate.length} заказам клиента «${cust.name}»`);
        renderCustomerStats(cust);
        renderCustomerOrders();
        await showInfo(`Готово: обновлено заказов — ${toUpdate.length}.`);
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// Возвращает заказы клиента, отфильтрованные по выбранному в карточке периоду
// (тот же фильтр, что используется для списка заказов клиента).
function getCustomerOrdersForRange(cust) {
    const range = document.getElementById('cdDateRange').value;
    let custOrders = orders.filter(o => o.customer_id === cust.id);
    if (range === 'week' || range === 'month' || range === 'year') {
        const today = new Date();
        let start;
        if (range === 'week') {
            start = getCurrentWeekStart();
        } else if (range === 'year') {
            start = new Date(today.getFullYear(), 0, 1);
        } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        custOrders = custOrders.filter(o => new Date(o.date) >= start);
    }
    return { range, custOrders };
}

const RANGE_LABELS = { all: 'Весь период', week: 'Текущая неделя', month: 'Текущий месяц', year: 'Текущий год' };

// ==================== СВОДНЫЙ ОТЧЁТ ПО ИЗДЕЛИЯМ ЗА ПЕРИОД ====================
function openCustomerReportPreview() {
    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) return;
    const { range, custOrders } = getCustomerOrdersForRange(cust);

    if (!custOrders.length) {
        showInfo('Нет заказов за выбранный период — отчёт формировать не из чего.');
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
    const discountLabel = discountPercents.length === 1 ? ` (${discountPercents[0]}%)` : discountPercents.length > 1 ? ' (разная по заказам)' : '';

    // Диапазон дат для заголовка
    const dates = custOrders.map(o => o.date).sort();
    const periodLabel = dates.length
        ? (dates[0] === dates[dates.length-1] ? formatDateDMY(dates[0]) : `${formatDateDMY(dates[0])} – ${formatDateDMY(dates[dates.length-1])}`)
        : RANGE_LABELS[range];

    let html = `
        <div style="padding:6px;">
            <h2 style="font-size:16px;font-weight:700;color:#1f2937;margin:0 0 2px;">${escapeHtml(cust.name)}</h2>
            <p style="font-size:11px;color:#6b7280;margin:0 0 12px;">Сводный отчёт по изделиям · ${RANGE_LABELS[range]} (${periodLabel})</p>
            <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px;">
                <thead><tr style="background:#e3e8df;">
                    <th style="text-align:left;padding:4px;border-bottom:1px solid #e5e7eb;">Изделие</th>
                    <th style="text-align:right;padding:4px;border-bottom:1px solid #e5e7eb;">Кол-во</th>
                    <th style="text-align:right;padding:4px;border-bottom:1px solid #e5e7eb;">Сумма (${CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency})</th>
                </tr></thead><tbody>`;
    rows.forEach(([name, v]) => {
        html += `<tr><td style="padding:4px;border-bottom:1px solid #f3f4f6;">${escapeHtml(name)}</td><td style="text-align:right;padding:4px;border-bottom:1px solid #f3f4f6;">${v.qty}</td><td style="text-align:right;padding:4px;border-bottom:1px solid #f3f4f6;">${v.sum.toFixed(2)}</td></tr>`;
    });
    html += `</tbody>
            <tfoot><tr style="font-weight:700;background:#e3e8df;">
                <td style="padding:4px;">Итого</td>
                <td style="text-align:right;padding:4px;">${totalQty}</td>
                <td style="text-align:right;padding:4px;">${totalSum.toFixed(2)}</td>
            </tr></tfoot>
            </table>
            <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin-top:10px;">
                <tr><td style="padding:2px 4px;color:#6b7280;">Сумма по позициям</td><td style="text-align:right;padding:2px 4px;">${formatMoney(totalSum)}</td></tr>
                ${totalDiscount > 0 ? `<tr><td style="padding:2px 4px;color:#6b7280;">Скидка${discountLabel}</td><td style="text-align:right;padding:2px 4px;color:#c0685c;">−${formatMoney(totalDiscount)}</td></tr>` : ''}
                <tr><td style="padding:2px 4px;color:#6b7280;">НДС (21%)</td><td style="text-align:right;padding:2px 4px;color:#6b7280;">${formatMoney(totalVat)}</td></tr>
                <tr style="font-weight:700;"><td style="padding:4px;border-top:1px solid #e5e7eb;">Итого к оплате</td><td style="text-align:right;padding:4px;border-top:1px solid #e5e7eb;">${formatMoney(grandTotal)}</td></tr>
            </table>
            <p style="font-size:10px;color:#9ca3af;margin-top:10px;">Заказов за период: ${custOrders.length}. В таблице по изделиям — цены позиций без скидки и НДС, финансовая сводка ниже — уже с их учётом.</p>
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
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Формирую PDF...'; }

    const cust = customers.find(c => c.id === currentCustomerId);
    if (!cust) { _reportPdfInProgress = false; if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + 'Скачать PDF'; } return; }
    const { range, custOrders } = getCustomerOrdersForRange(cust);
    if (!custOrders.length) { _reportPdfInProgress = false; if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + 'Скачать PDF'; } return; }

    const dates = custOrders.map(o => o.date).sort();
    const periodTag = dates.length
        ? (dates[0] === dates[dates.length-1] ? dates[0] : `${dates[0]}_${dates[dates.length-1]}`)
        : range;
    const safeName = cust.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'клиент';
    const filename = `${safeName}_${periodTag}.pdf`;
    const periodLabel = dates.length
        ? (dates[0] === dates[dates.length-1] ? formatDateDMY(dates[0]) : `${formatDateDMY(dates[0])} – ${formatDateDMY(dates[dates.length-1])}`)
        : RANGE_LABELS[range];

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
    const discountLabel = discountPercents.length === 1 ? ` (${discountPercents[0]}%)` : discountPercents.length > 1 ? ' (разная по заказам)' : '';
    const sym = CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency;

    showLoading('Формируется PDF, подождите...');
    try {
        const pdf = await createPdfDoc();
        const pageW = pdf.internal.pageSize.getWidth();
        const marginX = 14;

        pdf.setFontSize(15); pdf.setFont('Roboto', 'bold');
        pdf.text(cust.name, marginX, 18);
        pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(`Сводный отчёт по изделиям · ${RANGE_LABELS[range]} (${periodLabel})`, marginX, 24);
        pdf.setTextColor(...PDF_COLORS.textDark);

        pdf.autoTable({
            startY: 30,
            margin: { left: marginX, right: marginX },
            head: [['Изделие', 'Кол-во', `Сумма (${sym})`]],
            body: rows.map(([name, v]) => [name, String(v.qty), v.sum.toFixed(2)]),
            foot: [['Итого', String(totalQty), totalSum.toFixed(2)]],
            headStyles: PDF_TABLE_HEAD_STYLE,
            footStyles: { fillColor: PDF_COLORS.sageLight, textColor: PDF_COLORS.textDark, fontStyle: 'bold', font: 'Roboto' },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
            styles: { fontSize: 10, cellPadding: 2.5, font: 'Roboto' },
        });

        let y = pdf.lastAutoTable.finalY + 8;
        const summaryRows = [['Сумма по позициям', formatMoney(totalSum)]];
        if (totalDiscount > 0) summaryRows.push([`Скидка${discountLabel}`, '−' + formatMoney(totalDiscount)]);
        summaryRows.push(['НДС (21%)', formatMoney(totalVat)]);

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
        pdf.text('Итого к оплате', marginX, y);
        pdf.text(formatMoney(grandTotal), pageW - marginX, y, { align: 'right' });

        y += 10;
        pdf.setFontSize(8.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(`Заказов за период: ${custOrders.length}. В таблице по изделиям — цены позиций без скидки и НДС, финансовая сводка выше — уже с их учётом.`, marginX, y, { maxWidth: pageW - marginX * 2 });

        await pdfSaveOrShare(pdf, filename);
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сформировать PDF: ' + (e && e.message ? e.message : 'неизвестная ошибка') + '. Проверьте подключение и попробуйте ещё раз.');
    }
    finally {
        hideLoading();
        _reportPdfInProgress = false;
        if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = icon('download') + 'Скачать PDF'; }
    }
}

// ==================== КАРТОЧКА КЛИЕНТА ====================
function openCustomerDetail(custId) {
    currentCustomerId = custId;
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;

    document.getElementById('customersList').classList.add('hidden');
    document.getElementById('customerDetail').classList.add('active');
    document.getElementById('customerDetail').classList.add('fade-in'); setTimeout(() => document.getElementById('customerDetail').classList.remove('fade-in'), 300);

    document.getElementById('cdName').value = cust.name;
    document.getElementById('cdContact').value = cust.contact;
    document.getElementById('cdDiscount').value = cust.discount.toFixed(2);
    document.getElementById('cdVatExempt').checked = !!cust.vat_exempt;
    document.getElementById('cdNotes').value = cust.notes || '';
    document.getElementById('cdDateRange').value = 'all';
    document.getElementById('cdDateRangeBtnLabel').textContent = 'Весь период';
    document.querySelectorAll('#cdDateRangeDropdown .status-option').forEach((opt, i) => opt.classList.toggle('selected', i === 0));
    document.getElementById('cdAddress').value = cust.address || '';
    document.getElementById('cdRegNumber').value = cust.reg_number || '';
    document.getElementById('cdVatCode').value = cust.vat_code || '';
    document.getElementById('cdPersonalCode').value = cust.personal_code || '';
    setCustomerEntityType(cust.entity_type || 'company', /*skipSave*/ true);

    renderCustomerStats(cust);
    renderCustomerOrders();
    refreshFab();
}

async function closeCustomerDetail() {
    const leavingId = currentCustomerId;
    currentCustomerId = null;
    document.getElementById('customersList').classList.remove('hidden');
    document.getElementById('customerDetail').classList.remove('active');
    if (leavingId !== null) await cleanupCustomerDraftIfEmpty(leavingId);
    displayCustomers();
    refreshFab();
}

// Удаление клиента прямо из его карточки (то же окно подтверждения, что и из списка)
function deleteCurrentCustomer() {
    const idx = customers.findIndex(c => c.id === currentCustomerId);
    if (idx === -1) return;
    const cust = customers[idx];
    openDeleteModal(idx, 'customer', `клиента «${cust.name || '(без имени)'}»`);
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
    const discount = parseFloat(document.getElementById('cdDiscount').value) || 0;
    const vatExempt = document.getElementById('cdVatExempt').checked;
    const notes    = document.getElementById('cdNotes').value.trim();
    const address     = document.getElementById('cdAddress').value.trim();
    const regNumber   = document.getElementById('cdRegNumber').value.trim();
    const vatCode     = document.getElementById('cdVatCode').value.trim();
    const personalCode = document.getElementById('cdPersonalCode').value.trim();
    const entityType  = _customerEntityType;
    if (!name) { showInfo('Заполните имя клиента!'); return; }
    const oldName = cust.name;
    showLoading();
    try {
        await updateChecked(db.from('customers').update({
            name, contact, discount: parseFloat(discount.toFixed(2)), vat_exempt: vatExempt, notes,
            address, reg_number: regNumber, vat_code: vatCode, personal_code: personalCode, entity_type: entityType
        }).eq('id', cust.id));
        cust.name = name; cust.contact = contact; cust.discount = parseFloat(discount.toFixed(2)); cust.vat_exempt = vatExempt; cust.notes = notes;
        cust.address = address; cust.reg_number = regNumber; cust.vat_code = vatCode; cust.personal_code = personalCode; cust.entity_type = entityType;
        orders.forEach(o => { if (o.customer_id === cust.id) o.customer = name; });
        logActivity('customer', `Изменён клиент «${oldName}»${oldName !== name ? ` → «${name}»` : ''}`);
        renderCustomerStats(cust);
        renderCustomerOrders();
        showAutosaveToast();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения. Проверьте подключение.'); }
    finally { hideLoading(); }
}

// Мини-итоги "за всё время" — не зависят от фильтра по дате под ними
function renderCustomerStats(cust) {
    const custOrders = orders.filter(o => o.customer_id === cust.id);
    const totalSum = custOrders.reduce((s, o) => s + orderGrandTotal(o), 0);
    const lastDate = custOrders.reduce((latest, o) => (!latest || o.date > latest) ? o.date : latest, null);
    document.getElementById('cdOrderCount').textContent = custOrders.length;
    document.getElementById('cdTotalSum').textContent = formatMoney(totalSum);
    document.getElementById('cdLastOrderDate').textContent = lastDate ? formatDateDMY(lastDate) : '—';
}

// Список заказов клиента с фильтром по периоду (Весь период/Неделя/Месяц/Год)
const CD_DATE_RANGE_LABELS = { all: 'Весь период', week: 'Текущая неделя', month: 'Текущий месяц', year: 'Текущий год' };

function toggleCdDateRangeDropdown() {
    const dd = document.getElementById('cdDateRangeDropdown');
    if (!dd) return;
    const isOpen = dd.classList.contains('open');
    closeAllOrderStatusDropdowns();
    if (!isOpen) openSmartDropdown(dd);
}

function setCdDateRange(range) {
    document.getElementById('cdDateRange').value = range;
    document.getElementById('cdDateRangeBtnLabel').textContent = CD_DATE_RANGE_LABELS[range];
    document.querySelectorAll('#cdDateRangeDropdown .status-option').forEach(opt => opt.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    closeAllOrderStatusDropdowns();
    renderCustomerOrders();
}

function renderCustomerOrders() {
    const cust = customers.find(c => c.id === currentCustomerId);
    const container = document.getElementById('cdOrdersList');
    if (!cust || !container) return;

    const range = document.getElementById('cdDateRange').value;
    let custOrders = orders.filter(o => o.customer_id === cust.id);

    if (range === 'week' || range === 'month' || range === 'year') {
        const today = new Date();
        let startStr;
        if (range === 'week') {
            startStr = getCurrentWeekStartStr();
        } else if (range === 'year') {
            startStr = `${today.getFullYear()}-01-01`;
        } else {
            startStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
        }
        custOrders = custOrders.filter(o => o.date >= startStr);
    }

    custOrders.sort((a, b) => b.date.localeCompare(a.date));

    if (!custOrders.length) {
        container.innerHTML = '<p class="text-xs text-gray-400">Нет заказов за этот период</p>';
        return;
    }

    const statusFlag = { 'принят': 'flag-red', 'в работе': 'flag-yellow', 'выполнен': 'flag-green' };
    let html = '<table class="w-full table-text table-clean" style="table-layout:fixed;"><thead><tr style="background-color:#e3e8df;" class="text-xs"><th class="p-1 text-left" style="width:28%;">№</th><th class="p-1 text-left" style="width:20%;">Дата</th><th class="p-1 text-right" style="width:28%;">Сумма (' + (CURRENCY_SYMBOLS[currentOrgCurrency] || currentOrgCurrency) + ')</th><th class="p-1 text-center" style="width:24%;">Статус</th></tr></thead><tbody>';
    custOrders.forEach(o => {
        const oNum = o.order_number || `#${o.id}`;
        const payInfo = getOrderPaymentStatus(o);
        html += `<tr class="border-b order-row" onclick="goToOrderFromCustomer(${o.id})">
            <td class="p-0.5 whitespace-nowrap">${escapeHtml(oNum)}</td>
            <td class="p-0.5">${formatDateDMY(o.date)}</td>
            <td class="p-0.5 text-right font-semibold"><span class="inline-block w-2 h-2 rounded-full mr-1" style="background-color:${getPaymentStripeColor(payInfo)};"></span>${orderGrandTotal(o).toFixed(2)}</td>
            <td class="p-0.5 text-center"><span class="flag ${statusFlag[o.status] || ''}"></span> ${escapeHtml(o.status)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}
