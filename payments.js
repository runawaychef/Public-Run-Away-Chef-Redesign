// ==================== ОПЛАТА ЗАКАЗА ====================
// Депозит и окончательный расчёт — это одна и та же сущность (просто разные записи в истории).
// Статус оплаты считается автоматически по сумме внесённых платежей, а не хранится отдельным полем.
// Зависит от: db, currentOrgId, currentOrderId, currentEmployee, employees, orders (orders.js/employees.js),
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, escapeHtml, logActivity (helpers.js/modals.js),
//             formatDateDMY, getLocalDateStr (dates.js), hasPermission (employees.js).

// Подпись способа оплаты для показа. В базе способ хранится русским словом
// («наличные», «карта», «перевод») и менять это нельзя (SQL, банк, триггеры) — переводим только при показе.
// Неизвестное значение или отсутствующий перевод — показываем исходное слово.
function payMethodLabel(m) {
    const keys = { 'наличные': 'orders_method_cash', 'карта': 'orders_method_card', 'перевод': 'orders_method_transfer' };
    const k = keys[m];
    if (!k) return m || '—';
    const label = t(k);
    return (label && label !== k) ? label : m;
}
// v944: снимок заказа на момент оплаты (order_payments.order_snapshot, jsonb): позиции, скидка, итог, дата.
// Пишется при каждой оплате, внесённой в приложении (банковские автозачёты пишет сервер — у них снимка нет).
function _payOrderSnap(order) {
    if (!order) return null;
    try {
        return {
            items: orderBillItems(order).map(it => ({ product: it.product, quantity: it.quantity, price: it.price })),
            discount: order.discount || 0,
            vat_exempt: orderVatExempt(order),
            total: Math.round(orderGrandTotal(order) * 100) / 100,
            date: order.date || null,
        };
    } catch (e) { console.error(e); return null; }
}
let _orderPayments = [];
// v946: аванс клиента (таблица customer_credits: сумма > 0 — пополнение, < 0 — списание/возврат)
const _custBalance = {};   // { customerId: сумма аванса }
async function loadCustomerBalance(custId) {
    if (!custId) return 0;
    const before = _custBalance[custId] || 0;
    try {
        const { data, error } = await db.from('customer_credits').select('amount').eq('customer_id', custId);
        if (error) throw error;
        _custBalance[custId] = Math.round((data || []).reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
    } catch (e) { console.error('Аванс клиента: не загрузился', e); }
    const now = _custBalance[custId] || 0;
    if (Math.abs(now - before) > 0.004) _onCustBalancesChanged();   // v949: баланс изменился — обновить пометки
    return now;
}
// v949: балансы всех клиентов одним запросом (для пометок «Аванс» в списке клиентов)
let _custBalAllAt = 0;
async function loadAllCustomerBalances(force) {
    if (!force && Date.now() - _custBalAllAt < 20000) return;
    _custBalAllAt = Date.now();
    try {
        const { data, error } = await db.from('customer_credits').select('customer_id, amount');
        if (error) throw error;
        const sums = {};
        (data || []).forEach(r => { sums[r.customer_id] = (sums[r.customer_id] || 0) + Number(r.amount); });
        let changed = false;
        const ids = new Set([...Object.keys(sums), ...Object.keys(_custBalance)]);
        ids.forEach(id => {
            const v = Math.round((sums[id] || 0) * 100) / 100;
            if (Math.abs(v - (_custBalance[id] || 0)) > 0.004) changed = true;
            _custBalance[id] = v;
        });
        if (changed) _onCustBalancesChanged();
    } catch (e) { console.error('Авансы клиентов: не загрузились', e); }
}
// v949: после изменения баланса перерисовываем строку в заказе и пометки в списке клиентов
function _onCustBalancesChanged() {
    try { renderOrderCreditHint(); } catch (e) { console.error(e); }
    try {
        if (typeof renderCustomerCards === 'function' && document.getElementById('customerCardsBody')) {
            renderCustomerCards();
            if (typeof filterCustomersList === 'function') filterCustomersList();
        }
    } catch (e) { console.error(e); }
}
// v949: строка «У клиента аванс X €» под полем «Клиент» в заказе
function renderOrderCreditHint() {
    const box = document.getElementById('detailCreditHint');
    if (!box) return;
    const order = (typeof currentOrderId !== 'undefined' && currentOrderId != null) ? orders.find(o => o.id === currentOrderId) : null;
    const bal = (order && order.customer_id) ? (_custBalance[order.customer_id] || 0) : 0;
    if (bal > 0.004) box.textContent = t('credit_hint_order').replace('{sum}', formatMoney(bal));
    box.classList.toggle('hidden', !(bal > 0.004));
}
// v949: при открытии заказа и смене клиента — подгрузить баланс и показать строку; блок «Оплата» пересчитать
async function refreshOrderCreditHint() {
    renderOrderCreditHint();
    const order = (typeof currentOrderId !== 'undefined' && currentOrderId != null) ? orders.find(o => o.id === currentOrderId) : null;
    if (!order || !order.customer_id) return;
    const forOrder = order.id;
    await loadCustomerBalance(order.customer_id);
    if (currentOrderId === forOrder) {
        renderOrderCreditHint();
        if (_orderPaymentsFor === forOrder) renderPayments();
    }
}
let _orderPaymentsFor = null;   // v945: id заказа, чьи оплаты сейчас в _orderPayments
const _payChgState = {};        // v945: { orderId: { prev, warned } } — для одноразового окна «заказ изменён после оплаты»
let _orderPaidTotals = {}; // { orderId: сумма всех платежей } — для отметки статуса оплаты в списке заказов
let _orderCreditTotals = {}; // v952: { orderId: сумма, закрытая авансом клиента (kind='from_credit') } — часть _orderPaidTotals; деньгами получено = _orderPaidTotals − _orderCreditTotals
// Источник оплаты (16.10): значок «банк + молния» на плашке оплаты — только если оплату зачла
// программа АВТОМАТИЧЕСКИ (bank_transactions.match_status = 'auto_matched').
let _orderBankTx = {};          // { orderId: [bank_transaction_id, …] } — из загрузки всех оплат при запуске
let _bankAutoTxIds = new Set(); // id автозачтённых поступлений (грузит bank.js, только менеджерам с подключённым банком)
let _payTxStatus = {};          // { bank_transaction_id: match_status } — для оплат открытого заказа

function orderHasAutoBankPay(orderId) {
    const ids = _orderBankTx[orderId];
    return !!(ids && ids.some(id => _bankAutoTxIds.has(id)));
}
// Значок «банк + молния» (автозачёт банком)
function payAutoBankIconHtml(size) {
    const s = size || 12;
    return `<span class="pp-auto" title="${escapeHtml(t('bank_tag_auto'))}"><svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8"/><path d="M3 20h18"/></svg><svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg></span>`;
}
// Подпись источника банковской оплаты: «банк · авто» / «банк · вручную» (статус неизвестен — «из банка»)
function payBankSourceLabel(p) {
    const st = _payTxStatus[p.bank_transaction_id];
    return t(st === 'auto_matched' ? 'bank_tag_auto' : st ? 'bank_tag_manual' : 'bank_from_bank');
}

async function loadOrderPayments(orderId) {
    delete _payChgState[orderId];
    const banner = document.getElementById('detailConsBanner');
    if (banner) banner.classList.add('hidden'); // не показываем плашку предыдущего заказа, пока грузится
    try {
        let res = await db.from('order_payments')
            .select('id, amount, method, paid_at, note, created_by, created_at, consolidated_invoice_id, bank_transaction_id, order_snapshot, kind')
            .eq('order_id', orderId)
            .order('paid_at', { ascending: false });
        if (res.error) { // запасной вариант: без пометки «из банка» список оплат всё равно должен открыться
            res = await db.from('order_payments')
                .select('id, amount, method, paid_at, note, created_by, created_at, consolidated_invoice_id')
                .eq('order_id', orderId)
                .order('paid_at', { ascending: false });
        }
        if (res.error) throw res.error;
        _orderPayments = res.data || [];
        _orderPaymentsFor = orderId;
        // Статусы поступлений банка для оплат этого заказа (авто / вручную). Читать их может
        // только менеджер (RLS) — у остальных подпись останется «из банка».
        const txIds = [...new Set(_orderPayments.map(p => p.bank_transaction_id).filter(Boolean))];
        _orderBankTx[orderId] = txIds;
        if (txIds.length) {
            const { data: txs, error: txErr } = await db.from('bank_transactions').select('id, match_status').in('id', txIds);
            if (!txErr) (txs || []).forEach(x => {
                _payTxStatus[x.id] = x.match_status;
                if (x.match_status === 'auto_matched') _bankAutoTxIds.add(x.id); else _bankAutoTxIds.delete(x.id);
            });
        }
    } catch (e) {
        console.error('Ошибка загрузки платежей:', e);
        _orderPayments = [];
    }

    // Подставляем срок оплаты из уже загруженного заказа
    const order = orders.find(o => o.id === orderId);
    if (order && order.customer_id) await loadCustomerBalance(order.customer_id);   // v946
    // Номер сводного счёта (для строки «Входит в счёт …» и подписей оплат)
    const consIds = new Set(_orderPayments.map(p => p.consolidated_invoice_id).filter(Boolean));
    if (order && order.consolidated_invoice_id) consIds.add(order.consolidated_invoice_id);
    await _payLoadConsNumbers([...consIds]);
    _renderDetailConsBanner(order);
    if (order && typeof refreshDetailDue === 'function') refreshDetailDue(order);

    // Держим общую сводку по заказу в синхронизации со списком заказов
    // (до отрисовки — строка сводного счёта считает остатки по _orderPaidTotals)
    _orderPaidTotals[orderId] = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
    _orderCreditTotals[orderId] = Math.round(_orderPayments.filter(p => p.kind === 'from_credit').reduce((s, p) => s + Number(p.amount) * 100, 0)) / 100;   // v952

    renderPayments();
    if (typeof displayOrders === 'function') displayOrders();
}

// Итог заказа берём из уже отрисованной карточки (там учтены скидка и НДС) —
// чтобы не дублировать расчёт в двух местах и не разойтись с тем, что видит пользователь.
function getOrderTotalValue() {
    const el = document.getElementById('detailTotal');
    if (!el) return 0;
    const raw = (el.textContent || '').replace(/[^\d.,-]/g, '').replace(',', '.');
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
}

// v945: заказ изменился после последней оплаты, у которой есть снимок → { old, cur, paid } или null
function _payChangedInfo(order, total, paid) {
    // v952: эталон — ПЕРВАЯ реальная оплата со снимком (самая ранняя по дате, при равных датах — по времени записи);
    // перенос в аванс, зачёт аванса и возврат эталон не сбивают
    const real = _orderPayments.filter(x => x.order_snapshot && (!x.kind || x.kind === 'payment'));
    real.sort((a, b) => String(a.paid_at || '').localeCompare(String(b.paid_at || '')) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const p = real[0];
    if (!p || !order) return null;
    const s = p.order_snapshot;
    try {
        let chg = Math.abs(Number(s.total) - total) > 0.004;
        if (!chg) chg = _docItemsSig(orderBillItems(order)) !== _docItemsSig(s.items)
            || Math.round((Number(order.discount) || 0) * 100) !== Math.round((Number(s.discount) || 0) * 100)
            || !!(s.date && order.date && String(s.date) !== String(order.date));
        return chg ? { old: Number(s.total), cur: total, paid } : null;
    } catch (e) { console.error(e); return null; }
}

function renderPayments() {
    const total = getOrderTotalValue();
    const paid = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Math.max(0, total - paid);
    const overpaid = Math.max(0, paid - total);

    // Сравнение сумм ведём в центах (округлённо) — иначе 21.70 + 4.56 = 26.259999999999998
    // в JS оказывается МЕНЬШЕ total=26.26, и статус ошибочно остаётся "частично оплачен",
    // хотя отображаемая (округлённая) сумма остатка уже показывает 0.00 €.
    const totalCents = Math.round(total * 100);
    const paidCents = Math.round(paid * 100);

    const paidEl = document.getElementById('paymentPaidAmount');
    const remEl = document.getElementById('paymentRemainingAmount');
    const _credC = Math.max(0, Math.round((_orderCreditTotals[currentOrderId] || 0) * 100));
    if (paidEl) paidEl.textContent = formatMoney(_credC > 0 ? (Math.round(paid * 100) - _credC) / 100 : paid);   // v952
    const paidRowLbl = document.getElementById('paymentPaidLabel');
    if (paidRowLbl) paidRowLbl.textContent = t(_credC > 0 ? 'pay_tile_money' : 'orders_paid');
    const credRow = document.getElementById('paymentCreditRow');
    if (credRow) {
        credRow.classList.toggle('hidden', _credC <= 0);
        const credRowEl = document.getElementById('paymentCreditAmount');
        if (credRowEl) credRowEl.textContent = formatMoney(_credC / 100);
    }
    if (remEl) remEl.textContent = formatMoney(remaining);

    _renderPaymentTiles(paidCents, totalCents);
    _renderPaymentConsLine();
    _renderPaymentLastLine();

    // v946: действия с переплатой и зачёт аванса клиента (каждое — через окно подтверждения)
    const curOrder = orders.find(o => o.id === currentOrderId);
    const bal = (curOrder && curOrder.customer_id) ? (_custBalance[curOrder.customer_id] || 0) : 0;
    const actBox = document.getElementById('paymentCreditActions');
    if (actBox) {
        const btns = [];
        const btnCls = 'pill-btn-secondary flex-1 justify-center';
        if (overpaid > 0.004) {
            if (curOrder && curOrder.customer_id) btns.push(`<button type="button" onclick="openCreditOp('to_credit')" class="${btnCls}" style="padding:8px 10px;">${escapeHtml(t('credit_btn_to_credit'))}</button>`);
            btns.push(`<button type="button" onclick="openCreditOp('refund_order')" class="${btnCls}" style="padding:8px 10px;">${escapeHtml(t('credit_btn_refund'))}</button>`);
        }
        if (remaining > 0.004 && bal > 0.004) {
            btns.push(`<button type="button" onclick="openCreditOp('from_credit')" class="${btnCls}" style="padding:8px 10px;">${escapeHtml(t('credit_btn_apply').replace('{sum}', formatMoney(bal)))}</button>`);
        }
        actBox.innerHTML = btns.join('');
        actBox.classList.toggle('hidden', !btns.length);
    }
    const noteBox = document.getElementById('paymentCreditNote');
    if (noteBox) {
        let nt = '';
        if (overpaid > 0.004) nt = t('credit_note_overpaid').replace('{sum}', formatMoney(overpaid));
        else if (remaining > 0.004 && bal > 0.004) nt = t('credit_note_has_advance').replace('{sum}', formatMoney(bal));
        noteBox.textContent = nt;
        noteBox.classList.toggle('hidden', !nt);
    }
    const overpaidRow = document.getElementById('paymentOverpaidRow');
    if (overpaidRow) {
        overpaidRow.classList.toggle('hidden', overpaid <= 0);
        const overpaidEl = document.getElementById('paymentOverpaidAmount');
        if (overpaidEl) overpaidEl.textContent = formatMoney(overpaid);
    }

    // Шкала прогресса (не больше 100%, даже при переплате)
    const bar = document.getElementById('paymentProgressBar');
    if (bar) {
        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : (paid > 0 ? 100 : 0);
        bar.style.width = pct + '%';
        bar.className = 'h-1.5 rounded-full ' + (paidCents <= 0 ? 'bg-gray-300' : paidCents < totalCents ? 'bg-amber-400' : 'bg-green-500');
    }

    const isFullyPaid = paidCents > 0 && paidCents >= totalCents && totalCents > 0;

    const badge2 = document.getElementById('paymentStatusBadge2');
    [badge2].forEach(b => {
        if (!b) return;
        if (paidCents <= 0) {
            b.textContent = t('pay_status_unpaid');
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
            b.style.cssText = 'background:#f3ded9; color:#a3493d;';
        } else if (paidCents < totalCents) {
            b.textContent = t('pay_status_partial');
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
            b.style.cssText = 'background:#f7e6c4; color:#96712a;';
        } else {
            b.textContent = t('pay_status_paid');
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
            b.style.cssText = 'background:#e3e8df; color:#4f6349;';
        }
    });

    // Кнопка быстрого закрытия остатка — показываем только если есть что закрывать
    const payRemainingBtn = document.getElementById('payRemainingBtn');
    if (payRemainingBtn) payRemainingBtn.classList.toggle('hidden', remaining <= 0);

    const list = document.getElementById('paymentsListContent');
    if (!list) return;
    if (!_orderPayments.length) {
        list.innerHTML = `<p class="text-gray-400" style="font-size:13px;">${t('pay_no_payments_yet')}</p>`;
        return;
    }
    let html = '<div class="flex flex-col gap-1.5">';
    _orderPayments.forEach(p => {
        const emp = employees.find(e => e.id === p.created_by);
        const parts = [formatDateDMY(p.paid_at), formatMoney(p.amount), escapeHtml(payMethodLabel(p.method))];
        const isOp = !!p.kind && p.kind !== 'payment';   // v946: возврат / перенос в аванс / зачёт аванса
        if (p.kind === 'refund') parts[2] = escapeHtml(t('pay_kind_refund')) + ' · ' + parts[2];
        else if (p.kind === 'to_credit') parts[2] = escapeHtml(t('pay_kind_to_credit'));
        else if (p.kind === 'from_credit') parts[2] = escapeHtml(t('pay_kind_from_credit'));
        // Наличные без счёта в режиме «По счёту» — пометка (вычисляется, не хранится)
        if (_payByInvoice() && p.method === 'наличные' && !p.consolidated_invoice_id && !p.bank_transaction_id
            && !orderHasInvoice(orders.find(o => o.id === currentOrderId))) parts[2] += ' · ' + escapeHtml(t('pay_no_invoice'));
        if (emp) parts.push(escapeHtml(emp.name));
        const snapTotal = p.order_snapshot && p.order_snapshot.total != null ? Number(p.order_snapshot.total) : null;
        const snapNote = (!isOp && snapTotal != null && Math.abs(snapTotal - total) > 0.004)
            ? `<div style="font-size:12px; color:#8a6a1f;">${escapeHtml(t('pay_snap_note').replace('{sum}', formatMoney(snapTotal)))}</div>` : '';
        html += `<div class="flex justify-between items-center bg-[#f4f1ea] hover:bg-[#e3e8df] active:bg-[#e3e8df] rounded-lg px-3 py-2.5 cursor-pointer" ${isOp ? dataAction('undoPaymentOp', [p.id]) : dataAction('openEditPaymentModal', [p.id])}>
            <div class="min-w-0" style="font-size:13px;"><div class="font-medium text-gray-800 truncate">${parts.join(' · ')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>${p.consolidated_invoice_id ? `<div style="font-size:12px; color:#4f6349;">${escapeHtml(t(_consInvCancelled[p.consolidated_invoice_id] ? 'pay_cons_tag_cancelled' : 'pay_cons_tag').replace('{number}', _payConsNumber(p.consolidated_invoice_id)))}</div>` : ''}${snapNote}</div>
            ${p.bank_transaction_id
                ? `<span class="shrink-0 ml-2" style="font-size:11px; background:#eef2ea; color:#4f6349; border-radius:6px; padding:2px 7px; white-space:nowrap; display:inline-flex; align-items:center; gap:3px;">${_payTxStatus[p.bank_transaction_id] === 'auto_matched' ? payAutoBankIconHtml(11) : ''}${escapeHtml(payBankSourceLabel(p))}</span>`
                : `<span class="action-icon icon-edit shrink-0 ml-2">${icon(isOp ? 'trash' : 'edit', 'w-4 h-4')}</span>`}
        </div>`;
    });
    html += '</div>';
    const chg = _payChangedInfo(orders.find(o => o.id === currentOrderId), total, paid);
    if (chg) {
        html = `<div style="background:#f8efd9; color:#8a6a1f; border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:13px;">${escapeHtml(t('pay_changed_plate').replace('{old}', formatMoney(chg.old)).replace('{new}', formatMoney(chg.cur)).replace('{paid}', formatMoney(chg.paid)))}</div>` + html;
    }
    const stt = _payChgState[currentOrderId] || (_payChgState[currentOrderId] = { prev: undefined, warned: false });
    if (chg && stt.prev === false && !stt.warned) {
        stt.warned = true;
        setTimeout(() => showInfo(t('pay_changed_once').replace('{old}', formatMoney(chg.old)).replace('{new}', formatMoney(chg.cur)).replace('{paid}', formatMoney(chg.paid))), 0);
    }
    if (!chg) stt.warned = false;
    stt.prev = !!chg;
    list.innerHTML = html;
}

function openPaymentModal() {
    document.getElementById('paymentDetailModal').style.display = 'flex';
}

// ── Срок оплаты ──────────────────────────────────────────────────────────────

async function saveDueDate() {
    if (!currentOrderId) return;
    const val = document.getElementById('detailDue').value || null;   // пусто = вернуть автоматический срок (дата заказа + отсрочка клиента)
    const order = orders.find(o => o.id === currentOrderId);
    const prev = order ? (order.due_date || null) : null;
    try {
        await updateChecked(db.from('orders').update({ due_date: val }).eq('id', currentOrderId));
        if (order) order.due_date = val;
        if (order) refreshDetailDue(order);
        if (typeof displayOrders === 'function') displayOrders();
        if (typeof showAutosaveToast === 'function') showAutosaveToast();
    } catch (e) {
        console.error(e);
        if (order) { order.due_date = prev; refreshDetailDue(order); }
        showInfo(t('error_save_due_date'));
    }
}

// ── Добавление / редактирование платежа ───────────────────────────────────────

// ── Режим оплаты пекарни (21.10) ─────────────────────────────────────────────
// «По счёту»: оплата вносится только по выставленному счёту (счёт выставлен, в том числе без отправки, или заказ в сводном).
// Исключение (только защищённая орг. id1, настройка cash_without_invoice): частные клиенты — наличными без счёта.
function orderHasInvoice(o) { return !!(o && (o.inv_no || o.invoice_sent_at || o.consolidated_invoice_id)); }
// Режим «По счёту» (31.10): документы ведутся и отслеживаются. В режиме «По заказу» разделы документов скрыты.
function docsEnabled() { return typeof currentOrgPaymentMode !== 'undefined' && currentOrgPaymentMode === 'invoice'; }
// Есть ли выставленные документы (после возврата с «По счёту» раздел остаётся доступным)
function _anyIssuedDocs() { return (typeof orders !== 'undefined' ? orders : []).some(o => o && (o.inv_no || o.dn_no || o.consolidated_invoice_id)); }
function refreshDocsVisibility() {
    if (typeof refreshDocs2Visibility === 'function') refreshDocs2Visibility(); // новый раздел «Документы» (тест, 31.10.2026)
    const show = docsEnabled() || _anyIssuedDocs();
    const b = document.getElementById('ordersDocsBtn'); if (b) b.classList.toggle('hidden', !show);
    const c = document.getElementById('cdDocsBtn'); if (c) c.classList.toggle('hidden', !show);
    const f = document.querySelector('.status-option[onclick*="noinv"]'); if (f) f.classList.toggle('hidden', !docsEnabled());
    const lbl = document.getElementById('detailSendDocLabel');
    if (lbl) { const k = docsEnabled() ? 'orders_invoice_doc' : 'conf_btn'; if (lbl.getAttribute('data-i18n') !== k) { lbl.setAttribute('data-i18n', k); lbl.textContent = t(k); } }
    const sel = document.getElementById('orderPaymentFilter');
    if (!docsEnabled() && sel && sel.value === 'noinv') { sel.value = ''; if (typeof applyOrderFilter === 'function') { try { applyOrderFilter(); } catch (e) {} } }
}
function _payByInvoice() { return typeof currentOrgPaymentMode !== 'undefined' && currentOrgPaymentMode === 'invoice'; }
// 'ok' | 'cash_only' | 'need_invoice'
function payGateFor(order) {
    if (!_payByInvoice() || !order || orderHasInvoice(order)) return 'ok';
    const cust = order.customer_id ? customers.find(c => c.id === order.customer_id) : null;
    const isPrivate = !cust || cust.entity_type !== 'company';
    return (currentOrgCashNoInv && isPrivate) ? 'cash_only' : 'need_invoice';
}
function _payApplyGate(gate) {
    const box = document.getElementById('payGateBox');
    const fields = document.getElementById('payFormFields');
    const saveBtn = document.getElementById('paymentSaveBtn');
    const sel = document.getElementById('paymentMethod');
    if (sel) Array.from(sel.options).forEach(o => { o.disabled = gate === 'cash_only' && o.value !== 'наличные'; });
    if (gate === 'cash_only' && sel) sel.value = 'наличные';
    if (box) box.classList.toggle('hidden', gate === 'ok');
    const note = document.getElementById('payGateNote');
    if (note) note.textContent = gate === 'need_invoice' ? t('pay_gate_need_inv') : gate === 'cash_only' ? t('pay_gate_cash_only') : '';
    if (fields) fields.classList.toggle('hidden', gate === 'need_invoice');
    if (saveBtn) saveBtn.classList.toggle('hidden', gate === 'need_invoice');
    if (_payModal) _payModal.gate = gate;
}
function payGateIssueInvoice() {
    const id = currentOrderId;
    document.getElementById('addPaymentModal').style.display = 'none';
    if (id && typeof openSendDocumentSheet === 'function') openSendDocumentSheet(id, 'invoice');
}

// «Информация о компании» → блок «Документы и оплата» (30.10.2026; раньше — Настройки → «Оплата»)
function refreshPaymentModeUI() {
    const mode = _payByInvoice() ? 'invoice' : 'order';
    const isOwner = !!(currentEmployee && currentEmployee.is_owner);
    const optO = document.getElementById('payOptOrder'), optI = document.getElementById('payOptInvoice');
    if (optO) optO.classList.toggle('on', mode === 'order');
    if (optI) optI.classList.toggle('on', mode === 'invoice');
    const box = document.getElementById('payModeBox');
    if (box) box.style.opacity = isOwner ? '' : '.6';
    const dateWrap = document.getElementById('payInvFromWrap');
    if (dateWrap) dateWrap.classList.toggle('hidden', mode !== 'invoice');
    calSetFieldValue('payInvFromInput', 'payInvFromLabel', currentOrgInvoicingFrom || '');
    const dateBtn = document.getElementById('payInvFromBtn');
    if (dateBtn) dateBtn.disabled = !isOwner;
    const row = document.getElementById('payCashNoInvRow');
    if (row) row.classList.toggle('hidden', !(currentOrgProtected && mode === 'invoice'));
    const cb = document.getElementById('payCashNoInvToggle');
    if (cb) { cb.checked = !!currentOrgCashNoInv; cb.disabled = !isOwner; }
    const hint = document.getElementById('payModeOwnerHint');
    if (hint) hint.classList.toggle('hidden', isOwner);
}
async function _saveOrgPayment(fields) {
    try {
        await updateChecked(db.from('organizations').update(fields).eq('id', currentOrgId));
        if ('payment_mode' in fields) currentOrgPaymentMode = fields.payment_mode;
        if ('cash_without_invoice' in fields) currentOrgCashNoInv = fields.cash_without_invoice;
        if ('invoicing_from' in fields) currentOrgInvoicingFrom = fields.invoicing_from;
    } catch (e) {
        console.error(e);
        showInfo(e && e.code === '42501' ? t('pay_set_owner_only') : t('error_save_check_connection'));
    }
    refreshPaymentModeUI();
    refreshDocsVisibility();
    if (typeof displayOrders === 'function') { try { displayOrders(); } catch (e) {} }
}
async function setPaymentMode(mode) {
    if (!(currentEmployee && currentEmployee.is_owner)) { refreshPaymentModeUI(); return; }
    const want = mode === 'invoice' ? 'invoice' : 'order';
    if (want === (_payByInvoice() ? 'invoice' : 'order')) return;
    // Переход на «По счёту» (31.10): подтверждение с датой учёта; защищённую id1 не трогаем
    if (want === 'invoice' && !currentOrgProtected) {
        const d = currentOrgInvoicingFrom || getLocalDateStr(0);
        const ok = await showConfirm(t('pay_switch_confirm').replace('{d}', d), { ok: t('pay_switch_ok'), cancel: t('common_cancel') });
        if (!ok) { refreshPaymentModeUI(); return; }
    }
    const fields = { payment_mode: mode === 'invoice' ? 'invoice' : 'order' };
    // При переходе на «По счёту» дата учёта по умолчанию — сегодня (защищённую пекарню id1 не трогаем)
    if (fields.payment_mode === 'invoice' && !currentOrgInvoicingFrom && !currentOrgProtected) fields.invoicing_from = getLocalDateStr(0);
    await _saveOrgPayment(fields);
    // Реквизиты для документов: название и банковский счёт (подсказка, без запрета)
    if (want === 'invoice' && !currentOrgProtected) {
        const g = id => { const e = document.getElementById(id); return e ? (e.value || '').trim() : ''; };
        const hasName = g('cmpLegalName') || g('cmpLegalNameIndividual');
        if (!hasName || !g('cmpBankAccount')) showInfo(t('pay_switch_need_req'));
    }
}
function setInvoicingFrom(value) { _saveOrgPayment({ invoicing_from: value || null }); }
function setCashNoInvoice(on) { _saveOrgPayment({ cash_without_invoice: !!on }); }

function openAddPaymentModal(fillRemaining) {
    document.getElementById('paymentEditId').value = '';
    document.getElementById('paymentModalTitle').textContent = t('orders_add_payment_title');
    document.getElementById('paymentDeleteBtn').classList.add('hidden');

    const order = orders.find(o => o.id === currentOrderId);
    _payModalSub(order);

    // Заказ из сводного счёта с остатком по счёту — по умолчанию оплата по счёту
    const cons = order ? _payConsState(order) : null;
    _payModal = { cons: (cons && cons.remC > 0) ? cons : null, mode: 'order', fillRemaining: !!fillRemaining };
    if (_payModal.cons) _payModal.mode = 'cons';

    calSetFieldValue('paymentDate', 'paymentDateBtnLabel', getLocalDateStr(0));
    document.getElementById('paymentMethod').value = 'наличные';
    document.getElementById('paymentNote').value = '';
    _payApplyMode();
    _payApplyGate(_payModal.mode === 'cons' ? 'ok' : payGateFor(order));
    document.getElementById('addPaymentModal').style.display = 'flex';
}

function openEditPaymentModal(paymentId) {
    const p = _orderPayments.find(pay => pay.id === paymentId);
    if (!p) { console.error('openEditPaymentModal: платёж не найден —', paymentId); return; }
    if (p.bank_transaction_id) { _payBankLockedMessage(); return; } // оплата из банка правится только через «Поступления»
    document.getElementById('paymentEditId').value = p.id;
    document.getElementById('paymentModalTitle').textContent = t('pay_edit_title');
    document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !hasPermission('can_delete'));

    // Правка одной записи — без переключателя и распределения
    _payModal = { cons: null, mode: 'order', fillRemaining: false };
    _payApplyMode();
    _payApplyGate('ok'); // правка уже внесённой оплаты — без ограничений режима
    const order = orders.find(o => o.id === currentOrderId);
    _payModalSub(order);
    if (p.consolidated_invoice_id) {
        const sub = document.getElementById('paymentModalSub');
        if (sub) sub.textContent += ' · ' + t('pay_cons_tag').replace('{number}', _payConsNumber(p.consolidated_invoice_id));
    }

    document.getElementById('paymentAmount').value = Number(p.amount).toFixed(2);
    calSetFieldValue('paymentDate', 'paymentDateBtnLabel', p.paid_at);
    document.getElementById('paymentMethod').value = p.method || 'наличные';
    document.getElementById('paymentNote').value = p.note || '';
    document.getElementById('addPaymentModal').style.display = 'flex';
}

// ==================== v946: АВАНС КЛИЕНТА, ЗАЧЁТ, ВОЗВРАТ ====================
// Переплата по заказу → «в аванс клиента» (оплата −X вида to_credit + запись в customer_credits +X)
//                     или «вернуть клиенту» (оплата −X вида refund).
// Аванс на новый заказ → «зачесть» (оплата +X вида from_credit + запись в customer_credits −X).
// Из карточки клиента → «вернуть аванс» (запись в customer_credits −X вида refund).
// Каждое действие — через окно подтверждения. Статус и остаток заказа считаются как раньше (сумма всех оплат).
let _creditOp = null;   // { kind, orderId, custId, max }

function _creditOpOrderState() {
    const order = orders.find(o => o.id === currentOrderId);
    const total = getOrderTotalValue();
    const paid = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
    return { order, overpaid: Math.round(Math.max(0, paid - total) * 100) / 100, remaining: Math.round(Math.max(0, total - paid) * 100) / 100 };
}

function _creditOpOpen(st, title, sub) {
    _creditOp = st;
    document.getElementById('creditOpTitle').textContent = title;
    document.getElementById('creditOpSub').textContent = sub;
    document.getElementById('creditOpAmount').value = st.max.toFixed(2);
    document.getElementById('creditOpDate').value = getLocalDateStr(0);
    document.getElementById('creditOpMethodWrap').classList.toggle('hidden', !(st.kind === 'refund_order' || st.kind === 'refund_credit'));
    document.getElementById('creditOpModal').style.display = 'flex';
}

function openCreditOp(kind) {
    const s = _creditOpOrderState();
    const order = s.order;
    if (!order) return;
    const custId = order.customer_id || null;
    const name = order.customer || '';
    const bal = custId ? (_custBalance[custId] || 0) : 0;
    if (kind === 'to_credit') {
        if (!custId) { showInfo(t('credit_op_need_customer')); return; }
        if (s.overpaid <= 0.004) return;
        _creditOpOpen({ kind, orderId: order.id, custId, max: s.overpaid }, t('credit_op_title_to_credit'), t('credit_op_sub_to_credit').replace('{name}', name));
    } else if (kind === 'refund_order') {
        if (s.overpaid <= 0.004) return;
        _creditOpOpen({ kind, orderId: order.id, custId, max: s.overpaid }, t('credit_op_title_refund'), t('credit_op_sub_refund_order'));
    } else if (kind === 'from_credit') {
        const max = Math.round(Math.min(bal, s.remaining) * 100) / 100;
        if (max <= 0.004) return;
        _creditOpOpen({ kind, orderId: order.id, custId, max }, t('credit_op_title_apply'), t('credit_op_sub_apply').replace('{bal}', formatMoney(bal)).replace('{name}', name));
    }
}

// Возврат аванса — из карточки клиента
function openCustomerRefund() {
    const custId = (typeof currentCustomerId !== 'undefined') ? currentCustomerId : null;
    const bal = custId ? (_custBalance[custId] || 0) : 0;
    if (!custId || bal <= 0.004) return;
    _creditOpOpen({ kind: 'refund_credit', orderId: null, custId, max: bal }, t('credit_op_title_refund_credit'), t('credit_op_sub_refund_credit').replace('{bal}', formatMoney(bal)));
}

async function _creditInsPay(order, amount, kind, method, date) {
    const { data, error } = await db.from('order_payments').insert({
        org_id: currentOrgId, order_id: order.id, amount, method, paid_at: date, kind,
        created_by: currentEmployee ? currentEmployee.id : null,
        order_snapshot: _payOrderSnap(order),
    }).select('id').single();
    if (error) throw error;
    return data.id;
}
async function _creditInsCredit(row) {
    const { error } = await db.from('customer_credits').insert(Object.assign({
        org_id: currentOrgId, created_by: currentEmployee ? currentEmployee.id : null,
    }, row));
    if (error) throw error;
}

async function submitCreditOp() {
    const st = _creditOp;
    if (!st) return;
    const raw = parseFloat(document.getElementById('creditOpAmount').value);
    const x = Math.round((raw || 0) * 100) / 100;
    const date = document.getElementById('creditOpDate').value;
    const method = document.getElementById('creditOpMethod').value;
    if (!(x > 0) || x > st.max + 0.004) { showInfo(t('credit_op_amount_bad').replace('{max}', formatMoney(st.max))); return; }
    if (!date) { showInfo(t('pay_date_required')); return; }
    const order = st.orderId ? orders.find(o => o.id === st.orderId) : null;
    showLoading(t('common_saving'));
    try {
        suppressRealtimeFor3s();
        let label = '';
        if (st.kind === 'to_credit') {
            const payId = await _creditInsPay(order, -x, 'to_credit', 'аванс', date);
            try {
                await _creditInsCredit({ customer_id: st.custId, amount: x, kind: 'from_order', order_id: order.id, payment_id: payId, op_date: date });
            } catch (e) { await db.from('order_payments').delete().eq('id', payId); throw e; }
            label = t('pay_kind_to_credit');
        } else if (st.kind === 'refund_order') {
            await _creditInsPay(order, -x, 'refund', method, date);
            label = t('pay_kind_refund');
        } else if (st.kind === 'from_credit') {
            const payId = await _creditInsPay(order, x, 'from_credit', 'аванс', date);
            try {
                await _creditInsCredit({ customer_id: st.custId, amount: -x, kind: 'applied', order_id: order.id, payment_id: payId, op_date: date });
            } catch (e) { await db.from('order_payments').delete().eq('id', payId); throw e; }
            label = t('pay_kind_from_credit');
        } else if (st.kind === 'refund_credit') {
            await _creditInsCredit({ customer_id: st.custId, amount: -x, kind: 'refund', method, op_date: date });
            label = t('credit_hist_refund');
        }
        document.getElementById('creditOpModal').style.display = 'none';
        _creditOp = null;
        await loadCustomerBalance(st.custId);
        if (order) {
            logActivity('order', `${label}: ${formatMoney(x)}`, order.id);
            await loadOrderPayments(order.id);
        } else {
            logActivity('customer', `${label}: ${formatMoney(x)}`);
            const cust = customers.find(c => c.id === st.custId);
            if (cust && typeof renderCustomerCredit === 'function') renderCustomerCredit(cust);
        }
    } catch (e) {
        console.error(e);
        showInfo(t('credit_op_error'));
    } finally { hideLoading(); }
}

// Отмена операции (клик по строке «Возврат» / «Перенос в аванс» / «Зачёт аванса» в списке оплат)
async function undoPaymentOp(paymentId) {
    const p = _orderPayments.find(x => x.id === paymentId);
    if (!p) return;
    if (!(await showConfirm(t('credit_undo_confirm')))) return;
    try {
        suppressRealtimeFor3s();
        const order = orders.find(o => o.id === currentOrderId);
        const { data: cr, error: ce } = await db.from('customer_credits').select('id, customer_id').eq('payment_id', paymentId);
        if (ce) throw ce;
        const custId = (cr && cr[0]) ? cr[0].customer_id : (order ? order.customer_id : null);
        if (p.kind === 'to_credit') {   // деньги из аванса уже могли быть использованы
            const bal = custId ? await loadCustomerBalance(custId) : 0;
            if (bal + 0.004 < Math.abs(Number(p.amount))) { showInfo(t('credit_undo_blocked')); return; }
        }
        showLoading(t('common_saving'));
        const { error } = await db.from('order_payments').delete().eq('id', paymentId);
        if (error) throw error;
        const ids = (cr || []).map(r => r.id);
        if (ids.length) {
            const { error: de } = await db.from('customer_credits').delete().in('id', ids);
            if (de) throw de;
        }
        if (custId) await loadCustomerBalance(custId);
        logActivity('order', `${t('log_payment_deleted')}: ${formatMoney(p.amount)}`, currentOrderId);
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo(t('credit_op_error'));
    } finally { hideLoading(); }
}

async function savePayment() {
    const id = document.getElementById('paymentEditId').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paidAt = document.getElementById('paymentDate').value;
    const method = document.getElementById('paymentMethod').value;
    const note = document.getElementById('paymentNote').value.trim();

    // Режим «По счёту» (21.10): без счёта — нельзя; частным — только наличные
    if (!id && _payModal && _payModal.gate === 'need_invoice') { showInfo(t('pay_gate_need_inv')); return; }
    if (!id && _payModal && _payModal.gate === 'cash_only' && method !== 'наличные') { showInfo(t('pay_gate_cash_only')); return; }
    if (!amount || amount <= 0) { showInfo(t('pay_amount_required')); return; }
    if (!paidAt) { showInfo(t('pay_date_required')); return; }
    if (!currentOrderId) return;

    if (!id && _payModal && _payModal.mode === 'cons' && _payModal.cons) {
        await _saveConsPayment(Math.round(amount * 100), paidAt, method, note);
        return;
    }

    showLoading(t('common_saving'));
    try {
        suppressRealtimeFor3s();
        if (id) {
            await updateChecked(db.from('order_payments')
                .update({ amount, method, paid_at: paidAt, note: note || null })
                .eq('id', id));
            logActivity('order', `${t('log_payment_changed')}: ${formatMoney(amount)} (${method})`, currentOrderId);
        } else {
            const { error } = await db.from('order_payments').insert({
                org_id: currentOrgId,
                order_id: currentOrderId,
                amount, method, paid_at: paidAt,
                note: note || null,
                created_by: currentEmployee ? currentEmployee.id : null,
                order_snapshot: _payOrderSnap(orders.find(o => o.id === currentOrderId))
            });
            if (error) throw error;
            logActivity('order', `${t('log_payment_added')} ${formatMoney(amount)} (${method})`, currentOrderId);
        }
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
        _offerOverpayChoice();   // v948: если после оплаты образовалась переплата — сразу предлагаем решение
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_payment'));
    } finally { hideLoading(); }
}

// v948: окно выбора сразу после оплаты, если она больше суммы заказа. Выбор ведёт в окно подтверждения (openCreditOp).
function _offerOverpayChoice() {
    const s = _creditOpOrderState();
    if (!s.order || s.overpaid <= 0.004) return;
    document.getElementById('overpayChoiceTitle').textContent = t('credit_choice_title').replace('{sum}', formatMoney(s.overpaid));
    document.getElementById('overpayChoiceToCreditBtn').classList.toggle('hidden', !s.order.customer_id);
    document.getElementById('overpayChoiceModal').style.display = 'flex';
}
function overpayChoice(kind) {
    document.getElementById('overpayChoiceModal').style.display = 'none';
    if (kind) openCreditOp(kind);
}

async function deletePayment() {
    const id = document.getElementById('paymentEditId').value;
    if (!id) return;
    const p = _orderPayments.find(pay => String(pay.id) === String(id));

    // Оплата, внесённая по сводному счёту вместе с другими заказами, — спрашиваем,
    // удалить одну запись или всю пачку (пачка = тот же счёт и то же время записи)
    if (p && p.consolidated_invoice_id && p.created_at) {
        try {
            const { data, error } = await db.from('order_payments')
                .select('id, order_id, amount')
                .eq('org_id', currentOrgId)
                .eq('consolidated_invoice_id', p.consolidated_invoice_id)
                .eq('created_at', p.created_at);
            if (error) throw error;
            const rows = data || [];
            if (rows.length > 1) {
                const sumC = rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
                _payBatchDelete = { payment: p, rows };
                document.getElementById('payBatchDeleteText').textContent = t('pay_batch_delete_text')
                    .replace('{number}', _payConsNumber(p.consolidated_invoice_id))
                    .replace('{sum}', formatMoney(sumC / 100))
                    .replace('{date}', formatDateDMY(p.paid_at))
                    .replace('{count}', `${rows.length} ${nWord(rows.length, 'word_orders')}`);
                document.getElementById('payBatchDeleteModal').style.display = 'flex';
                return;
            }
        } catch (e) {
            console.error('Не удалось найти пачку оплаты по счёту:', e);
            showInfo(t('error_delete_generic'));
            return;
        }
    }

    if (!(await showConfirm(t('pay_delete_confirm')))) return;
    showLoading(t('common_deleting'));
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('order_payments').delete().eq('id', id);
        if (error) throw error;
        logActivity('order', t('log_payment_deleted'), currentOrderId);
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        if (e && e.code === '42501') { hideLoading(); _payBankLockedMessage(); return; }
        showInfo(t('error_delete_generic'));
    } finally { hideLoading(); }
}

// Сообщение: оплату из банка нельзя менять здесь; предлагает открыть «Поступления»
async function _payBankLockedMessage() {
    const go = await showConfirm(t('bank_pay_locked_title') + '\n\n' + t('bank_pay_locked_text'), { ok: t('bank_pay_locked_open'), cancel: t('bank_pay_locked_ok') });
    if (go && typeof openBankSection === 'function') {
        const ord = document.getElementById('orderDetail');
        // Уходим в «Поступления» — память «вернуться в карточку позиции» не нужна (22.10)
        if (typeof forgetSmartStockReturn === 'function') forgetSmartStockReturn();
        if (typeof forgetDocsReturn === 'function') forgetDocsReturn();
        if (typeof forgetDocs2Return === 'function') forgetDocs2Return();
        if (ord && typeof closeOrderDetail === 'function') { try { closeOrderDetail(); } catch (e) { /* ничего */ } }
        bankState.tab = 'closed';
        openBankSection().then(() => bankSetTab('closed'));
    }
}

// ==================== ОПЛАТА ПО СВОДНОМУ СЧЁТУ ====================
// Заказ, вошедший в сводный счёт (orders.consolidated_invoice_id), можно оплатить «по счёту»:
// сумма раскладывается по заказам счёта от старых к новым, частичная ложится на последний.
// Записи вставляются одним запросом (все или ни одной) с consolidated_invoice_id; у них одинаковый
// created_at (now() одного запроса) — по паре «счёт + created_at» пачку можно удалить целиком.
// Остатки считаются по текущим суммам заказов (orderGrandTotal) и _orderPaidTotals, в центах.
// Переплата по счёту запрещена.

let _payModal = null;        // { cons, mode: 'cons' | 'order', fillRemaining }
let _payBatchDelete = null;  // { payment, rows } — выбор при удалении оплаты из пачки
const _consInvNumbers = {};  // { consolidatedInvoiceId: 'INV-…' }
const _consInvDates = {};    // { consolidatedInvoiceId: 'YYYY-MM-DD' } — дата выставления
const _consInvCancelled = {}; // { consolidatedInvoiceId: true } — счёт отменён

async function _payLoadConsNumbers(ids) {
    const need = ids.filter(id => !_consInvNumbers[id]);
    if (!need.length) return;
    try {
        const { data, error } = await db.from('consolidated_invoices').select('id, number, issue_date, cancelled_at').in('id', need);
        if (error) throw error;
        (data || []).forEach(r => { _consInvNumbers[r.id] = _formatDocNumber('invoice', r.number) || ('#' + r.id); _consInvDates[r.id] = r.issue_date || null; if (r.cancelled_at) _consInvCancelled[r.id] = true; });
    } catch (e) {
        console.error('Не удалось загрузить номера сводных счетов:', e);
    }
}

function _payConsNumber(id) {
    return _consInvNumbers[id] || '…';
}

// Распределение суммы по заказам: members — [{id, remC}] в порядке от старых к новым.
// Возвращает [{id, addC, leftC}]; addC = 0 у заказов, на которые денег не хватило или которые уже оплачены.
function _payAllocate(members, amountC) {
    let left = Math.max(0, Math.round(amountC));
    return members.map(m => {
        const rem = Math.max(0, m.remC);
        const add = Math.min(rem, left);
        left -= add;
        return { id: m.id, addC: add, leftC: rem - add };
    });
}

// Состояние сводного счёта заказа: состав, сумма, остаток (в центах)
function _payConsState(order) {
    const cid = order && order.consolidated_invoice_id;
    if (!cid) return null;
    const list = orders.filter(o => o.consolidated_invoice_id === cid)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
            || String(a.order_number || '').localeCompare(String(b.order_number || ''))
            || (a.id - b.id));
    const members = list.map(o => {
        const grandC = Math.round(orderGrandTotal(o) * 100);
        const paidC = Math.round((_orderPaidTotals[o.id] || 0) * 100);
        return { id: o.id, order: o, grandC, paidC, remC: Math.max(0, grandC - paidC) };
    });
    const totalC = members.reduce((s, m) => s + m.grandC, 0);
    const remC = members.reduce((s, m) => s + m.remC, 0);
    return { id: cid, number: _payConsNumber(cid), members, totalC, remC, paidC: totalC - remC };
}

// Плитки «Оплачено» / «Остаток» (или «Переплата») и ссылка «История (n)» в блоке заказа
function _renderPaymentTiles(paidCents, totalCents) {
    // v952: «получено деньгами» и «закрыто авансом» — два разных числа; аванса нет — как раньше, «Оплачено»
    const credC = Math.max(0, Math.round((_orderCreditTotals[currentOrderId] || 0) * 100));
    const moneyC = paidCents - credC;
    const paidEl = document.getElementById('paymentTilePaid');
    if (paidEl) paidEl.textContent = formatMoney((credC > 0 ? moneyC : paidCents) / 100);
    const paidLbl = document.getElementById('paymentTilePaidLabel');
    if (paidLbl) paidLbl.textContent = t(credC > 0 ? 'pay_tile_money' : 'orders_paid');
    const credEl = document.getElementById('paymentTileCredit');
    if (credEl) {
        credEl.textContent = credC > 0 ? t('pay_tile_by_credit').replace('{sum}', formatMoney(credC / 100)) : '';
        credEl.classList.toggle('hidden', credC <= 0);
    }
    const tile = document.getElementById('paymentTileRest');
    const lbl = document.getElementById('paymentTileRestLabel');
    const val = document.getElementById('paymentTileRestValue');
    if (tile && lbl && val) {
        const restC = totalCents - paidCents;
        let bg, fg, label;
        if (restC < 0) { bg = '#e9eee5'; fg = '#4f6349'; label = t('orders_overpaid'); }
        else if (restC === 0 || totalCents <= 0) { bg = '#e9eee5'; fg = '#4f6349'; label = t('pay_tile_rest'); }
        else if (paidCents > 0) { bg = '#f7ecd5'; fg = '#96712a'; label = t('pay_tile_rest'); }
        else { bg = '#f8e9e5'; fg = '#a3493d'; label = t('pay_tile_rest'); }
        tile.style.background = bg;
        lbl.style.color = fg; val.style.color = fg;
        lbl.textContent = label;
        val.textContent = formatMoney(Math.abs(restC) / 100);
    }
    const hist = document.getElementById('paymentHistoryLink');
    if (hist) hist.textContent = t('pay_history').replace('{n}', _orderPayments.length);
}

// Строка «Последняя оплата: дата · способ · источник» в блоке «Оплата» заказа (16.10)
function _renderPaymentLastLine() {
    const el = document.getElementById('paymentLastLine');
    if (!el) return;
    const p = _orderPayments[0]; // список отсортирован по дате оплаты, новые сверху
    if (!p) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    let src = '';
    if (p.bank_transaction_id) {
        const auto = _payTxStatus[p.bank_transaction_id] === 'auto_matched';
        src = ` · <span style="display:inline-flex; align-items:center; gap:3px; background:#eef2ea; color:#4f6349; border-radius:6px; padding:1px 6px;">${auto ? payAutoBankIconHtml(11) : ''}${escapeHtml(payBankSourceLabel(p))}</span>`;
    } else {
        const emp = employees.find(e => e.id === p.created_by);
        if (emp) src = ' · ' + escapeHtml(emp.name);
    }
    const d = String(p.paid_at || '').slice(0, 10);
    const dateShort = d ? d.slice(8, 10) + '.' + d.slice(5, 7) : '';
    el.innerHTML = escapeHtml(t('pay_last_line').replace('{date}', dateShort).replace('{method}', payMethodLabel(p.method))) + src;
    el.classList.remove('hidden');
}

// Строка «Входит в счёт INV-… · оплачено X из Y» в блоке заказа
function _renderPaymentConsLine() {
    const el = document.getElementById('paymentConsLine');
    if (!el) return;
    const order = orders.find(o => o.id === currentOrderId);
    const cons = order ? _payConsState(order) : null;
    if (!cons) { el.classList.add('hidden'); return; }
    el.textContent = t('pay_cons_line')
        .replace('{number}', cons.number)
        .replace('{paid}', formatMoney(cons.paidC / 100))
        .replace('{total}', formatMoney(cons.totalC / 100));
    el.classList.remove('hidden');
}

// Плашка в карточке заказа: заказ входит в сводный счёт, изменения попадут в счёт при следующей отправке
function _renderDetailConsBanner(order) {
    const el = document.getElementById('detailConsBanner');
    if (!el) return;
    // Номер сводного мог только что загрузиться — обновляем и сводку под кнопкой документа (22.10)
    if (order && order.id === currentOrderId && typeof renderDetailDocSummary === 'function') renderDetailDocSummary(order);
    if (!order || order.id !== currentOrderId || !order.consolidated_invoice_id) { el.classList.add('hidden'); return; }
    const cid = order.consolidated_invoice_id;
    el.textContent = t('order_cons_banner')
        .replace('{number}', _payConsNumber(cid))
        .replace('{date}', _consInvDates[cid] ? formatDateDMY(_consInvDates[cid]) : '…');
    el.classList.remove('hidden');
}

function _payModalSub(order) {
    const sub = document.getElementById('paymentModalSub');
    if (!sub) return;
    if (!order) { sub.textContent = ''; return; }
    const parts = [order.customer || t('orders_no_customer')];
    if (typeof orderNumLabel === 'function') parts.push(orderNumLabel(order));
    sub.textContent = parts.filter(Boolean).join(' · ');
}

function setPayMode(mode) {
    if (!_payModal) return;
    _payModal.mode = (mode === 'cons' && _payModal.cons) ? 'cons' : 'order';
    _payModal.fillRemaining = true;
    _payApplyMode();
}

// Переключатель, остаток, сумма по умолчанию и распределение — по текущему режиму окна
function _payApplyMode() {
    const st = _payModal || { cons: null, mode: 'order' };
    const sw = document.getElementById('payModeSwitch');
    const remEl = document.getElementById('payConsRemaining');
    const isCons = st.mode === 'cons' && !!st.cons;
    if (sw) {
        sw.classList.toggle('hidden', !st.cons);
        const consBtn = document.getElementById('payModeConsBtn');
        const ordBtn = document.getElementById('payModeOrderBtn');
        if (consBtn) { consBtn.textContent = st.cons ? t('pay_mode_cons').replace('{number}', st.cons.number) : ''; consBtn.classList.toggle('active', isCons); }
        if (ordBtn) ordBtn.classList.toggle('active', !isCons);
    }
    if (remEl) {
        remEl.classList.toggle('hidden', !isCons);
        if (isCons) remEl.innerHTML = escapeHtml(t('pay_cons_remaining')
            .replace('{rem}', formatMoney(st.cons.remC / 100))
            .replace('{total}', formatMoney(st.cons.totalC / 100)));
    }
    if (st.fillRemaining) {
        let remC;
        if (isCons) remC = st.cons.remC;
        else {
            const total = getOrderTotalValue();
            const paid = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
            remC = Math.max(0, Math.round(total * 100) - Math.round(paid * 100));
        }
        document.getElementById('paymentAmount').value = remC > 0 ? (remC / 100).toFixed(2) : '';
    }
    renderPayConsDist();
}

// Предпросмотр распределения под полями окна (только в режиме «По счёту»)
function renderPayConsDist() {
    const box = document.getElementById('payConsDist');
    if (!box) return;
    const st = _payModal;
    if (!st || st.mode !== 'cons' || !st.cons) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const amountC = isNaN(amount) ? 0 : Math.round(amount * 100);
    const over = amountC > st.cons.remC;
    const alloc = _payAllocate(st.cons.members, Math.min(amountC, st.cons.remC));
    const rows = st.cons.members.map((m, i) => {
        const a = alloc[i];
        let label, right = '—', color = '#555';
        if (m.remC <= 0) { label = t('pay_cons_already_paid'); color = '#999'; }
        else if (a.addC <= 0) { label = t('pay_cons_untouched'); color = '#999'; }
        else if (a.leftC <= 0) { label = t('pay_cons_will_close'); right = '+ ' + formatMoney(a.addC / 100); }
        else { label = t('pay_cons_partial_left').replace('{rem}', formatMoney(a.leftC / 100)); right = '+ ' + formatMoney(a.addC / 100); }
        const num = m.order.order_number ? '№' + m.order.order_number : '#' + m.id;
        return `<div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; color:${color}; padding:2px 0;"><span>${escapeHtml(num)} · ${formatDateDMY(m.order.date)} · ${escapeHtml(label)}</span><span style="white-space:nowrap;">${right}</span></div>`;
    }).join('');
    const warn = over ? `<div style="margin-top:6px; font-size:12px; background:#f3ded9; color:#a3493d; border-radius:8px; padding:6px 8px;">${escapeHtml(t('pay_cons_over').replace('{rem}', formatMoney(st.cons.remC / 100)))}</div>` : '';
    box.innerHTML = `<div style="font-size:12px; color:#6b675d; margin-bottom:4px;">${escapeHtml(t('pay_cons_dist_title'))}</div>${rows}${warn}`;
    box.classList.remove('hidden');
}

async function _saveConsPayment(amountC, paidAt, method, note) {
    const order = orders.find(o => o.id === currentOrderId);
    const cons = order ? _payConsState(order) : null; // пересчёт на момент сохранения
    if (!cons || cons.remC <= 0) { showInfo(t('pay_cons_nothing_left')); return; }
    if (amountC > cons.remC) { showInfo(t('pay_cons_over').replace('{rem}', formatMoney(cons.remC / 100))); return; }

    const alloc = _payAllocate(cons.members, amountC).filter(a => a.addC > 0);
    if (!alloc.length) return;
    const createdBy = currentEmployee ? currentEmployee.id : null;
    const rows = alloc.map(a => ({
        org_id: currentOrgId,
        order_id: a.id,
        amount: a.addC / 100,
        method, paid_at: paidAt,
        note: note || null,
        created_by: createdBy,
        consolidated_invoice_id: cons.id,
        order_snapshot: _payOrderSnap(orders.find(o => o.id === a.id))
    }));

    showLoading(t('common_saving'));
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('order_payments').insert(rows);
        if (error) throw error;
        alloc.forEach(a => { _orderPaidTotals[a.id] = Math.round(((_orderPaidTotals[a.id] || 0) * 100) + a.addC) / 100; });
        const desc = `${t('log_cons_payment_added')} ${cons.number}: ${formatMoney(amountC / 100)} (${method}), ${alloc.length} ${nWord(alloc.length, 'word_orders')}`;
        alloc.forEach(a => logActivity('order', desc, a.id));
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_payment'));
    } finally { hideLoading(); }
}

// Выбор в окне удаления оплаты из пачки: 'all' — вся оплата по счёту, 'one' — только эта запись
async function confirmPayBatchDelete(scope) {
    const st = _payBatchDelete;
    document.getElementById('payBatchDeleteModal').style.display = 'none';
    if (!st) return;
    _payBatchDelete = null;
    const ids = scope === 'all' ? st.rows.map(r => r.id) : [st.payment.id];
    const removed = scope === 'all' ? st.rows : st.rows.filter(r => r.id === st.payment.id);
    showLoading(t('common_deleting'));
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('order_payments').delete().in('id', ids).eq('org_id', currentOrgId);
        if (error) throw error;
        removed.forEach(r => {
            _orderPaidTotals[r.order_id] = Math.round(((_orderPaidTotals[r.order_id] || 0) * 100) - Math.round(Number(r.amount) * 100)) / 100;
        });
        const number = _payConsNumber(st.payment.consolidated_invoice_id);
        if (scope === 'all') {
            const sumC = removed.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
            const desc = `${t('log_cons_payment_deleted')} ${number}: ${formatMoney(sumC / 100)}`;
            [...new Set(removed.map(r => r.order_id))].forEach(oid => logActivity('order', desc, oid));
        } else {
            logActivity('order', `${t('log_payment_deleted')} (${number})`, currentOrderId);
        }
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        if (e && e.code === '42501') { hideLoading(); _payBankLockedMessage(); return; }
        showInfo(t('error_delete_generic'));
    } finally { hideLoading(); }
}
