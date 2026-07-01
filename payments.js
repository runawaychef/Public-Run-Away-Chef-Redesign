// ==================== ОПЛАТА ЗАКАЗА ====================
// Депозит и окончательный расчёт — это одна и та же сущность (просто разные записи в истории).
// Статус оплаты считается автоматически по сумме внесённых платежей, а не хранится отдельным полем.
// Зависит от: db, currentOrgId, currentOrderId, currentEmployee, employees, orders (orders.js/employees.js),
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, escapeHtml, logActivity (helpers.js/modals.js),
//             formatDateDMY, getLocalDateStr (dates.js), hasPermission (employees.js).

let _orderPayments = [];

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
    if (dueInput) dueInput.value = order && order.due_date ? order.due_date : '';

    renderPayments();
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

    const paidEl = document.getElementById('paymentPaidAmount');
    const remEl = document.getElementById('paymentRemainingAmount');
    if (paidEl) paidEl.textContent = paid.toFixed(2) + ' €';
    if (remEl) remEl.textContent = remaining.toFixed(2) + ' €';

    const summaryLine = document.getElementById('paymentSummaryLine');
    if (summaryLine) summaryLine.textContent = `Оплачено ${paid.toFixed(2)} € из ${total.toFixed(2)} €`;

    const overpaidRow = document.getElementById('paymentOverpaidRow');
    if (overpaidRow) {
        overpaidRow.classList.toggle('hidden', overpaid <= 0);
        const overpaidEl = document.getElementById('paymentOverpaidAmount');
        if (overpaidEl) overpaidEl.textContent = overpaid.toFixed(2) + ' €';
    }

    // Шкала прогресса (не больше 100%, даже при переплате)
    const bar = document.getElementById('paymentProgressBar');
    if (bar) {
        const pct = total > 0 ? Math.min(100, (paid / total) * 100) : (paid > 0 ? 100 : 0);
        bar.style.width = pct + '%';
        bar.className = 'h-1.5 rounded-full ' + (paid <= 0 ? 'bg-gray-300' : paid < total ? 'bg-amber-400' : 'bg-green-500');
    }

    const isFullyPaid = paid > 0 && paid >= total && total > 0;

    const badge = document.getElementById('paymentStatusBadge');
    const badge2 = document.getElementById('paymentStatusBadge2');
    [badge, badge2].forEach(b => {
        if (!b) return;
        if (paid <= 0) {
            b.textContent = 'Не оплачен';
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600';
        } else if (paid < total) {
            b.textContent = 'Частично оплачен';
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700';
        } else {
            b.textContent = 'Оплачен';
            b.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700';
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
    let html = '<div class="flex flex-col gap-1">';
    _orderPayments.forEach(p => {
        const emp = employees.find(e => e.id === p.created_by);
        html += `<div class="flex justify-between items-center text-xs border-b pb-1 cursor-pointer" onclick='openEditPaymentModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
            <div>
                <div class="font-medium text-gray-800">${Number(p.amount).toFixed(2)} € · ${escapeHtml(p.method || '—')}</div>
                <div class="text-gray-400">${formatDateDMY(p.paid_at)}${emp ? ' · ' + escapeHtml(emp.name) : ''}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>
            </div>
            <span class="text-gray-300">${icon('edit', 'w-3.5 h-3.5')}</span>
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
        const { error } = await db.from('orders').update({ due_date: val }).eq('id', currentOrderId);
        if (error) throw error;
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
    document.getElementById('paymentDate').value = getLocalDateStr(0);
    document.getElementById('paymentMethod').value = 'наличные';
    document.getElementById('paymentNote').value = '';
    document.getElementById('addPaymentModal').style.display = 'flex';
}

function openEditPaymentModal(p) {
    document.getElementById('paymentEditId').value = p.id;
    document.getElementById('paymentModalTitle').textContent = 'Редактировать платёж';
    document.getElementById('paymentDeleteBtn').classList.toggle('hidden', !hasPermission('can_delete'));

    document.getElementById('paymentAmount').value = Number(p.amount).toFixed(2);
    document.getElementById('paymentDate').value = p.paid_at;
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

    showLoading('Сохранение...');
    try {
        if (id) {
            const { error } = await db.from('order_payments')
                .update({ amount, method, paid_at: paidAt, note: note || null })
                .eq('id', id);
            if (error) throw error;
            logActivity('order', `Изменена оплата: ${amount.toFixed(2)} € (${method})`, currentOrderId);
        } else {
            const { error } = await db.from('order_payments').insert({
                org_id: currentOrgId,
                order_id: currentOrderId,
                amount, method, paid_at: paidAt,
                note: note || null,
                created_by: currentEmployee ? currentEmployee.id : null
            });
            if (error) throw error;
            logActivity('order', `Внесена оплата ${amount.toFixed(2)} € (${method})`, currentOrderId);
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
    showLoading('Удаление...');
    try {
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
