// ==================== ОПЛАТА ЗАКАЗА ====================
// Депозит и окончательный расчёт — это одна и та же сущность (просто разные записи в истории).
// Статус оплаты считается автоматически по сумме внесённых платежей, а не хранится отдельным полем.
// Зависит от: db, currentOrgId, currentOrderId, currentEmployee, employees, orders (orders.js/employees.js),
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, escapeHtml, logActivity (helpers.js/modals.js),
//             formatDateDMY, getLocalDateStr (dates.js), hasPermission (employees.js).

let _orderPayments = [];
let _orderPaidTotals = {}; // { orderId: сумма всех платежей } — для отметки статуса оплаты в списке заказов

async function loadOrderPayments(orderId) {
    try {
        const { data, error } = await db.from('order_payments')
            .select('id, amount, method, paid_at, note, created_by')
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
    const dueInput = document.getElementById('orderDueDate');
    if (dueInput) calSetFieldValue('orderDueDate', 'orderDueDateBtnLabel', order && order.due_date ? order.due_date : '');

    renderPayments();

    // Держим общую сводку по заказу в синхронизации со списком заказов
    _orderPaidTotals[orderId] = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
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

    const summaryLine = document.getElementById('paymentSummaryLine');
    if (summaryLine) summaryLine.textContent = `Оплачено ${formatMoney(paid)} из ${formatMoney(total)}`;

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

    const badge = document.getElementById('paymentStatusBadge');
    const badge2 = document.getElementById('paymentStatusBadge2');
    [badge, badge2].forEach(b => {
        if (!b) return;
        if (paidCents <= 0) {
            b.textContent = 'Не оплачен';
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
            b.style.cssText = 'background:#f3ded9; color:#a3493d;';
        } else if (paidCents < totalCents) {
            b.textContent = 'Частично оплачен';
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full';
            b.style.cssText = 'background:#f7e6c4; color:#96712a;';
        } else {
            b.textContent = 'Оплачен';
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
        list.innerHTML = '<p class="text-xs text-gray-400">Платежей ещё не было</p>';
        return;
    }
    let html = '<div class="flex flex-col gap-1.5">';
    _orderPayments.forEach(p => {
        const emp = employees.find(e => e.id === p.created_by);
        const parts = [formatDateDMY(p.paid_at), formatMoney(p.amount), escapeHtml(p.method || '—')];
        if (emp) parts.push(escapeHtml(emp.name));
        html += `<div class="flex justify-between items-center text-xs bg-[#f4f1ea] hover:bg-[#e3e8df] active:bg-[#e3e8df] rounded-lg px-3 py-2.5 cursor-pointer" ${dataAction('openEditPaymentModal', [p.id])}>
            <div class="font-medium text-gray-800 truncate">${parts.join(' · ')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>
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
        showInfo('Не удалось сохранить срок оплаты.');
    }
}

// ── Добавление / редактирование платежа ───────────────────────────────────────

function openAddPaymentModal(fillRemaining) {
    document.getElementById('paymentEditId').value = '';
    document.getElementById('paymentModalTitle').textContent = 'Добавить оплату';
    document.getElementById('paymentDeleteBtn').classList.add('hidden');

    const total = getOrderTotalValue();
    const paid = _orderPayments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Math.max(0, total - paid);

    document.getElementById('paymentAmount').value = fillRemaining && remaining > 0 ? remaining.toFixed(2) : '';
    calSetFieldValue('paymentDate', 'paymentDateBtnLabel', getLocalDateStr(0));
    document.getElementById('paymentMethod').value = 'наличные';
    document.getElementById('paymentNote').value = '';
    document.getElementById('addPaymentModal').style.display = 'flex';
}

function openEditPaymentModal(paymentId) {
    const p = _orderPayments.find(pay => pay.id === paymentId);
    if (!p) { console.error('openEditPaymentModal: платёж не найден —', paymentId); return; }
    document.getElementById('paymentEditId').value = p.id;
    document.getElementById('paymentModalTitle').textContent = 'Редактировать платёж';
    document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !hasPermission('can_delete'));

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

    if (!amount || amount <= 0) { showInfo('Укажите сумму больше нуля.'); return; }
    if (!paidAt) { showInfo('Укажите дату.'); return; }
    if (!currentOrderId) return;

    showLoading(t('common_saving'));
    try {
        suppressRealtimeFor3s();
        if (id) {
            await updateChecked(db.from('order_payments')
                .update({ amount, method, paid_at: paidAt, note: note || null })
                .eq('id', id));
            logActivity('order', `Изменена оплата: ${formatMoney(amount)} (${method})`, currentOrderId);
        } else {
            const { error } = await db.from('order_payments').insert({
                org_id: currentOrgId,
                order_id: currentOrderId,
                amount, method, paid_at: paidAt,
                note: note || null,
                created_by: currentEmployee ? currentEmployee.id : null
            });
            if (error) throw error;
            logActivity('order', `Внесена оплата ${formatMoney(amount)} (${method})`, currentOrderId);
        }
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo('Ошибка сохранения платежа.');
    } finally { hideLoading(); }
}

async function deletePayment() {
    const id = document.getElementById('paymentEditId').value;
    if (!id) return;
    if (!(await showConfirm('Удалить эту запись об оплате?'))) return;
    showLoading(t('common_deleting'));
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('order_payments').delete().eq('id', id);
        if (error) throw error;
        logActivity('order', 'Удалена запись об оплате', currentOrderId);
        document.getElementById('addPaymentModal').style.display = 'none';
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo('Ошибка удаления.');
    } finally { hideLoading(); }
}
