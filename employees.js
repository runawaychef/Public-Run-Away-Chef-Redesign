// ==================== СОТРУДНИКИ / ВХОД-ВЫХОД ====================
// Логика экрана выбора сотрудника и хранение текущего вошедшего сотрудника.
// Обычный скрипт (без модулей) — переменные и функции доступны глобально.
// Зависит от: db (supabaseClient.js), loadAllData() (определена в основном скрипте).

let employees = [];       // [{id, name}]
let currentEmployee = null; // {id, name}
let currentOrgId = null;    // id текущей организации (пекарни)

// ==================== ЖУРНАЛ ДЕЙСТВИЙ ====================

async function logActivity(actionType, description, orderId = null) {
    if (!currentOrgId) return;
    try {
        await db.from('activity_log').insert({
            org_id: currentOrgId,
            employee_id: currentEmployee ? currentEmployee.id : null,
            employee_name: currentEmployee ? currentEmployee.name : '—',
            action_type: actionType,
            description: description,
            order_id: orderId
        });
    } catch (e) {
        console.error('Activity log error:', e);
    }
}

// ==================== ЗАГРУЗКА ОРГАНИЗАЦИИ ====================

// Определяем к какой пекарне принадлежит текущий Auth-пользователь
async function loadCurrentOrg() {
    try {
        const { data, error } = await db
            .from('memberships')
            .select('org_id, role, organizations(id, name, plan)')
            .single();
        if (error) throw error;
        currentOrgId = data.org_id;
        return data;
    } catch (e) {
        console.error('Ошибка загрузки организации:', e);
        return null;
    }
}

// ==================== ЭКРАН ВЫБОРА СОТРУДНИКА ====================

async function initLogin() {
    // Сначала загружаем организацию текущего пользователя
    const membership = await loadCurrentOrg();
    if (!membership) {
        document.getElementById('loginError').classList.remove('hidden');
        return;
    }

    try {
        const { data, error } = await db
            .from('employees')
            .select('id, name')
            .eq('org_id', currentOrgId)
            .order('name');
        if (error) throw error;
        employees = data || [];
        const list = document.getElementById('employeeList');
        list.innerHTML = '';

        if (!employees.length) {
            // Пекарня новая — сотрудников ещё нет, входим без выбора
            await selectEmployee({ id: null, name: 'Владелец' });
            return;
        }

        employees.forEach(emp => {
            const btn = document.createElement('button');
            btn.className = 'btn bg-gray-500 text-white p-2 rounded-md hover:bg-gray-600 text-sm';
            btn.textContent = emp.name;
            btn.onclick = () => selectEmployee(emp);
            list.appendChild(btn);
        });
    } catch (e) {
        console.error(e);
        document.getElementById('loginError').classList.remove('hidden');
    }
}

async function selectEmployee(emp) {
    currentEmployee = emp;
    localStorage.setItem('currentEmployee', JSON.stringify(emp));
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('app-locked');
    document.getElementById('settingsBtn').classList.remove('hidden');
    document.getElementById('statsBtn').classList.remove('hidden');
    document.getElementById('inventoryBtn').classList.remove('hidden');
    await loadAllData();
    await loadInventory();
    initRealtime();
    refreshFab();
    setTimeout(refreshFab, 150);
    logActivity('auth', `Вход: ${emp.name}`);

    // Обновляем данные каждую минуту.
    // Если дата изменилась (перевалило за полночь) — перезагружаем всё.
    let _lastKnownDate = new Date().toISOString().slice(0, 10);
    setInterval(() => {
        const currentDate = new Date().toISOString().slice(0, 10);
        if (currentDate !== _lastKnownDate) {
            _lastKnownDate = currentDate;
            loadAllData();
        } else {
            displayOrders();
        }
    }, 60000);
}

async function logoutEmployee() {
    if (!(await showConfirm('Сменить сотрудника?'))) return;
    closeModal();
    logActivity('auth', `Выход: ${currentEmployee ? currentEmployee.name : ''}`);
    currentEmployee = null;
    localStorage.removeItem('currentEmployee');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appContent').classList.add('app-locked');
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    document.getElementById('inventoryBtn').classList.add('hidden');
}

// ==================== ФИКСАЦИЯ СЕБЕСТОИМОСТИ ====================

async function fixateAllItemCosts() {
    const ok = await showConfirm(
        'Зафиксировать себестоимость всех существующих заказов по текущим ценам ингредиентов?\n\nПосле этого изменение цен не будет пересчитывать старые заказы.\n\nЭто действие необратимо.'
    );
    if (!ok) return;
    closeModal();

    const toFix = [];
    orders.forEach(o => {
        (o.items || []).forEach(it => {
            if (it.item_cost == null) {
                const prod = products.find(p => p.id === it.product_id);
                if (prod) {
                    const cost = parseFloat((productUnitCost(prod) * it.quantity).toFixed(4));
                    toFix.push({ id: it.id, item_cost: cost, item: it });
                }
            }
        });
    });

    if (!toFix.length) {
        await showInfo('Все позиции уже зафиксированы — ничего делать не нужно.');
        return;
    }

    showLoading('Фиксирую себестоимость... Это может занять несколько секунд.');
    let fixed = 0;
    try {
        for (let i = 0; i < toFix.length; i += 50) {
            const batch = toFix.slice(i, i + 50);
            for (const rec of batch) {
                const { error } = await db.from('order_items').update({ item_cost: rec.item_cost }).eq('id', rec.id);
                if (!error) { rec.item.item_cost = rec.item_cost; fixed++; }
            }
        }
        logActivity('system', `Зафиксирована себестоимость ${fixed} позиций заказов`);
        await showInfo(`Готово: зафиксировано ${fixed} позиций из ${toFix.length}.`);
    } catch (e) {
        console.error(e);
        await showInfo(`Ошибка: зафиксировано ${fixed} из ${toFix.length}. Попробуйте ещё раз.`);
    } finally { hideLoading(); }
}
