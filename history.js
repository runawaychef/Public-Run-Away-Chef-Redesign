// ==================== ИСТОРИЯ (ЖУРНАЛ ДЕЙСТВИЙ) ====================
// Загрузка и отображение журнала действий, фильтры, переход к заказу из записи.
// Обычный скрипт (без модулей) — функции и переменные доступны глобально, как раньше.
// Зависит от: db (supabaseClient.js), employees (employees.js), orders (главный скрипт),
// showTab, openOrderDetail (orders.js).

const HISTORY_PAGE_SIZE = 30;
let historyOffset = 0;
let historyHasMore = true;

function updateHistoryEmployeeFilter() {
    const sel = document.getElementById('historyEmployeeFilter');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Все сотрудники</option>';
    employees.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        if (String(e.id) === prev) opt.selected = true;
        sel.appendChild(opt);
    });
}

const ACTION_TYPE_LABELS = {
    order: 'Заказ', item: 'Позиция', customer: 'Клиент', product: 'Изделие', auth: 'Вход/выход'
};

function formatHistoryRow(entry) {
    const dt = new Date(entry.created_at);
    const dateStr = dt.toLocaleDateString('ru-RU');
    const timeStr = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    // Кликабельно только если есть order_id и такой заказ всё ещё существует
    const orderExists = entry.order_id && orders.some(o => o.id === entry.order_id);
    const rowClass = orderExists ? 'border-b order-row' : 'border-b';
    const clickAttr = orderExists ? ` onclick="openOrderFromHistory(${entry.order_id})"` : '';

    return `<tr class="${rowClass}"${clickAttr}>
        <td class="p-0.5 text-xs whitespace-nowrap">${dateStr}</td>
        <td class="p-0.5 text-xs whitespace-nowrap">${timeStr}</td>
        <td class="p-0.5 text-xs">${entry.employee_name || '—'}</td>
        <td class="p-0.5 text-xs">${entry.description || ''}${orderExists ? ' <span class="text-indigo-500">→</span>' : ''}</td>
    </tr>`;
}

// Открыть заказ прямо из записи журнала
function openOrderFromHistory(orderId) {
    showTab('orders');
    openOrderDetail(orderId);
}

async function loadHistory() {
    historyOffset = 0;
    historyHasMore = true;
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-xs text-gray-400 py-2">Загрузка…</td></tr>`;
    await fetchHistoryPage(true);
}

async function loadMoreHistory() {
    await fetchHistoryPage(false);
}

async function fetchHistoryPage(replace) {
    const employeeFilter = document.getElementById('historyEmployeeFilter').value;
    const actionFilter   = document.getElementById('historyActionFilter').value;

    try {
        let query = db.from('activity_log')
            .select('id, created_at, employee_name, action_type, description, order_id')
            .order('created_at', { ascending: false })
            .range(historyOffset, historyOffset + HISTORY_PAGE_SIZE - 1);

        if (employeeFilter) query = query.eq('employee_id', employeeFilter);
        if (actionFilter)   query = query.eq('action_type', actionFilter);

        const { data, error } = await query;
        if (error) throw error;

        const tbody = document.getElementById('historyTableBody');
        if (replace) tbody.innerHTML = '';

        if (!data || data.length === 0) {
            if (replace) tbody.innerHTML = `<tr><td colspan="4" class="text-center text-xs text-gray-400 py-2">Нет записей</td></tr>`;
            historyHasMore = false;
        } else {
            tbody.insertAdjacentHTML('beforeend', data.map(formatHistoryRow).join(''));
            historyOffset += data.length;
            historyHasMore = data.length === HISTORY_PAGE_SIZE;
        }

        document.getElementById('historyLoadMoreBtn').classList.toggle('hidden', !historyHasMore);
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('historyTableBody');
        if (replace) tbody.innerHTML = `<tr><td colspan="4" class="text-center text-xs text-red-500 py-2">Ошибка загрузки журнала</td></tr>`;
    }
}
