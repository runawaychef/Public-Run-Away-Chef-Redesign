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
let currentOrgVatRate = 0;          // ставка НДС организации (доля, не проценты — 0.21 = 21%); по умолчанию без НДС
let currentOrgVatPayer = false;     // organizations.vat_payer — пекарня плательщик НДС (29.10.2026)
let currentOrgVatPayerFrom = null;  // organizations.vat_payer_from — «плательщик с даты» (YYYY-MM-DD), null = с начала
let currentOrgCountry = null;       // код страны организации (organizations.country: 'LT', 'BY', ...) — от неё зависят подписи реквизитов
let currentOrgTimezone = null;
let currentOrgPaymentMode = 'order'; // 'order' — оплата прямо в заказ; 'invoice' — только по счёту (organizations.payment_mode, 21.10)
let currentOrgInvoicingFrom = null;  // organizations.invoicing_from — «вести учёт с даты» (YYYY-MM-DD): заказы раньше не требуют счёта; null = все (30.10.2026)
let currentOrgCashNoInv = false;     // частные клиенты: наличные без счёта (только защищённая орг. id1)
let currentOrgProtected = false;     // organizations.is_protected
let currentOrgMemoRemindDays = 7;   // за сколько дней напоминать о памятных датах (organizations.memo_remind_days, общее для пекарни)       // IANA-пояс организации (напр. 'Europe/Vilnius'); null = по устройству
let currentOrgBccSelf = false;      // глобальный тумблер "присылать копию себе" при email-отправке документов — дефолт для чекбокса в шите отправки

// Глобальный рубильник монетизации (таблица platform_settings, key='monetization_live').
// Пока 'false' — ВСЕ организации видят полный функционал независимо от currentOrgPlan,
// это сознательный режим на время тестирования (согласовано явно: тестировщики,
// текущие и будущие, не должны упираться в тарифные ограничения). Значение по
// умолчанию здесь — true (осторожный выбор): если строка в platform_settings ещё
// не создана или не загрузилась, гейтинг лучше оставить активным, чем случайно
// открыть premium всем при сбое сети.
let monetizationLive = true;

// Есть ли у ТЕКУЩЕЙ организации явно выставленный вручную plan_override
// (из Simple Hub). Override — это осознанное решение администратора именно
// для этой организации, поэтому он действует ВСЕГДА, даже когда глобальный
// рубильник monetizationLive выключен. Так можно держать общий рубильник
// выключенным (все тестировщики видят полную версию), но экспериментировать
// с ограничениями конкретных тарифов на одной выбранной организации.
let currentOrgPlanIsOverridden = false;

// ── Пробный период: первые 7 дней с момента регистрации организации —
// полный доступ ко всем функциям, без привязки карты (осознанное решение,
// обсуждалось отдельно — упрощает вход новым пользователям сильнее, чем
// экономит на редких недобросовестных). НЕ действует, если для организации
// стоит явный ручной plan_override — override это осознанное решение
// администратора, оно должно "побеждать" даже во время триала.
//
// Вычисляется мгновенно из даты регистрации (currentOrgCreatedAt), без
// сетевого запроса — в отличие от monetizationLive/plan это не требует
// похода в базу при каждой проверке, поэтому не подвержено гонке состояния
// при быстром восстановлении из кэша (см. фикс той самой гонки выше по коду).
const TRIAL_DAYS = 7;
let currentOrgCreatedAt = null; // ISO-строка даты регистрации организации

function isOrgInTrial() {
    if (!currentOrgCreatedAt) return false;
    const msSinceCreated = Date.now() - new Date(currentOrgCreatedAt).getTime();
    return msSinceCreated < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}
let _wasInTrialLastCheck = null; // используется в refreshCurrentEmployeePermissions() ниже, чтобы поймать момент окончания триала во время открытой сессии

async function loadMonetizationLiveFlag() {
    try {
        const { data, error } = await db.from('platform_settings').select('value').eq('key', 'monetization_live').maybeSingle();
        if (error || !data) return; // не нашли строку/сеть недоступна — оставляем текущее значение как есть
        monetizationLive = data.value === 'true';
    } catch (e) { /* тихо игнорируем — тот же принцип "не рискуем", что и везде рядом */ }
}

// Есть ли у организации ненулевой НДС — используется, чтобы скрывать/менять
// любые упоминания "с НДС"/"VAT" в интерфейсе, когда ставка равна нулю
// (организация вообще не работает с НДС).
function hasVat() {
    // id1 (защищённая) — по ставке, как раньше; остальные — только если пекарня плательщик НДС (30.10.2026)
    if (!currentOrgProtected && !currentOrgVatPayer) return false;
    return Number(currentOrgVatRate) > 0;
}

// ==================== ТАРИФНЫЙ ДОСТУП (feature gating) ====================
// Зеркалит систему прав сотрудников ниже (PERM_CLASS_MAP / applyPermissions /
// hasPermission) — тот же проверенный паттерн, только источник ограничения не
// роль сотрудника, а тариф организации (currentOrgPlan). Обе системы полностью
// независимы и КОМБИНИРУЮТСЯ: например, элемент себестоимости скрыт, если он
// недоступен по тарифу, ИЛИ недоступен по правам конкретного сотрудника —
// достаточно любого из двух ограничений.
//
// 'free' и 'light' получают одинаковый набор ограничений (согласовано ранее),
// 'full' — все premium-фичи. Если вдруг придёт неизвестное/пустое значение
// плана (сбой сети при обновлении и т.п.) — намеренно ведём себя как 'free',
// т.е. НИКОГДА не открываем premium по ошибке ("не рискуем" — тот же принцип,
// что и в refreshCurrentEmployeePermissions() ниже).
const PLAN_FEATURES = {
    free: [],
    light: [],
    full: ['stats', 'cost_analytics', 'activity_log', 'team', 'push'],
};

// Универсальная проверка фичи для мест, где интерфейс формируется через JS-шаблоны
// (списки/карточки, где HTML пересоздаётся заново при отрисовке — статичная
// CSS-метка plan-*-only тут не сработает, нужна проверка прямо в шаблоне).
function hasPlanFeature(feature) {
    // Рубильник выключен И для этой организации нет явного override — гейтинг
    // временно не действует (все видят полный функционал). Если override есть —
    // он "побеждает" рубильник и проверяется по-настоящему, независимо от него.
    if (!monetizationLive && !currentOrgPlanIsOverridden) return true;
    // Пробный период — та же логика: override "побеждает" даже триал.
    if (!currentOrgPlanIsOverridden && isOrgInTrial()) return true;
    const features = PLAN_FEATURES[currentOrgPlan] || PLAN_FEATURES.free;
    return features.includes(feature);
}

// CSS-класс → имя фичи, аналог PERM_CLASS_MAP.
const PLAN_CLASS_MAP = {
    stats: 'plan-stats-only',
    cost_analytics: 'plan-cost-only',
};

// Показывает/скрывает элементы интерфейса согласно тарифу организации.
// Вызывается везде, где вызывается applyPermissions() — сразу после входа,
// при восстановлении сессии из кэша, и при периодическом обновлении.
function applyPlanGating() {
    Object.keys(PLAN_CLASS_MAP).forEach(feature => {
        const cls = PLAN_CLASS_MAP[feature];
        const allowed = hasPlanFeature(feature);
        document.querySelectorAll('.' + cls).forEach(el => el.classList.toggle('hidden', !allowed));
    });
    applyCostVisibility();
    applyActivityLogVisibility();
    applyTeamVisibility();
    if (typeof refreshPushSettingsUI === 'function') refreshPushSettingsUI();
    // Вкладка "Статистика" зависит СРАЗУ от двух условий (права сотрудника И
    // тариф) — пересчитываем её через ту же функцию, что и права доступа.
    if (typeof applyScreenAccessPermissions === 'function') applyScreenAccessPermissions();
}

function updateHeaderOrgName() {
    const el = document.getElementById('orgNameHeader');
    if (el && currentOrgName) el.textContent = currentOrgName;
}

// ==================== ЖУРНАЛ ДЕЙСТВИЙ ====================

async function logActivity(actionType, description, orderId = null) {
    if (!currentOrgId) return;
    try {
        await dbMust(db.from('activity_log').insert({
            org_id: currentOrgId,
            employee_id: currentEmployee ? currentEmployee.id : null,
            employee_name: currentEmployee ? currentEmployee.name : '—',
            action_type: actionType,
            description: description,
            order_id: orderId
        }));
    } catch (e) {
        console.error('Activity log error:', e);
    }
}

// ==================== ПРИБЛИЗИТЕЛЬНАЯ ГЕОЛОКАЦИЯ (Simple Hub) ====================

// Обновляет organizations.detected_country по IP не чаще раза в 30 дней.
// Вызывается fire-and-forget из loadCurrentOrg() — не блокирует загрузку
// приложения и не показывает ошибок пользователю: это справочное поле
// для Simple Hub, отказ ipapi.co (сеть, рейт-лимит) просто откладывает
// обновление до следующего запуска.
const DETECTED_COUNTRY_REFRESH_DAYS = 30;

async function maybeRefreshDetectedCountry(lastUpdatedAt) {
    try {
        if (lastUpdatedAt) {
            const daysSince = (Date.now() - new Date(lastUpdatedAt).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < DETECTED_COUNTRY_REFRESH_DAYS) return;
        }
        const resp = await fetch('https://ipapi.co/json/');
        if (!resp.ok) return;
        const geo = await resp.json();
        const countryCode = geo && geo.country_code ? String(geo.country_code).toUpperCase() : null;
        if (!countryCode) return;
        await db.from('organizations').update({
            detected_country: countryCode,
            detected_country_updated_at: new Date().toISOString()
        }).eq('id', currentOrgId);
    } catch (e) {
        // Тихо игнорируем — не критичная для работы приложения функция.
        console.warn('Не удалось определить страну по IP:', e);
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
            .select('org_id, role, organizations(id, name, plan, plan_override, created_at, customers_created_total, orders_created_total, currency_code, country, vat_rate, vat_payer, vat_payer_from, detected_country, detected_country_updated_at, bcc_self_on_send, timezone, memo_remind_days, payment_mode, cash_without_invoice, invoicing_from, is_protected)')
            .eq('user_id', uid)
            .single();
        if (error) throw error;
        currentOrgId = data.org_id;
        currentOrgName = (data.organizations && data.organizations.name) || '';
        // plan_override (выставляется вручную из Simple Hub, см. admin_set_org_plan) —
        // "побеждает" реальный тариф по оплате. Нужен для тестовых организаций,
        // которые должны видеть полный функционал независимо от billing-статуса,
        // либо, наоборот, чтобы вручную экспериментировать с ограничениями тарифа.
        currentOrgPlanIsOverridden = !!(data.organizations && data.organizations.plan_override);
        currentOrgPlan = (data.organizations && (data.organizations.plan_override || data.organizations.plan)) || 'free';
        currentOrgCreatedAt = (data.organizations && data.organizations.created_at) || null;
        _wasInTrialLastCheck = isOrgInTrial();
        currentOrgCustomersUsed = (data.organizations && data.organizations.customers_created_total) || 0;
        currentOrgOrdersUsed = (data.organizations && data.organizations.orders_created_total) || 0;
        currentOrgCurrency = (data.organizations && data.organizations.currency_code) || 'EUR';
        currentOrgCountry = (data.organizations && data.organizations.country) || null;
        currentOrgVatPayer = !!(data.organizations && data.organizations.vat_payer);
        currentOrgVatPayerFrom = (data.organizations && data.organizations.vat_payer_from) || null;
        currentOrgVatRate = (data.organizations && data.organizations.vat_rate != null) ? Number(data.organizations.vat_rate) : 0;
        currentOrgBccSelf = !!(data.organizations && data.organizations.bcc_self_on_send);
        currentOrgTimezone = (data.organizations && data.organizations.timezone) || null;
        currentOrgMemoRemindDays = (data.organizations && Number(data.organizations.memo_remind_days)) || 7;
        currentOrgPaymentMode = (data.organizations && data.organizations.payment_mode) || 'order';
        currentOrgCashNoInv = !!(data.organizations && data.organizations.cash_without_invoice);
        currentOrgInvoicingFrom = (data.organizations && data.organizations.invoicing_from) || null;
        currentOrgProtected = !!(data.organizations && data.organizations.is_protected);
        const detectedCountryUpdatedAt = (data.organizations && data.organizations.detected_country_updated_at) || null;
        await loadMonetizationLiveFlag();
        // Критично для пути быстрого восстановления из кэша (cache.js): там
        // applyPlanGating() уже успевает отработать один раз со СТАРЫМ значением
        // флага (снимок кэша не хранит monetizationLive) до того, как эта функция
        // отработает в фоне. Перевызываем здесь ещё раз с уже свежим значением —
        // иначе интерфейс молча остаётся в устаревшем (более строгом) состоянии.
        if (typeof applyPlanGating === 'function') applyPlanGating();
        if (typeof refreshVatLabels === 'function') refreshVatLabels();
        updateHeaderOrgName();
        // Fire-and-forget: не блокируем UI и не показываем ошибок пользователю —
        // это справочное поле для Simple Hub, а не критичная для работы функция.
        maybeRefreshDetectedCountry(detectedCountryUpdatedAt);
        // Тариф стал известен — теперь можно узнать квоту заказов (на старте loadAllData
        // может отработать раньше, и тогда напоминание о лимите не показалось бы).
        if (typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota();
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
                // Имя по умолчанию — на языке интерфейса в момент создания (раньше всегда
                // «Владелец» по-русски, даже у англоязычных пекарен), 23.10
                .insert({ org_id: currentOrgId, name: t('employees_role_owner'), is_owner: true, user_id: myUserId })
                .select(EMPLOYEE_SELECT_FIELDS)
                .single();
            if (ownerErr || !owner) {
                console.error('Ошибка создания владельца:', ownerErr);
                await selectEmployee({ id: null, name: t('employees_role_owner'), is_owner: true });
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
        btn.className = 'nv-emp';
        const initial = (emp.name || '?').trim().charAt(0).toUpperCase();
        const roleLabel = emp.is_owner ? t('employees_role_owner') : t('employees_role_staff');
        btn.innerHTML = `
            <span class="nv-ava">${escapeHtml(initial)}</span>
            <span class="nv-en"><b>${escapeHtml(emp.name || '')}</b><span class="nv-role${emp.is_owner ? ' own' : ''}">${roleLabel}</span></span>
            <svg class="nv-chv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
        btn.onclick = () => selectEmployee(emp);
        list.appendChild(btn);
    });
}


// Соответствие столбца в базе и CSS-класса, которым помечены элементы интерфейса
const PERM_CLASS_MAP = {
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
// "Журнал действий" в Настройках виден только владельцу И только если тариф
// это позволяет — оба условия проверяются здесь вместе, аналогично
// applyCostVisibility(), чтобы два независимых переключателя не перетирали
// результат друг друга. Вызывается и из applyPermissions(), и из applyPlanGating().
function applyActivityLogVisibility() {
    const allowed = !!(currentEmployee && currentEmployee.is_owner) && hasPlanFeature('activity_log');
    document.getElementById('activityLogBtn')?.classList.toggle('hidden', !allowed);
}

// "Команда и доступ" в Настройках (управление сотрудниками) — Full-only фича.
// Видна, если у сотрудника есть право can_manage_team И тариф это позволяет.
// Комбинированная функция по тому же принципу, что и applyCostVisibility()/
// applyActivityLogVisibility() — вызывается и из applyPermissions(), и из
// applyPlanGating(), чтобы два условия не перетирали результат друг друга.
function applyTeamVisibility() {
    const allowed = hasPermission('can_manage_team') && hasPlanFeature('team');
    document.getElementById('employeesManageBtn')?.classList.toggle('hidden', !allowed);
}

function applyPermissions(emp) {
    const allowAll = !!(emp && emp.is_owner);
    document.querySelectorAll('.perm-owner-only').forEach(el => el.classList.toggle('hidden', !allowAll));
    Object.keys(PERM_CLASS_MAP).forEach(field => {
        const cls = PERM_CLASS_MAP[field];
        const allowed = allowAll || !!(emp && emp[field]);
        document.querySelectorAll('.' + cls).forEach(el => el.classList.toggle('hidden', !allowed));
    });
    applyCostVisibility();
    applyActivityLogVisibility();
    applyTeamVisibility();
}

// Блоки себестоимости/прибыли (класс .perm-view-costs) скрыты, если недоступны
// ЛИБО по правам сотрудника, ЛИБО по тарифу — оба условия проверяются здесь
// вместе, в одном месте, а не двумя независимыми переключателями одного и того
// же класса (иначе они бы "перетирали" результат друг друга при вызове).
// Вызывается и из applyPermissions(), и из applyPlanGating() — какая бы из
// систем ни сработала, итоговое состояние всегда пересчитывается заново из
// обоих условий сразу.
function applyCostVisibility() {
    const allowed = hasPermission('can_view_costs') && hasPlanFeature('cost_analytics');
    document.querySelectorAll('.perm-view-costs').forEach(el => el.classList.toggle('hidden', !allowed));
}

// Показывает/скрывает кнопки «Склад» и «Статистика» согласно правам сотрудника,
// и если сотрудник в момент потери права уже находится на закрытом для него экране —
// аккуратно возвращает его обратно (закрывает склад / переключает на заказы).
function applyScreenAccessPermissions() {
    const canInventory = hasPermission('can_manage_inventory') && hasPlanFeature('cost_analytics');
    const canReports = hasPermission('can_view_reports') && hasPlanFeature('stats');

    document.getElementById('inventoryBtn')?.classList.toggle('hidden', !canInventory);
    document.getElementById('statsBtn').classList.toggle('hidden', !canReports);

    if (!canInventory) {
        if (typeof isAppPageOpen === 'function' && isAppPageOpen('inventoryPage') && typeof closeAllAppPages === 'function') closeAllAppPages();
    }
    if (!canReports && typeof currentTabId !== 'undefined' && currentTabId === 'stats') {
        showTab('orders');
    }
}

// Тихо сверяет права текущего сотрудника И тариф организации с базой, и если
// что-то изменилось — обновляет интерфейс на лету, без перезагрузки и без
// выхода/входа. Вызывается периодически, пока сотрудник работает в открытом
// приложении.
//
// Тариф важно проверять здесь же (не только при входе): организация может
// смениться в фоне через rtdn-handler (Google прислал уведомление об оплате,
// отмене, окончании грейс-периода и т.п.), пока человек уже работает в
// открытом приложении — без этой проверки он продолжал бы видеть premium-
// функции до следующего входа.
async function refreshCurrentEmployeePermissions() {
    if (!currentEmployee || !currentEmployee.id) return;
    try {
        const [empResult, orgResult, settingsResult] = await Promise.all([
            db.from('employees').select(EMPLOYEE_SELECT_FIELDS).eq('id', currentEmployee.id).single(),
            currentOrgId ? db.from('organizations').select('plan, plan_override, timezone, memo_remind_days, payment_mode, cash_without_invoice, invoicing_from, is_protected').eq('id', currentOrgId).single() : Promise.resolve({ data: null, error: null }),
            db.from('platform_settings').select('value').eq('key', 'monetization_live').maybeSingle(),
        ]);

        const { data, error } = empResult;
        if (error || !data) return; // офлайн или ошибка — не рискуем, оставляем как было
        const changed = JSON.stringify(data) !== JSON.stringify(currentEmployee);
        currentEmployee = data;
        localStorage.setItem('currentEmployee', JSON.stringify(data));

        // Тариф проверяем отдельно от прав сотрудника — у них разные источники
        // изменений, не хотим упустить обновление плана, если по случайности
        // сравнение currentEmployee в этот раз не изменилось.
        let planChanged = false;
        if (!orgResult.error && orgResult.data) {
            currentOrgTimezone = orgResult.data.timezone || null;
            currentOrgMemoRemindDays = Number(orgResult.data.memo_remind_days) || 7;
            currentOrgPaymentMode = orgResult.data.payment_mode || 'order';
            currentOrgCashNoInv = !!orgResult.data.cash_without_invoice;
            currentOrgInvoicingFrom = orgResult.data.invoicing_from || null;
            currentOrgProtected = !!orgResult.data.is_protected;
            const newPlan = orgResult.data.plan_override || orgResult.data.plan || 'free';
            const newIsOverridden = !!orgResult.data.plan_override;
            if (newPlan !== currentOrgPlan || newIsOverridden !== currentOrgPlanIsOverridden) {
                currentOrgPlan = newPlan;
                currentOrgPlanIsOverridden = newIsOverridden;
                planChanged = true;
            }
        }

        // Глобальный рубильник монетизации — если владелец платформы его включил
        // (запустил монетизацию по-настоящему), это должно применяться сразу у
        // всех, кто в этот момент уже работает в открытом приложении.
        if (!settingsResult.error && settingsResult.data) {
            const newFlag = settingsResult.data.value === 'true';
            if (newFlag !== monetizationLive) {
                monetizationLive = newFlag;
                planChanged = true; // переиспользуем тот же флажок для пересчёта UI ниже
            }
        }

        // Отдельно ловим момент, когда пробный период истекает ПРЯМО во время
        // открытой сессии (сотрудник не выходил из приложения все 7+ дней).
        // isOrgInTrial() сам по себе не требует сети — просто нужно заметить
        // переход true→false и пересчитать интерфейс, иначе он "застынет" в
        // полном доступе до следующего реального изменения плана.
        const nowInTrial = isOrgInTrial();
        if (_wasInTrialLastCheck === true && nowInTrial === false) planChanged = true;
        _wasInTrialLastCheck = nowInTrial;

        if (changed) {
            applyPermissions(currentEmployee);
            applyTeamVisibility();
        }
        if (changed || planChanged) {
            applyPlanGating(); // сам заодно пересчитывает вкладку "Статистика" через applyScreenAccessPermissions()
            // Перерисовываем списки, где видимость решается в момент отрисовки
            // (hasPermission()/hasPlanFeature() в шаблоне), а не статичным CSS-классом.
            if (typeof displayOrders === 'function') displayOrders();
            if (typeof displayCustomers === 'function') displayCustomers();
            if (typeof displayProducts === 'function') displayProducts();
            if (typeof displayIngredients === 'function') displayIngredients();
            if (typeof displaySemiFinished === 'function') displaySemiFinished();
        }
        if (planChanged && typeof scheduleRefreshOrderQuota === 'function') scheduleRefreshOrderQuota(); // смена тарифа → пересчитать квоту/плашку
        if (planChanged && typeof saveAppSnapshot === 'function') saveAppSnapshot(); // чтобы новый тариф пережил перезапуск из кэша
    } catch (e) { /* тихо игнорируем — плохая сеть не должна мешать работе */ }
}

async function selectEmployee(emp) {
    _switchPrevEmployee = null;
    _switchFromSettings = false;
    document.getElementById('loginCancelBtn')?.classList.add('hidden');
    currentEmployee = emp;
    localStorage.setItem('currentEmployee', JSON.stringify(emp));
    applyPermissions(emp);
    applyPlanGating();
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
    applyTeamVisibility();
    document.getElementById('companyInfoBtnBlock').classList.toggle('hidden', !emp.is_owner);
    // loadInventory() не зависит от данных loadAllData() — независимый запрос,
    // раньше шли строго друг за другом без необходимости. Пускаем параллельно.
    // Единственный нюанс: displayIngredients()/displaySemiFinished() (внутри
    // renderAllScreens(), которая идёт частью loadAllData()) читают
    // _inventoryCache/_inventoryMovements — если сработают раньше, чем
    // loadInventory() успеет их заполнить, разово покажут остаток 0/пусто.
    // Перерисовываем эти два экрана ещё раз после Promise.all — дёшево (уже
    // без O(n²), см. фикс indexOf), гарантирует верные остатки независимо
    // от того, какой из двух запросов реально закончился первым.
    await Promise.all([loadAllData(), loadInventory()]);
    if (typeof cleanupAbandonedDrafts === 'function') await cleanupAbandonedDrafts();
    if (typeof cleanupAbandonedCustomerDrafts === 'function') await cleanupAbandonedCustomerDrafts();
    if (typeof cleanupAbandonedSemiFinishedDrafts === 'function') await cleanupAbandonedSemiFinishedDrafts();
    if (typeof displayIngredients === 'function') displayIngredients();
    if (typeof displaySemiFinished === 'function') displaySemiFinished();
    initRealtime();
    refreshFab();
    setTimeout(refreshFab, 150);
    logActivity('auth', `${t('log_signin')}: ${emp.name}`);

    startPeriodicRefresh();
}

// Фоновые проверки. Вынесено в отдельную функцию и защищено флагом, чтобы
// интервал заводился РОВНО ОДИН РАЗ за время жизни страницы — иначе при мгновенном
// восстановлении из локального кэша (cache.js), которое НЕ проходит через
// selectEmployee(), проверка вообще не запускалась бы, а при повторном вызове
// selectEmployee() (смена сотрудника без перезагрузки) интервалы задваивались бы.
//
// Раз в минуту (локально, без запросов к базе): не сменилась ли дата ПЕКАРНИ —
// если да, перезагружаем данные (просроченные счета, «сегодня», списание склада).
// Права сотрудника и тариф сверяем с базой реже: раз в 5 минут и при возврате
// в приложение после паузы. На скрытой вкладке ничего не делаем.
const PERMISSIONS_REFRESH_MS = 5 * 60 * 1000;
let _periodicRefreshStarted = false;
function startPeriodicRefresh() {
    if (_periodicRefreshStarted) return;
    _periodicRefreshStarted = true;
    let _lastKnownDate = getLocalDateStr(0);
    let _lastPermissionsCheck = Date.now();

    const checkPermissions = () => {
        _lastPermissionsCheck = Date.now();
        refreshCurrentEmployeePermissions();
    };
    const checkDate = () => {
        const currentDate = getLocalDateStr(0);
        if (currentDate !== _lastKnownDate) {
            _lastKnownDate = currentDate;
            loadAllData(true);
        }
    };

    setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        checkDate();
        if (Date.now() - _lastPermissionsCheck >= PERMISSIONS_REFRESH_MS) checkPermissions();
    }, 60000);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        checkDate();
        if (Date.now() - _lastPermissionsCheck >= 60000) checkPermissions();
    });
}

// Кто был в системе до нажатия «Сменить» — нужен кнопке «Отмена» на экране выбора (30.10)
let _switchPrevEmployee = null;
let _switchFromSettings = false; // «Сменить» нажали на странице «Настройки» — «Отмена» вернёт туда же

async function logoutEmployee() {
    if (!(await showConfirm(t('employees_switch_confirm')))) return;
    closeModal();
    _switchPrevEmployee = currentEmployee;
    _switchFromSettings = (typeof isAppPageOpen === 'function') && isAppPageOpen('settingsPage');
    // Список для экрана выбора берём из базы заново: в памяти (особенно из локального снимка)
    // он мог остаться старым — без признака владельца (30.10). Нет сети — остаётся то, что есть.
    try { await reloadEmployeesList(); } catch (e) { /* оставляем список из памяти */ }
    if (typeof saveAppSnapshot === 'function') { try { saveAppSnapshot(); } catch (e) { /* не критично */ } }
    if (typeof closeAllAppPages === 'function') closeAllAppPages(); // «Настройки» — страница (22.10)
    logActivity('auth', `${t('log_signout')}: ${currentEmployee ? currentEmployee.name : ''}`);
    currentEmployee = null;
    localStorage.removeItem('currentEmployee');
    renderEmployeePickerList();
    document.getElementById('loginCancelBtn')?.classList.toggle('hidden', !_switchPrevEmployee);
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appContent').classList.add('app-locked');
    document.getElementById('settingsBtn').classList.add('hidden');
    document.getElementById('statsBtn').classList.add('hidden');
    document.getElementById('inventoryBtn')?.classList.add('hidden');
    document.getElementById('ordersViewToggle')?.classList.add('hidden');
}

// «Отмена» на экране выбора после «Сменить»: возвращаем того же сотрудника (30.10)
async function cancelEmployeeSwitch() {
    const prev = _switchPrevEmployee;
    if (!prev) return;
    const fresh = employees.find(e => e.id && e.id === prev.id) || prev;
    const backToSettings = _switchFromSettings;
    await selectEmployee(fresh);
    if (backToSettings && typeof openSettingsModal === 'function') openSettingsModal();
}

// ==================== НАЗВАНИЕ ПЕКАРНИ ====================

let _pendingOwnerForSetup = null;

function openOrgNameSetupModal(owner) {
    _pendingOwnerForSetup = owner;
    // Если название уже осмысленно задано заранее (например, тестовая
    // организация создана через Simple Hub с реальным названием) — подставляем
    // его, а не заставляем вводить заново. Для органической регистрации
    // handle_new_user() всегда ставит технический дефолт "Моя пекарня"/"My
    // Bakery" — в этом случае, наоборот, оставляем поле пустым, чтобы человек
    // ввёл настоящее название своей пекарни.
    const isPlaceholder = !currentOrgName || currentOrgName === 'Моя пекарня' || currentOrgName === 'My Bakery';
    document.getElementById('orgNameSetupInput').value = isPlaceholder ? '' : currentOrgName;
    const demoCheckbox = document.getElementById('orgNameSetupDemoCheckbox');
    if (demoCheckbox) demoCheckbox.checked = false;
    document.getElementById('orgNameSetupModal').style.display = 'flex';
}

async function saveOrgNameSetup() {
    const name = document.getElementById('orgNameSetupInput').value.trim();
    const wantsDemo = document.getElementById('orgNameSetupDemoCheckbox')?.checked;
    // Режим оплаты, выбранный при регистрации (21.10); по умолчанию — «По заказу»
    const payMode = document.querySelector('input[name="orgSetupPayMode"]:checked')?.value === 'invoice' ? 'invoice' : 'order';
    if (payMode === 'invoice') {
        try {
            await updateChecked(db.from('organizations').update({ payment_mode: 'invoice', invoicing_from: getLocalDateStr(0) }).eq('id', currentOrgId));
            currentOrgPaymentMode = 'invoice';
            currentOrgInvoicingFrom = getLocalDateStr(0);
        } catch (e) { console.error(e); }
    }
    if (name) {
        try {
            const { error } = await db.from('organizations').update({ name }).eq('id', currentOrgId);
            if (error) throw error;
            currentOrgName = name;
            updateHeaderOrgName();
        } catch (e) {
            console.error(e);
            showInfo(t('employees_name_save_delayed'));
        }
    }
    const owner = _pendingOwnerForSetup;
    if (wantsDemo && owner) {
        showLoading(t('fill_demo_loading'));
        try {
            const warnings = await createDemoData(currentOrgId, owner.id);
            if (warnings && warnings.length) {
                showInfo(t('fill_demo_success') + '\n\n⚠️ ' + warnings.join('\n⚠️ '));
            }
        } catch (e) {
            console.error(e);
            showInfo(t('fill_demo_error') + (e && e.message ? e.message : String(e)));
        } finally {
            hideLoading();
        }
    }
    document.getElementById('orgNameSetupModal').style.display = 'none';
    _pendingOwnerForSetup = null;
    await selectEmployee(owner);
    // Только теперь готов итоговый экран (пустой или с примером) — можно
    // скрыть сплэш, который до этого специально держали фоном под формой
    // приветствия (см. auth.js).
    revealAppReady();
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
    if (!hasPlanFeature('team')) { showInfo('Управление командой доступно на тарифе Full.'); return; }
    closeModal();
    await reloadEmployeesList();
    const content = document.getElementById('employeesListContent');
    content.innerHTML = '';

    employees.forEach(emp => {
        const row = document.createElement('button');
        row.className = 'nv-emp';
        const badge = emp.is_owner ? t('employees_role_owner') : (emp.user_id ? t('employees_role_personal_login') : t('employees_role_shared_device'));
        const initial = (emp.name || '?').trim().charAt(0).toUpperCase();
        row.innerHTML = `<span class="nv-ava">${escapeHtml(initial)}</span><span class="nv-en"><b>${escapeHtml(emp.name)}</b><span class="nv-role${emp.is_owner ? ' own' : ''}">${badge}</span></span><svg class="nv-chv" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;
        row.onclick = () => openEmployeeEditModal(emp);
        content.appendChild(row);
    });

    pendingInvitations.forEach(inv => {
        const row = document.createElement('div');
        row.className = 'nv-inv';
        row.innerHTML = `
            <div class="nv-inv-top">
                <span class="nv-ava" style="background:linear-gradient(180deg,#e3d4b0,#d8c590);color:#7a5a00;">${escapeHtml((inv.name || '?').trim().charAt(0).toUpperCase())}</span>
                <span class="nv-en"><span class="nv-inv-name">${escapeHtml(inv.name)}</span><span class="nv-inv-mail">${escapeHtml(inv.email)}</span></span>
                <span class="nv-role wait flex-shrink-0">${icon('clock')}${t('employees_invite_pending')}</span>
            </div>`;
        const actionsRow = document.createElement('div');
        actionsRow.className = 'nv-inv-act';

        const shareBtn = document.createElement('button');
        shareBtn.innerHTML = icon('share') + t('employees_invite_share');
        shareBtn.className = 'invite-share-btn';
        shareBtn.onclick = (e) => { e.stopPropagation(); shareInvitation(inv); };

        const cancelBtn = document.createElement('button');
        cancelBtn.innerHTML = icon('close') + t('employees_invite_cancel');
        cancelBtn.className = 'invite-cancel-btn';
        cancelBtn.onclick = (e) => { e.stopPropagation(); cancelInvitation(inv.id); };

        actionsRow.appendChild(shareBtn);
        actionsRow.appendChild(cancelBtn);
        row.appendChild(actionsRow);
        content.appendChild(row);
    });

    // Страница вместо окна (22.10). Если сверху страница сотрудника — openAppPage вернёт к списку
    // (после «Сохранить» / «Удалить» / отмены приглашения вопрос о несохранённом не нужен).
    if (appPageTop() !== 'employeesPage') openAppPage('employeesPage');
}

function openEmployeeEditModal(emp) {
    closeModal();
    document.getElementById('employeeEditId').value = emp ? emp.id : '';
    document.getElementById('employeeEditUserId').value = emp && emp.user_id ? emp.user_id : '';
    document.getElementById('employeeEditName').value = emp ? emp.name : '';
    document.getElementById('employeeEditEmail').value = '';
    document.getElementById('employeeEditTitle').textContent = emp ? (emp.name || t('employees_edit_title')) : t('employees_new_title');

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

    openAppPage('employeePage'); // страница вместо окна (22.10)
    _empFormSnapshot = _empFormState();
}

// ---- Несохранённые изменения на странице сотрудника (22.10) ----
let _empFormSnapshot = null;
function _empFormState() {
    const st = { name: document.getElementById('employeeEditName').value.trim(), email: document.getElementById('employeeEditEmail').value.trim() };
    PERMISSION_FIELDS.forEach(f => { st[f] = !!document.getElementById(PERMISSION_CHECKBOX_IDS[f]).checked; });
    return JSON.stringify(st);
}
function _empFormDirty() {
    return typeof isAppPageOpen === 'function' && isAppPageOpen('employeePage') && _empFormSnapshot !== null && _empFormState() !== _empFormSnapshot;
}
// «Назад» / уход по меню с изменениями: «Сохранить изменения?» — Сохранить / Не сохранять
async function _empPageCanLeave() {
    if (!_empFormDirty()) return true;
    const save = await showConfirm(t('employees_leave_confirm'), { ok: t('common_save'), cancel: t('employees_leave_discard') });
    if (!save) { _empFormSnapshot = null; return true; }
    return await saveEmployee({ fromLeave: true });
}
_empPageCanLeave.needed = _empFormDirty;
(window._appPageCanLeave = window._appPageCanLeave || {}).employeePage = _empPageCanLeave;
// Вернулись к списку со страницы сотрудника (в т.ч. после «Сохранить» из вопроса) — перечитать список
(window._appPageOnShow = window._appPageOnShow || {}).employeesPage = () => openEmployeesModal();

// opts.fromLeave — вызвано из вопроса при уходе со страницы: переход сделает сам уход.
// Возвращает true, если сохранено.
async function saveEmployee(opts) {
    const fromLeave = !!(opts && opts.fromLeave);
    const id = document.getElementById('employeeEditId').value;
    const name = document.getElementById('employeeEditName').value.trim();
    const email = document.getElementById('employeeEditEmail').value.trim();
    if (!name) { showInfo(t('employees_name_required')); return false; }

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
            logActivity('system', `${t('log_employee_updated')}: ${name}`);
        } else if (email) {
            // Создаём приглашение на личный вход — запись сотрудника появится сама при регистрации
            const { error } = await db.from('invitations').insert({ org_id: currentOrgId, email, name, ...permissions });
            if (error) throw error;
            logActivity('system', `${t('log_invite_sent')}: ${name} (${email})`);
            _empFormSnapshot = null;
            await reloadEmployeesList();
            if (!fromLeave) openEmployeesModal();
            hideLoading();
            await showInfo(`${t('employees_invite_created_prefix')} ${email}`);
            return true;
        } else {
            // Обычная запись для входа по имени на общем устройстве
            const { error } = await db.from('employees').insert({ org_id: currentOrgId, name, ...permissions });
            if (error) throw error;
            logActivity('system', `${t('log_employee_created')}: ${name}`);
        }
        _empFormSnapshot = null;
        await reloadEmployeesList();
        if (!fromLeave) openEmployeesModal();
        return true;
    } catch (e) {
        console.error(e);
        showInfo(t('employees_save_error'));
        return false;
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

        _empFormSnapshot = null;
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
        .replace('{email}', inv.email)
        // Строка про Google Play — только когда заполнен PLAY_STORE_URL (auth.js)
        + ((typeof PLAY_STORE_URL !== 'undefined' && PLAY_STORE_URL) ? t('employees_invite_play_line').replace('{play}', PLAY_STORE_URL) : '');
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
        logActivity('system', `${t('log_cost_fixed')} ${fixed} ${t('log_order_items_word')}`);
        await showInfo(`Готово: зафиксировано ${fixed} позиций из ${toFix.length}.`);
    } catch (e) {
        console.error(e);
        await showInfo(`Ошибка: зафиксировано ${fixed} из ${toFix.length}. Попробуйте ещё раз.`);
    } finally { hideLoading(); }
}
