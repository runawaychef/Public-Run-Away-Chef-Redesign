// ==================== СОТРУДНИКИ / ВХОД-ВЫХОД ====================
// Логика экрана выбора сотрудника и хранение текущего вошедшего сотрудника.
// Обычный скрипт (без модулей) — переменные и функции доступны глобально.
// Зависит от: db (supabaseClient.js), loadAllData() (определена в основном скрипте).

let employees = [];       // [{id, name}]
let currentEmployee = null; // {id, name}
let currentOrgId = null;    // id текущей организации (пекарни)
let currentOrgName = '';    // название текущей организации (пекарни)
let currentOrgPlan = 'free';        // текущий тариф: 'free' или платный
let currentOrgCustomersUsed = 0;    // сколько клиентов создано за всё время (для лимита бесплатного тарифа)
let currentOrgOrdersUsed = 0;       // сколько заказов создано за всё время (для лимита бесплатного тарифа)
let currentOrgCurrency = 'EUR';     // код валюты расчёта организации (пригодится для formatMoney())
let currentOrgVatRate = 0.21;       // ставка НДС организации (доля, не проценты — 0.21 = 21%)

function updateHeaderOrgName() {
    const el = document.getElementById('orgNameHeader');
    if (el && currentOrgName) el.textContent = currentOrgName;
}

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
        const { data: authData, error: authErr } = await db.auth.getUser();
        if (authErr) throw authErr;
        const uid = authData && authData.user ? authData.user.id : null;
        if (!uid) throw new Error('Нет активной сессии пользователя');

        const { data, error } = await db
            .from('memberships')
            .select('org_id, role, organizations(id, name, plan, customers_created_total, orders_created_total, currency_code, vat_rate)')
            .eq('user_id', uid)
            .single();
        if (error) throw error;
        currentOrgId = data.org_id;
        currentOrgName = (data.organizations && data.organizations.name) || '';
        currentOrgPlan = (data.organizations && data.organizations.plan) || 'free';
        currentOrgCustomersUsed = (data.organizations && data.organizations.customers_created_total) || 0;
        currentOrgOrdersUsed = (data.organizations && data.organizations.orders_created_total) || 0;
        currentOrgCurrency = (data.organizations && data.organizations.currency_code) || 'EUR';
        currentOrgVatRate = (data.organizations && data.organizations.vat_rate != null) ? Number(data.organizations.vat_rate) : 0.21;
        updateHeaderOrgName();
        return data;
    } catch (e) {
        console.error('Ошибка загрузки организации:', e);
        return null;
    }
}

// ==================== ЭКРАН ВЫБОРА СОТРУДНИКА ====================

const EMPLOYEE_SELECT_FIELDS = 'id, name, is_owner, user_id, can_view_costs, can_delete, can_manage_inventory, can_view_reports, can_manage_team';

async function initLogin() {
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('loginRetryBtn').classList.add('hidden');
    // Сначала загружаем организацию текущего пользователя
    const membership = await loadCurrentOrg();
    if (!membership) {
        document.getElementById('loginError').classList.remove('hidden'); document.getElementById('loginRetryBtn').classList.remove('hidden');
        return false;
    }

    // ID текущего Auth-пользователя — нужен, чтобы найти его личную запись сотрудника (если есть)
    const { data: authData } = await db.auth.getUser();
    const myUserId = authData && authData.user ? authData.user.id : null;

    try {
        const { data, error } = await db
            .from('employees')
            .select(EMPLOYEE_SELECT_FIELDS)
            .eq('org_id', currentOrgId)
            .order('name');
        if (error) throw error;
        employees = data || [];

        // Если у этого аккаунта уже есть личная привязанная запись — входим сразу под ней, без выбора
        let myOwn = myUserId ? employees.find(e => e.user_id === myUserId) : null;

        // Самолечение для существующих владельцев, которые вошли до появления личных аккаунтов:
        // если это владелец организации и есть "ничья" запись владельца — привязываем её к нему
        if (!myOwn && myUserId && membership.role === 'owner') {
            const ownerRow = employees.find(e => e.is_owner && !e.user_id);
            if (ownerRow) {
                const { data: linked } = await db.from('employees')
                    .update({ user_id: myUserId })
                    .eq('id', ownerRow.id)
                    .select(EMPLOYEE_SELECT_FIELDS)
                    .single();
                if (linked) myOwn = linked;
            }
        }

        if (myOwn) { await selectEmployee(myOwn); return true; }

        if (!employees.length) {
            // Пекарня новая (или ещё нет ни одной записи) — создаём настоящую запись владельца с полными правами
            const { data: owner, error: ownerErr } = await db
                .from('employees')
                .insert({ org_id: currentOrgId, name: 'Владелец', is_owner: true, user_id: myUserId })
                .select(EMPLOYEE_SELECT_FIELDS)
                .single();
            if (ownerErr || !owner) {
                console.error('Ошибка создания владельца:', ownerErr);
                await selectEmployee({ id: null, name: 'Владелец', is_owner: true });
            } else {
                openOrgNameSetupModal(owner);
            }
            return true;
        }

        renderEmployeePickerList();
        return false;
    } catch (e) {
        console.error(e);
        document.getElementById('loginError').classList.remove('hidden'); document.getElementById('loginRetryBtn').classList.remove('hidden');
        return false;
    }
}

// Строит список сотрудников на экране выбора (аватар + имя + роль). Вынесено
// отдельно от initLogin(), потому что logoutEmployee() ("Сменить сотрудника")
// тоже должен уметь заново показать этот список — раньше он просто открывал
// экран, не наполняя список заново, и если initLogin() не успел построить его
// в текущей сессии (например, при мгновенном восстановлении из кэша — см.
// cache.js, там employees тоже восстанавливается, так что данные для списка
// уже есть в памяти), экран оставался пустым. Работает с уже загруженным
// массивом employees, заново из базы не запрашивает.
function renderEmployeePickerList() {
    const list = document.getElementById('employeeList');
    if (!list) return;
    list.innerHTML = '';
    employees.forEach(emp => {
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.style.cssText = 'display:flex;align-items:center;gap:12px;background:#e3e8df;border-radius:14px;padding:10px 14px;text-align:left;width:100%;';
        const initial = (emp.name || '?').trim().charAt(0).toUpperCase();
        const roleLabel = emp.is_owner ? t('employees_role_owner') : t('employees_role_staff');
        btn.innerHTML = `
            <span style="width:34px;height:34px;border-radius:50%;background:#7c9473;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:0 0 auto;">${escapeHtml(initial)}</span>
            <span>
                <span style="display:block;font-size:13.5px;font-weight:600;color:#3c3a34;">${escapeHtml(emp.name || '')}</span>
                <span style="display:block;font-size:11px;color:#a6a196;">${roleLabel}</span>
            </span>`;
        btn.onclick = () => selectEmployee(emp);
        list.appendChild(btn);
    });
}


// Соответствие столбца в базе и CSS-класса, которым помечены элементы интерфейса
const PERM_CLASS_MAP = {
    can_view_costs: 'perm-view-costs',
    can_delete: 'perm-delete',
    can_manage_inventory: 'perm-inventory',
    can_view_reports: 'perm-reports'
};

// Универсальная проверка права для мест, где интерфейс формируется через JS-шаблоны
// (списки, где HTML пересоздаётся заново при каждом обновлении — статичная метка perm-* тут не сработает)
function hasPermission(field) {
    return !!(currentEmployee && (currentEmployee.is_owner || currentEmployee[field]));
}

// Показывает/скрывает элементы интерфейса согласно правам сотрудника.
// Владелец видит всё всегда, независимо от состояния чекбоксов.
function applyPermissions(emp) {
    const allowAll = !!(emp && emp.is_owner);
    document.querySelectorAll('.perm-owner-only').forEach(el => el.classList.toggle('hidden', !allowAll));
    Object.keys(PERM_CLASS_MAP).forEach(field => {
        const cls = PERM_CLASS_MAP[field];
        const allowed = allowAll || !!(emp && emp[field]);
        document.querySelectorAll('.' + cls).forEach(el => el.classList.toggle('hidden', !allowed));
    });
}

// Показывает/скрывает кнопки «Склад» и «Статистика» согласно правам сотрудника,
// и если сотрудник в момент потери права уже находится на закрытом для него экране —
// аккуратно возвращает его обратно (закрывает склад / переключает на заказы).
function applyScreenAccessPermissions() {
    const canInventory = hasPermission('can_manage_inventory');
    const canReports = hasPermission('can_view_reports');

    document.getElementById('inventoryBtn').classList.toggle('hidden', !canInventory);
    document.getElementById('statsBtn').classList.toggle('hidden', !canReports);

    if (!canInventory) {
        const invModal = document.getElementById('inventoryModal');
        if (invModal && invModal.style.display === 'flex') invModal.style.display = 'none';
    }
    if (!canReports && typeof currentTabId !== 'undefined' && currentTabId === 'stats') {
        showTab('orders');
    }
}

// Тихо сверяет права текущего сотрудника с базой и, если владелец их поменял,
// обновляет интерфейс на лету — без перезагрузки и без выхода/входа.
// Вызывается периодически, пока сотрудник работает в открытом приложении.
async function refreshCurrentEmployeePermissions() {
    if (!currentEmployee || !currentEmployee.id) return;
    try {
        const { data, error } = await db
            .from('employees')
            .select(EMPLOYEE_SELECT_FIELDS)
            .eq('id', currentEmployee.id)
            .single();
        if (error || !data) return; // офлайн или ошибка — не рискуем, оставляем как было
        const changed = JSON.stringify(data) !== JSON.stringify(currentEmployee);
        currentEmployee = data;
        localStorage.setItem('currentEmployee', JSON.stringify(data));
        if (changed) {
            applyPermissions(currentEmployee);
            applyScreenAccessPermissions();
            document.getElementById('employeesManageBtn')?.classList.toggle('hidden', !hasPermission('can_manage_team'));
            // Перерисовываем списки, где значок удаления решается в момент отрисовки
            // (hasPermission() в шаблоне), а не статичным CSS-классом.
            if (typeof displayOrders === 'function') displayOrders();
            if (typeof displayCustomers === 'function') displayCustomers();
            if (typeof displayProducts === 'function') displayProducts();
            if (typeof displayIngredients === 'function') displayIngredients();
            if (typeof displaySemiFinished === 'function') displaySemiFinished();
        }
    } catch (e) { /* тихо игнорируем — плохая сеть не должна мешать работе */ }
}

async function selectEmployee(emp) {
    currentEmployee = emp;
    localStorage.setItem('currentEmployee', JSON.stringify(emp));
    applyPermissions(emp);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContent').classList.remove('app-locked');
    document.getElementById('settingsBtn').classList.remove('hidden');
    // Безусловный remove('hidden') был багом: selectEmployee() вызывается повторно
    // не только при первом входе, но и когда Supabase тихо обновляет сессию и
    // заново эмитит SIGNED_IN (в частности — при возврате приложения из фона).
    // Переключатель должен появляться только если мы реально на вкладке "Заказы",
    // иначе он всплывает поверх любого другого открытого экрана.
    if (typeof currentTabId === 'undefined' || currentTabId === 'orders') {
        document.getElementById('ordersViewToggle')?.classList.remove('hidden');
    }
    if (typeof positionOrdersViewToggle === 'function') setTimeout(positionOrdersViewToggle, 150);
    applyScreenAccessPermissions();
    document.getElementById('employeesManageBtn').classList.toggle('hidden', !hasPermission('can_manage_team'));
    document.getElementById('companyInfoBtnBlock').classList.toggle('hidden', !emp.is_owner);
    await loadAllData();
    await loadInventory();
    initRealtime();
    refreshFab();
    setTimeout(refreshFab, 150);
    logActivity('auth', `Вход: ${emp.name}`);

    startPeriodicRefresh();
}

// Раз в минуту проверяет, не наступила ли новая дата (перезагружает всё, если да)
// и тихо сверяет права текущего сотрудника с базой. Вынесено в отдельную функцию
// и защищено флагом, чтобы интервал заводился РОВНО ОДИН РАЗ за время жизни
// страницы — иначе при мгновенном восстановлении из локального кэша (см. cache.js),
// которое НЕ проходит через selectEmployee(), эта проверка вообще не запускалась бы,
// а при обычном повторном вызове selectEmployee() (смена сотрудника без перезагрузки
// страницы) интервалы бы задваивались.
let _periodicRefreshStarted = false;
function startPeriodicRefresh() {
    if (_periodicRefreshStarted) return;
    _periodicRefreshStarted = true;
    let _lastKnownDate = new Date().toISOString().slice(0, 10);
    setInterval(() => {
        const currentDate = new Date().toISOString().slice(0, 10);
        if (currentDate !== _lastKnownDate) {
            _lastKnownDate = currentDate;
            loadAllData(true);
        } else {
            displayOrders();
        }
        refreshCurrentEmployeePermissions();
    }, 60000);
}

async function logoutEmployee() {
    if (!(await showConfirm(t('employees_switch_confirm')))) return;
    closeModal();
    logActivity('auth', `Выход: ${currentEmployee ? currentEmployee.name : ''}`);
    currentEmployee = null;
    localStorage.removeItem('currentEmployee');
    renderEmployeePickerList();
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appContent').classList.add('app-locked');
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    document.getElementById('inventoryBtn').classList.add('hidden');
    document.getElementById('ordersViewToggle')?.classList.add('hidden');
}

// ==================== НАЗВАНИЕ ПЕКАРНИ ====================

let _pendingOwnerForSetup = null;

function openOrgNameSetupModal(owner) {
    _pendingOwnerForSetup = owner;
    document.getElementById('orgNameSetupInput').value = '';
    const demoCheckbox = document.getElementById('orgNameSetupDemoCheckbox');
    if (demoCheckbox) demoCheckbox.checked = false;
    document.getElementById('orgNameSetupModal').style.display = 'flex';
}

async function saveOrgNameSetup() {
    const name = document.getElementById('orgNameSetupInput').value.trim();
    const wantsDemo = document.getElementById('orgNameSetupDemoCheckbox')?.checked;
    if (name) {
        try {
            const { error } = await db.from('organizations').update({ name }).eq('id', currentOrgId);
            if (error) throw error;
            currentOrgName = name;
            updateHeaderOrgName();
        } catch (e) {
            console.error(e);
            showInfo('Не удалось сохранить название, но можно будет изменить его позже в настройках.');
        }
    }
    const owner = _pendingOwnerForSetup;
    if (wantsDemo && owner) {
        showLoading('Заполняю пример...');
        try {
            await createDemoData(currentOrgId, owner.id);
        } catch (e) {
            console.error(e);
            showInfo('Не удалось заполнить пример — но можно продолжить и добавить данные вручную.');
        } finally {
            hideLoading();
        }
    }
    document.getElementById('orgNameSetupModal').style.display = 'none';
    _pendingOwnerForSetup = null;
    await selectEmployee(owner);
}

// Сохранение названия пекарни теперь происходит внутри карточки
// «Информация о компании» (company.js, функция saveCompanyInfo()).

// ==================== СОТРУДНИКИ И ПРАВА (только владелец) ====================

const PERMISSION_FIELDS = ['can_view_costs', 'can_delete', 'can_manage_inventory', 'can_view_reports', 'can_manage_team'];
const PERMISSION_CHECKBOX_IDS = {
    can_view_costs: 'permViewCosts',
    can_delete: 'permDelete',
    can_manage_inventory: 'permInventory',
    can_view_reports: 'permReports',
    can_manage_team: 'permManageTeam'
};

let pendingInvitations = [];

async function reloadEmployeesList() {
    const { data, error } = await db
        .from('employees')
        .select(EMPLOYEE_SELECT_FIELDS)
        .eq('org_id', currentOrgId)
        .order('name');
    if (!error) employees = data || [];

    const { data: invData, error: invErr } = await db
        .from('invitations')
        .select('id, email, name, can_view_costs, can_delete, can_manage_inventory, can_view_reports, can_manage_team')
        .eq('org_id', currentOrgId)
        .is('used_at', null)
        .order('created_at');
    if (!invErr) pendingInvitations = invData || [];
}

async function openEmployeesModal() {
    if (!hasPermission('can_manage_team')) { showInfo(t('employees_no_access')); return; }
    closeModal();
    await reloadEmployeesList();
    const content = document.getElementById('employeesListContent');
    content.innerHTML = '';

    employees.forEach(emp => {
        const row = document.createElement('button');
        row.className = 'settings-row-btn';
        row.style.justifyContent = 'space-between';
        const badge = emp.is_owner ? t('employees_role_owner') : (emp.user_id ? t('employees_role_personal_login') : t('employees_role_shared_device'));
        row.innerHTML = `<span>${escapeHtml(emp.name)}</span><span class="text-gray-400">${badge}</span>`;
        row.onclick = () => openEmployeeEditModal(emp);
        content.appendChild(row);
    });

    pendingInvitations.forEach(inv => {
        const row = document.createElement('div');
        row.className = 'px-2 py-1.5 rounded-xl text-xs text-left';
        row.style.cssText = 'background:#f4f1ea; border:1px dashed #d8d2c4;';
        row.innerHTML = `
            <div class="flex justify-between items-center">
                <span>${escapeHtml(inv.name)} <span class="text-gray-400">(${escapeHtml(inv.email)})</span></span>
                <span style="color:#96712a;" class="flex-shrink-0 ml-1 inline-flex items-center">${icon('clock')}${t('employees_invite_pending')}</span>
            </div>`;
        const actionsRow = document.createElement('div');
        actionsRow.className = 'flex gap-2 mt-1';

        const shareBtn = document.createElement('button');
        shareBtn.innerHTML = icon('share') + t('employees_invite_share');
        shareBtn.className = 'text-xs inline-flex items-center invite-share-btn';
        shareBtn.onclick = (e) => { e.stopPropagation(); shareInvitation(inv); };

        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = icon('close') + t('employees_invite_cancel');
        cancelBtn.className = 'text-gray-400 text-xs inline-flex items-center invite-cancel-btn';
        cancelBtn.onclick = (e) => { e.stopPropagation(); cancelInvitation(inv.id); };

        actionsRow.appendChild(shareBtn);
        actionsRow.appendChild(cancelBtn);
        row.appendChild(actionsRow);
        content.appendChild(row);
    });

    document.getElementById('employeesModal').style.display = 'flex';
}

function openEmployeeEditModal(emp) {
    closeModal();
    document.getElementById('employeeEditId').value = emp ? emp.id : '';
    document.getElementById('employeeEditUserId').value = emp && emp.user_id ? emp.user_id : '';
    document.getElementById('employeeEditName').value = emp ? emp.name : '';
    document.getElementById('employeeEditEmail').value = '';
    document.getElementById('employeeEditTitle').textContent = emp ? t('employees_edit_title') : t('employees_new_title');

    // Поле email для приглашения имеет смысл только при создании новой записи
    document.getElementById('employeeEditEmailBlock').classList.toggle('hidden', !!emp);

    PERMISSION_FIELDS.forEach(field => {
        document.getElementById(PERMISSION_CHECKBOX_IDS[field]).checked = emp ? !!emp[field] : false;
    });

    // Владельца нельзя ни удалить, ни ограничить в правах.
    const isOwnerRow = emp && emp.is_owner;
    // Сотрудник с правом "Команда и доступ" (но не владелец) может приглашать новых
    // сотрудников и настраивать им права ПРИ СОЗДАНИИ, а также удалять — но не может
    // задним числом менять права УЖЕ существующего сотрудника (это осознанное решение,
    // не техническое ограничение — см. обсуждение в чате).
    const viewerIsOwner = !!(currentEmployee && currentEmployee.is_owner);
    const editingExisting = !!emp;
    const permissionsLocked = isOwnerRow || (editingExisting && !viewerIsOwner);
    PERMISSION_FIELDS.forEach(field => { document.getElementById(PERMISSION_CHECKBOX_IDS[field]).disabled = permissionsLocked; });
    // Право "Команда и доступ" может выдавать/снимать только сам владелец — иначе
    // сотрудник с этим правом мог бы передать его дальше кому угодно, включая себя
    // повторно на другом устройстве.
    document.getElementById(PERMISSION_CHECKBOX_IDS.can_manage_team).disabled = permissionsLocked || !viewerIsOwner;
    document.getElementById('employeePermissionsLockedNote')?.classList.toggle('hidden', !permissionsLocked);
    document.getElementById('employeeDeleteBtn').classList.toggle('hidden', !emp || isOwnerRow);

    document.getElementById('employeeEditModal').style.display = 'flex';
}

async function saveEmployee() {
    const id = document.getElementById('employeeEditId').value;
    const name = document.getElementById('employeeEditName').value.trim();
    const email = document.getElementById('employeeEditEmail').value.trim();
    if (!name) { showInfo(t('employees_name_required')); return; }

    const permissions = {};
    PERMISSION_FIELDS.forEach(field => {
        permissions[field] = document.getElementById(PERMISSION_CHECKBOX_IDS[field]).checked;
    });

    showLoading(t('common_saving'));
    try {
        suppressRealtimeFor3s();
        if (id) {
            // Редактирование существующей записи (имя + права)
            const { error } = await db.from('employees').update({ name, ...permissions }).eq('id', id);
            if (error) throw error;
            logActivity('system', `Обновлены данные сотрудника: ${name}`);
        } else if (email) {
            // Создаём приглашение на личный вход — запись сотрудника появится сама при регистрации
            const { error } = await db.from('invitations').insert({ org_id: currentOrgId, email, name, ...permissions });
            if (error) throw error;
            logActivity('system', `Отправлено приглашение сотруднику: ${name} (${email})`);
            await reloadEmployeesList();
            openEmployeesModal();
            await showInfo(`${t('employees_invite_created_prefix')} ${email}`);
            return;
        } else {
            // Обычная запись для входа по имени на общем устройстве
            const { error } = await db.from('employees').insert({ org_id: currentOrgId, name, ...permissions });
            if (error) throw error;
            logActivity('system', `Создан сотрудник: ${name}`);
        }
        await reloadEmployeesList();
        openEmployeesModal();
    } catch (e) {
        console.error(e);
        showInfo(t('employees_save_error'));
    } finally { hideLoading(); }
}

async function deleteEmployee() {
    const id = document.getElementById('employeeEditId').value;
    const userId = document.getElementById('employeeEditUserId').value;
    if (!id) return;

    const warning = userId
        ? t('employees_delete_warning_with_login')
        : t('employees_delete_warning_simple');
    if (!(await showConfirm(warning))) return;

    showLoading(t('common_deleting'));
    try {
        suppressRealtimeFor3s();
        const { error } = await db.from('employees').delete().eq('id', id);
        if (error) throw error;

        // Если у сотрудника был личный вход — отзываем и само членство в организации,
        // иначе он формально остался бы полноправным участником пекарни
        if (userId) {
            const { error: memErr } = await db.from('memberships').delete().eq('user_id', userId).eq('org_id', currentOrgId);
            if (memErr) {
                console.error(memErr);
                showInfo(t('employees_delete_membership_error'));
            }
        }

        await reloadEmployeesList();
        openEmployeesModal();
    } catch (e) {
        console.error(e);
        showInfo(t('employees_delete_error'));
    } finally { hideLoading(); }
}

async function shareInvitation(inv) {
    const appUrl = window.location.origin + window.location.pathname;
    const orgLabel = currentOrgName || t('employees_our_bakery_fallback');
    const text = t('employees_invite_share_text')
        .replace('{name}', inv.name)
        .replace('{org}', orgLabel)
        .replace('{url}', appUrl)
        .replace('{email}', inv.email);
    await shareOrCopyText(text);
}

async function cancelInvitation(id) {
    if (!(await showConfirm(t('employees_cancel_invite_confirm')))) return;
    showLoading(t('common_cancelling'));
    try {
        const { error } = await db.from('invitations').delete().eq('id', id);
        if (error) throw error;
        await reloadEmployeesList();
        openEmployeesModal();
    } catch (e) {
        console.error(e);
        showInfo(t('employees_cancel_invite_error'));
    } finally { hideLoading(); }
}

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
