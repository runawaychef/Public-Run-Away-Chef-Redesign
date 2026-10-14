// ==================== ОПЛАТА ЗАКАЗА ====================
// Депозит и окончательный расчёт — это одна и та же сущность (просто разные записи в истории).
// Статус оплаты считается автоматически по сумме внесённых платежей, а не хранится отдельным полем.
// Зависит от: db, currentOrgId, currentOrderId, currentEmployee, employees, orders (orders.js/employees.js),
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, escapeHtml, logActivity (helpers.js/modals.js),
//             formatDateDMY, getLocalDateStr (dates.js), hasPermission (employees.js).

let _orderPayments = [];
let _orderPaidTotals = {}; // { orderId: сумма всех платежей } — для отметки статуса оплаты в списке заказов

async function loadOrderPayments(orderId) {
    const banner = document.getElementById('detailConsBanner');
    if (banner) banner.classList.add('hidden'); // не показываем плашку предыдущего заказа, пока грузится
    try {
        const { data, error } = await db.from('order_payments')
            .select('id, amount, method, paid_at, note, created_by, created_at, consolidated_invoice_id')
            .eq('order_id', orderId)
            .order('paid_at', { ascending: false });
        if (error) throw error;
        _orderPayments = data || [];
    } catch (e) {
        console.error('Ошибка загрузки платежей:', e);
        _orderPayments = [];
    }

    // Подставляем срок оплаты из уже загруженного заказа
    const order = orders.find(o => o.id === orderId);
    // Номер сводного счёта (для строки «Входит в счёт …» и подписей оплат)
    const consIds = new Set(_orderPayments.map(p => p.consolidated_invoice_id).filter(Boolean));
    if (order && order.consolidated_invoice_id) consIds.add(order.consolidated_invoice_id);
    await _payLoadConsNumbers([...consIds]);
    _renderDetailConsBanner(order);
    const dueInput = document.getElementById('orderDueDate');
    if (dueInput) calSetFieldValue('orderDueDate', 'orderDueDateBtnLabel', order && order.due_date ? order.due_date : '');

    // Держим общую сводку по заказу в синхронизации со списком заказов
    // (до отрисовки — строка сводного счёта считает остатки по _orderPaidTotals)
    _orderPaidTotals[orderId] = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);

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
    if (paidEl) paidEl.textContent = formatMoney(paid);
    if (remEl) remEl.textContent = formatMoney(remaining);

    _renderPaymentTiles(paidCents, totalCents);
    _renderPaymentConsLine();

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

    // Просрочка: срок указан, прошёл, и заказ не оплачен полностью
    const dueInput = document.getElementById('orderDueDate');
    const overdueTag = document.getElementById('dueDateOverdueTag');
    if (dueInput && overdueTag) {
        const today = getLocalDateStr(0);
        const overdue = dueInput.value && dueInput.value < today && !isFullyPaid;
        overdueTag.classList.toggle('hidden', !overdue);
    }

    const list = document.getElementById('paymentsListContent');
    if (!list) return;
    if (!_orderPayments.length) {
        list.innerHTML = `<p class="text-gray-400" style="font-size:13px;">${t('pay_no_payments_yet')}</p>`;
        return;
    }
    let html = '<div class="flex flex-col gap-1.5">';
    _orderPayments.forEach(p => {
        const emp = employees.find(e => e.id === p.created_by);
        const parts = [formatDateDMY(p.paid_at), formatMoney(p.amount), escapeHtml(p.method || '—')];
        if (emp) parts.push(escapeHtml(emp.name));
        html += `<div class="flex justify-between items-center bg-[#f4f1ea] hover:bg-[#e3e8df] active:bg-[#e3e8df] rounded-lg px-3 py-2.5 cursor-pointer" ${dataAction('openEditPaymentModal', [p.id])}>
            <div class="min-w-0" style="font-size:13px;"><div class="font-medium text-gray-800 truncate">${parts.join(' · ')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>${p.consolidated_invoice_id ? `<div style="font-size:12px; color:#4f6349;">${escapeHtml(t('pay_cons_tag').replace('{number}', _payConsNumber(p.consolidated_invoice_id)))}</div>` : ''}</div>
            <span class="action-icon icon-edit shrink-0 ml-2">${icon('edit', 'w-4 h-4')}</span>
        </div>`;
    });
    html += '</div>';
    list.innerHTML = html;
}

function openPaymentModal() {
    document.getElementById('paymentDetailModal').style.display = 'flex';
}

// ── Срок оплаты ──────────────────────────────────────────────────────────────

async function saveDueDate() {
    if (!currentOrderId) return;
    const val = document.getElementById('orderDueDate').value || null;
    try {
        await updateChecked(db.from('orders').update({ due_date: val }).eq('id', currentOrderId));
        const order = orders.find(o => o.id === currentOrderId);
        if (order) order.due_date = val;
        renderPayments();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_due_date'));
    }
}

// ── Добавление / редактирование платежа ───────────────────────────────────────

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
    document.getElementById('addPaymentModal').style.display = 'flex';
}

function openEditPaymentModal(paymentId) {
    const p = _orderPayments.find(pay => pay.id === paymentId);
    if (!p) { console.error('openEditPaymentModal: платёж не найден —', paymentId); return; }
    document.getElementById('paymentEditId').value = p.id;
    document.getElementById('paymentModalTitle').textContent = t('pay_edit_title');
    document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !hasPermission('can_delete'));

    // Правка одной записи — без переключателя и распределения
    _payModal = { cons: null, mode: 'order', fillRemaining: false };
    _payApplyMode();
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

async function savePayment() {
    const id = document.getElementById('paymentEditId').value;
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paidAt = document.getElementById('paymentDate').value;
    const method = document.getElementById('paymentMethod').value;
    const note = document.getElementById('paymentNote').value.trim();

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
                created_by: currentEmployee ? currentEmployee.id : null
            });
            if (error) throw error;
            logActivity('order', `${t('log_payment_added')} ${formatMoney(amount)} (${method})`, currentOrderId);
        }
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_payment'));
    } finally { hideLoading(); }
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
        showInfo(t('error_delete_generic'));
    } finally { hideLoading(); }
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

async function _payLoadConsNumbers(ids) {
    const need = ids.filter(id => !_consInvNumbers[id]);
    if (!need.length) return;
    try {
        const { data, error } = await db.from('consolidated_invoices').select('id, number, issue_date').in('id', need);
        if (error) throw error;
        (data || []).forEach(r => { _consInvNumbers[r.id] = _formatDocNumber('invoice', r.number) || ('#' + r.id); _consInvDates[r.id] = r.issue_date || null; });
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
    const paidEl = document.getElementById('paymentTilePaid');
    if (paidEl) paidEl.textContent = formatMoney(paidCents / 100);
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
        consolidated_invoice_id: cons.id
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
        showInfo(t('error_delete_generic'));
    } finally { hideLoading(); }
}
