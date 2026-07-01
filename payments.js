// ==================== ОПЛАТА ЗАКАЗА ====================
// Депозит и окончательный расчёт — это одна и та же сущность (просто разные записи в истории).
// Статус оплаты считается автоматически по сумме внесённых платежей, а не хранится отдельным полем.
// Зависит от: db, currentOrgId, currentOrderId, currentEmployee, employees (employees.js),
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

    const paidEl = document.getElementById('paymentPaidAmount');
    const remEl = document.getElementById('paymentRemainingAmount');
    if (paidEl) paidEl.textContent = paid.toFixed(2) + ' €';
    if (remEl) remEl.textContent = remaining.toFixed(2) + ' €';

    const badge = document.getElementById('paymentStatusBadge');
    if (badge) {
        if (paid <= 0) {
            badge.textContent = 'Не оплачен';
            badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600';
        } else if (paid < total) {
            badge.textContent = 'Частично оплачен';
            badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700';
        } else {
            badge.textContent = 'Оплачен';
            badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700';
        }
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
        html += `<div class="flex justify-between items-center text-xs border-b pb-1">
            <div>
                <div class="font-medium text-gray-800">${Number(p.amount).toFixed(2)} € · ${escapeHtml(p.method || '—')}</div>
                <div class="text-gray-400">${formatDateDMY(p.paid_at)}${emp ? ' · ' + escapeHtml(emp.name) : ''}${p.note ? ' · ' + escapeHtml(p.note) : ''}</div>
            </div>
            ${hasPermission('can_delete') ? `<button onclick="deletePayment(${p.id})" class="text-gray-300 hover:text-red-500 text-base leading-none" title="Удалить">✕</button>` : ''}
        </div>`;
    });
    html += '</div>';
    list.innerHTML = html;
}

function openAddPaymentModal() {
    document.getElementById('paymentAmount').value = '';
    document.getElementById('paymentDate').value = getLocalDateStr(0);
    document.getElementById('paymentMethod').value = 'наличные';
    document.getElementById('paymentNote').value = '';
    document.getElementById('addPaymentModal').style.display = 'flex';
}

async function savePayment() {
    const amount = parseFloat(document.getElementById('paymentAmount').value);
    const paidAt = document.getElementById('paymentDate').value;
    const method = document.getElementById('paymentMethod').value;
    const note = document.getElementById('paymentNote').value.trim();

    if (!amount || amount <= 0) { showInfo('Укажите сумму больше нуля.'); return; }
    if (!paidAt) { showInfo('Укажите дату.'); return; }
    if (!currentOrderId) return;

    showLoading('Сохранение...');
    try {
        const { error } = await db.from('order_payments').insert({
            org_id: currentOrgId,
            order_id: currentOrderId,
            amount, method, paid_at: paidAt,
            note: note || null,
            created_by: currentEmployee ? currentEmployee.id : null
        });
        if (error) throw error;
        closeModal();
        logActivity('order', `Внесена оплата ${amount.toFixed(2)} € (${method})`, currentOrderId);
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo('Ошибка сохранения платежа.');
    } finally { hideLoading(); }
}

async function deletePayment(id) {
    if (!(await showConfirm('Удалить эту запись об оплате?'))) return;
    showLoading('Удаление...');
    try {
        const { error } = await db.from('order_payments').delete().eq('id', id);
        if (error) throw error;
        logActivity('order', 'Удалена запись об оплате', currentOrderId);
        await loadOrderPayments(currentOrderId);
    } catch (e) {
        console.error(e);
        showInfo('Ошибка удаления.');
    } finally { hideLoading(); }
}
