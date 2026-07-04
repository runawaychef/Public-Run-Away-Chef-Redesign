// ==================== СКЛАД ====================
// Учёт остатков ингредиентов: приход (ручной), расход (автоматически из заказов).
// Зависит от: db, ingredients, orders, semiFinished, products, UNIT_LABELS,
//             showLoading, hideLoading, showInfo, showConfirm, closeModal, logActivity.

const STOCK_LOW_DAYS = 7; // порог «критически мало» — менее N дней запаса

function openSettingsModal() {
    document.getElementById('settingsCurrentEmployee').textContent = currentEmployee ? currentEmployee.name : '—';
    renderPlanInfo();
    document.getElementById('settingsModal').style.display = 'flex';
}

// Показывает текущий тариф и, для бесплатного — сколько уже использовано из лимита.
// Считаем реально существующие записи (уже загружены в приложении), а не отдельный
// счётчик "за всё время" — так честнее для пользователя и надёжнее технически.
function renderPlanInfo() {
    const badge = document.getElementById('settingsPlanBadge');
    const usage = document.getElementById('settingsPlanUsage');
    if (!badge || !usage) return;

    const isFree = currentOrgPlan === 'free';
    if (isFree) {
        badge.textContent = 'Бесплатный';
        badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-200 text-gray-700';

        const custLimit = 5, orderLimit = 50;
        const custCount = (customers || []).length;
        const orderCount = (orders || []).length;

        const custColor = custCount >= custLimit ? 'text-red-600' : custCount >= custLimit * 0.8 ? 'text-amber-600' : 'text-gray-500';
        const orderColor = orderCount >= orderLimit ? 'text-red-600' : orderCount >= orderLimit * 0.8 ? 'text-amber-600' : 'text-gray-500';

        usage.innerHTML = `
            <div class="${custColor}">Клиенты: ${custCount} из ${custLimit}</div>
            <div class="${orderColor}">Заказы: ${orderCount} из ${orderLimit}</div>`;
    } else {
        badge.textContent = 'Платный';
        badge.className = 'text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700';
        usage.innerHTML = '<div>Лимиты не действуют.</div>';
    }
}

// Кэш данных склада: { ingredient_id: { total_in, total_out, balance } }
let _inventoryCache = {};

// ── Загрузка и расчёт остатков ──────────────────────────────────────────────

async function loadInventory() {
    try {
        const { data, error } = await db
            .from('inventory')
            .select('ingredient_id, semi_finished_id, type, quantity')
            .limit(50000);
        if (error) throw error;

        const cache = {};
        (data || []).forEach(row => {
            const key = row.semi_finished_id ? `sf_${row.semi_finished_id}` : `ing_${row.ingredient_id}`;
            if (!cache[key]) cache[key] = { in: 0, out: 0 };
            if (row.type === 'приход')  cache[key].in  += Number(row.quantity);
            if (row.type === 'расход')  cache[key].out += Number(row.quantity);
            if (row.type === 'сторно')  cache[key].out -= Number(row.quantity);
        });
        _inventoryCache = cache;
        updateInventoryAlertDot();
    } catch (e) { console.error('Ошибка загрузки склада:', e); }
}

// Остаток ингредиента
function getIngredientBalance(ingId) {
    const c = _inventoryCache[`ing_${ingId}`];
    if (!c) return null;
    return parseFloat((c.in - c.out).toFixed(4));
}

// Остаток полуфабриката
function getSemiFinishedBalance(sfId) {
    const c = _inventoryCache[`sf_${sfId}`];
    if (!c) return null;
    return parseFloat((c.in - c.out).toFixed(4));
}

// Проверяет используется ли ингредиент напрямую в изделиях (не через п/ф)
function isIngredientUsedDirectlyInProducts(ingId) {
    return (products || []).some(prod =>
        (prod.ingredients || []).some(ri => ri.ingredient_id === ingId)
    );
}

// Возвращает список п/ф в которых участвует ингредиент
function getSfContainingIngredient(ingId) {
    return (semiFinished || []).filter(sf =>
        (sf.ingredients || []).some(ri => ri.ingredient_id === ingId)
    );
}

// Возвращает зону тревоги п/ф: 'red', 'yellow', или null
function getSfAlertZone(sf, neededSfForOrders) {
    const balance  = getSemiFinishedBalance(sf.id);
    const daily    = avgDailySfUsage(sf.id);
    const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
    const shortage = neededSfForOrders && neededSfForOrders[sf.id] > 0 &&
        (balance === null || balance < neededSfForOrders[sf.id]);
    if (shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3)) return 'red';
    if (daysLeft !== null && daysLeft < 7) return 'yellow';
    return null;
}

// Средний расход ингредиента в день за последние 30 дней из выполненных заказов
function avgDailyUsage(ingId) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    let totalUsed = 0;
    orders.forEach(o => {
        if (o.date < cutoffStr) return;
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            prod.ingredients.forEach(ri => {
                if (ri.ingredient_id === ingId && !ri.semi_finished_id) {
                    totalUsed += (Number(ri.quantity) / Number(prod.batch_size || 1)) * Number(item.quantity);
                }
                // Полуфабрикаты
                if (ri.semi_finished_id) {
                    const sf = semiFinished.find(s => s.id === ri.semi_finished_id);
                    if (!sf || !sf.ingredients) return;
                    sf.ingredients.forEach(sfi => {
                        if (sfi.ingredient_id === ingId) {
                            const sfFactor = Number(ri.quantity) / Number(sf.batch_size || 1);
                            totalUsed += (Number(sfi.quantity) * sfFactor / Number(prod.batch_size || 1)) * Number(item.quantity);
                        }
                    });
                }
            });
        });
    });

    return totalUsed / 30; // в день
}

// Показывает/скрывает пульсирующую точку на иконке корзины
function updateInventoryAlertDot() {
    const dot = document.getElementById('inventoryAlertDot');
    if (!dot) return;

    // 1. Проверяем изделия с галочкой track_stock
    const trackedIngIds = new Set();
    (products || []).filter(p => p.track_stock).forEach(prod => {
        (prod.ingredients || []).forEach(ri => {
            if (ri.ingredient_id) trackedIngIds.add(ri.ingredient_id);
        });
    });
    const hasLowTracked = [...trackedIngIds].some(ingId => {
        // Если ингредиент только в п/ф — смотрим зону п/ф
        const usedDirectly = isIngredientUsedDirectlyInProducts(ingId);
        if (!usedDirectly) {
            const parentSfs = getSfContainingIngredient(ingId);
            if (parentSfs.length > 0) {
                return parentSfs.some(sf => getSfAlertZone(sf, {}) !== null);
            }
        }
        const balance = getIngredientBalance(ingId);
        if (balance === null || balance <= 0) return false;
        const daily = avgDailyUsage(ingId);
        if (!daily) return false;
        return (balance / daily) < STOCK_LOW_DAYS;
    });

    // 1б. Проверяем п/ф с галочкой track_stock
    const hasLowTrackedSf = (semiFinished || []).filter(sf => sf.track_stock).some(sf => {
        const balance = getSemiFinishedBalance(sf.id);
        if (balance === null || balance <= 0) return true; // нет запаса — уже плохо
        const daily = avgDailySfUsage(sf.id);
        if (!daily) return false;
        return (balance / daily) < STOCK_LOW_DAYS;
    });

    // 2. Проверяем принятые заказы — хватит ли ингредиентов и п/ф
    const today = getLocalDateStr(0);
    const pendingOrders = (orders || []).filter(o => o.status !== 'выполнен' && o.date >= today);
    let hasShortage = false;
    const needed = {};
    const neededSf = {};
    pendingOrders.forEach(o => {
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                const qty = Number(ri.quantity) * Number(item.quantity) * factor;
                if (ri.ingredient_id) {
                    needed[ri.ingredient_id] = (needed[ri.ingredient_id] || 0) + qty;
                } else if (ri.semi_finished_id) {
                    neededSf[ri.semi_finished_id] = (neededSf[ri.semi_finished_id] || 0) + qty;
                }
            });
        });
    });
    hasShortage = Object.entries(needed).some(([ingId, qty]) => {
        const balance = getIngredientBalance(Number(ingId));
        return balance !== null && balance < qty;
    }) || Object.entries(neededSf).some(([sfId, qty]) => {
        const balance = getSemiFinishedBalance(Number(sfId));
        return balance !== null && balance < qty;
    });

    dot.classList.toggle('hidden', !hasLowTracked && !hasLowTrackedSf && !hasShortage);
}

// ── Открытие окна склада ─────────────────────────────────────────────────────

async function openInventoryModal() {
    if (!hasPermission('can_manage_inventory')) {
        showInfo('У вас нет доступа к складу. Обратитесь к владельцу пекарни.');
        return;
    }
    showLoading('Загружаю склад...');
    await Promise.all([loadInventory(), loadShoppingList()]);
    hideLoading();

    // Сбрасываем на вкладку «Склад» при каждом открытии
    _activeInventoryTab = 'stock';
    document.getElementById('inventoryTabStock').classList.remove('hidden');
    document.getElementById('inventoryTabShop').classList.add('hidden');
    document.getElementById('invTabStock').classList.add('active');
    document.getElementById('invTabShop').classList.remove('active');

    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

    // Считаем нехватку для принятых заказов.
    // П/ф НЕ раскрываем до ингредиентов — нехватку п/ф проверяем по его остатку.
    const today = getLocalDateStr(0);
    const neededForOrders = {};    // ingredient_id -> qty
    const neededSfForOrders = {}; // semi_finished_id -> qty
    (orders || []).filter(o => o.status !== 'выполнен' && o.date >= today).forEach(o => {
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                if (ri.ingredient_id) {
                    neededForOrders[ri.ingredient_id] = (neededForOrders[ri.ingredient_id] || 0) +
                        Number(ri.quantity) * Number(item.quantity) * factor;
                } else if (ri.semi_finished_id) {
                    neededSfForOrders[ri.semi_finished_id] = (neededSfForOrders[ri.semi_finished_id] || 0) +
                        Number(ri.quantity) * Number(item.quantity) * factor;
                }
            });
        });
    });

    // Сортируем по алфавиту и разбиваем на три группы
    const sorted = ingredients.slice().sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const red    = []; // < 3 дней или нехватка для заказа
    const yellow = []; // 3-7 дней
    const rest   = []; // всё остальное

    sorted.forEach(ing => {
        const balance   = getIngredientBalance(ing.id);
        const daily     = avgDailyUsage(ing.id);
        const daysLeft  = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const shortage  = neededForOrders[ing.id] > 0 && (balance === null || balance < neededForOrders[ing.id]);
        const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
        const item      = { ing, balance, daysLeft, unitLabel, shortage };

        // Если ингредиент используется ТОЛЬКО через п/ф (не напрямую в изделиях,
        // не в других п/ф кроме одного) — его зона определяется зоной родительских п/ф.
        // Смысл: пока п/ф в норме — незачем тревожить из-за ингредиента.
        // Как только п/ф начнёт заканчиваться — ингредиент поднимется вместе с ним.
        const usedDirectly = isIngredientUsedDirectlyInProducts(ing.id);
        if (!usedDirectly) {
            const parentSfs = getSfContainingIngredient(ing.id);
            if (parentSfs.length > 0) {
                // Шаг 1: определяем худшую зону родительских п/ф
                const sfZone = parentSfs.reduce((worst, sf) => {
                    const zone = getSfAlertZone(sf, neededSfForOrders);
                    if (zone === 'red') return 'red';
                    if (zone === 'yellow' && worst !== 'red') return 'yellow';
                    return worst;
                }, null);

                // П/ф в норме → ингредиент всегда в «Остальных»
                if (!sfZone) { rest.push(item); return; }

                // Шаг 2: п/ф в жёлтой или красной зоне → проверяем запас ингредиента
                // Хватает ли его на ≥1 партию п/ф (batch_size)?
                const ingBalance = balance || 0;
                const enoughForOneBatch = parentSfs.some(sf => {
                    // Сколько этого ингредиента нужно на одну партию п/ф
                    const sfRecipe = (sf.ingredients || []).filter(r => r.ingredient_id === ing.id);
                    const needed = sfRecipe.reduce((sum, r) => sum + Number(r.quantity), 0);
                    return needed > 0 && ingBalance >= needed;
                });

                if (enoughForOneBatch) {
                    // Остатка хватает на ≥1 партию → не поднимаем
                    rest.push(item);
                } else {
                    // Остатка меньше чем на одну партию → поднимаем по стандартной логике
                    if (ingBalance <= 0 || (daysLeft !== null && daysLeft < 3)) red.push(item);
                    else if (daysLeft !== null && daysLeft < 7) yellow.push(item);
                    else rest.push(item);
                }
                return;
            }
        }

        if (shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3)) {
            red.push(item);
        } else if (daysLeft !== null && daysLeft < 7) {
            yellow.push(item);
        } else {
            rest.push(item);
        }
    });

    function renderRow(item, bgClass, daysClass, isSf) {
        const { ing, balance, daysLeft, unitLabel, shortage } = item;
        const balanceStr = balance !== null ? `${Number(balance).toFixed(1)} ${unitLabel}` : '—';
        const daysStr    = shortage ? 'нехватка' : daysLeft !== null ? `~${daysLeft} дн.` : '—';
        const inList     = isSf
            ? _shoppingList.some(r => r.semi_finished_id === ing.id)
            : _shoppingList.some(r => r.ingredient_id === ing.id);
        const addBtn = inList
            ? `<span class="text-green-600 text-xs font-semibold"><svg class="w-3.5 h-3.5 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></span>`
            : `<button onclick="addRowToShoppingList(${isSf ? 'null' : ing.id}, ${isSf ? ing.id : 'null'})" class="btn bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded text-xs hover:bg-indigo-100">+</button>`;
        const detailClick = isSf
            ? `closeModal(); showTab('semiFinished'); openSemiFinishedDetail(${ing.id});`
            : `closeModal(); showTab('ingredients'); openIngredientDetail(${ing.id});`;
        return `<tr class="border-b">
            <td class="p-1 table-text cursor-pointer hover:underline" onclick="${detailClick}">${escapeHtml(ing.name)}</td>
            <td class="p-1 table-text text-right">${balanceStr}</td>
            <td class="p-1 table-text text-right ${daysClass} font-semibold">${daysStr}</td>
            <td class="p-1 text-center">${addBtn}</td>
        </tr>`;
    }

    // Разбиваем п/ф на группы заранее — критичные и жёлтые поднимем наверх
    const sfSorted = (semiFinished || []).slice().sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const SF_UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const sfRed = [], sfYellow = [], sfRest = [];
    sfSorted.forEach(sf => {
        const balance  = getSemiFinishedBalance(sf.id);
        const daily    = avgDailySfUsage(sf.id);
        const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const unitLabel = SF_UNIT_LABELS[sf.unit] || sf.unit;
        const needed = neededSfForOrders[sf.id] || 0;
        const shortage = needed > 0 && (balance === null || balance < needed);
        const item = { ing: { id: sf.id, name: sf.name }, balance, daysLeft, unitLabel, shortage };
        if (shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3)) sfRed.push(item);
        else if (daysLeft !== null && daysLeft < 7) sfYellow.push(item);
        else sfRest.push(item);
    });

    // 📅 Плановый расход — сколько и когда спишется по заказам с отложенным
    // списанием (inventory_pending). Суммируем по ингредиенту/п-ф на случай,
    // если он нужен для нескольких отложенных заказов, показываем ближайшую дату.
    const pendingByKey = {};
    (orders || []).filter(o => o.inventory_pending).forEach(o => {
        const writeOffDate = getWriteOffDate(o.date);
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                let key, name, unit;
                if (ri.ingredient_id) {
                    const ing = ingredients.find(i => i.id === ri.ingredient_id);
                    if (!ing) return;
                    key = `ing_${ing.id}`; name = ing.name; unit = UNIT_LABELS[ing.unit] || ing.unit;
                } else if (ri.semi_finished_id) {
                    const sfP = semiFinished.find(s => s.id === ri.semi_finished_id);
                    if (!sfP) return;
                    key = `sf_${sfP.id}`; name = sfP.name; unit = UNIT_LABELS[sfP.unit] || sfP.unit;
                } else return;
                const qty = Number(ri.quantity) * Number(item.quantity) * factor;
                if (!pendingByKey[key]) pendingByKey[key] = { name, unit, qty: 0, earliestDate: writeOffDate };
                pendingByKey[key].qty += qty;
                if (writeOffDate < pendingByKey[key].earliestDate) pendingByKey[key].earliestDate = writeOffDate;
            });
        });
    });
    const pendingRows = Object.values(pendingByKey).sort((a, b) => a.earliestDate.localeCompare(b.earliestDate));

    // Компактный бейдж наверху — виден сразу, без прокрутки до конца списка.
    // Сам блок с деталями остаётся внизу, чтобы не оттеснять "Критично" по важности.
    let html = '';
    if (pendingRows.length) {
        html += `<div onclick="document.getElementById('pendingWriteOffBlock').scrollIntoView({behavior:'smooth'})" class="mb-2 p-1.5 bg-indigo-50 border border-indigo-200 rounded-md text-xs text-indigo-700 cursor-pointer flex items-center justify-between">
            <span>📅 Запланировано списаний: ${pendingRows.length} · ближайшее ${formatDateDMY(pendingRows[0].earliestDate)}</span>
            <span class="text-indigo-400">Показать ↓</span>
        </div>`;
    }

    html += '<table class="w-full text-xs"><thead><tr class="bg-gray-100 sticky top-0"><th class="p-1 text-left">Ингредиент</th><th class="p-1 text-right">Остаток</th><th class="p-1 text-right">Хватит</th><th class="p-1 text-center">Список</th></tr></thead><tbody>';

    // 🔴 Критично: ингредиенты
    if (red.length) {
        html += `<tr><td colspan="4" class="p-1 text-xs font-semibold text-red-600"><span class="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span>Критично</td></tr>`;
        red.forEach(item => { html += renderRow(item, null, 'text-red-600', false); });
    }
    // 🔴 Критично: полуфабрикаты
    if (sfRed.length) {
        html += `<tr><td colspan="4" class="p-1 text-xs font-semibold text-red-600"><span class="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span>Критично — п/ф</td></tr>`;
        sfRed.forEach(item => { html += renderRow(item, null, 'text-red-600', true); });
    }
    // 🟡 Заканчивается: ингредиенты
    if (yellow.length) {
        html += `<tr><td colspan="4" class="p-1 text-xs font-semibold text-yellow-700"><span class="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1"></span>Заканчивается</td></tr>`;
        yellow.forEach(item => { html += renderRow(item, null, 'text-yellow-700', false); });
    }
    // 🟡 Заканчивается: полуфабрикаты
    if (sfYellow.length) {
        html += `<tr><td colspan="4" class="p-1 text-xs font-semibold text-yellow-700"><span class="inline-block w-2 h-2 rounded-full bg-yellow-500 mr-1"></span>Заканчивается — п/ф</td></tr>`;
        sfYellow.forEach(item => { html += renderRow(item, null, 'text-yellow-700', true); });
    }
    // Остальные ингредиенты
    if (rest.length) {
        if (red.length || yellow.length || sfRed.length || sfYellow.length) {
            html += `<tr><td colspan="4" class="p-1 text-xs font-semibold text-gray-500">Остальные</td></tr>`;
        }
        rest.sort((a, b) => {
            if (a.daysLeft === null && b.daysLeft === null) return 0;
            if (a.daysLeft === null) return 1;
            if (b.daysLeft === null) return -1;
            return a.daysLeft - b.daysLeft;
        });
        rest.forEach(item => { html += renderRow(item, '', 'text-gray-500', false); });
    }

    html += '</tbody></table>';

    // Остальные полуфабрикаты — внизу отдельной таблицей
    if (sfRest.length) {
        html += `<p class="text-xs font-semibold text-gray-600 mt-3 mb-1">Полуфабрикаты</p>`;
        html += '<table class="w-full text-xs"><thead><tr class="bg-gray-100 sticky top-0"><th class="p-1 text-left">Название</th><th class="p-1 text-right">Остаток</th><th class="p-1 text-right">Хватит</th><th class="p-1 text-center">Список</th></tr></thead><tbody>';
        sfRest.sort((a, b) => {
            if (a.daysLeft === null && b.daysLeft === null) return 0;
            if (a.daysLeft === null) return 1;
            if (b.daysLeft === null) return -1;
            return a.daysLeft - b.daysLeft;
        });
        sfRest.forEach(item => { html += renderRow(item, '', 'text-gray-500', true); });
        html += '</tbody></table>';
    }

    // 📅 Плановый расход — сам блок, внизу (бейдж наверху уже даёт о нём знать)
    if (pendingRows.length) {
        html += `<p id="pendingWriteOffBlock" class="text-xs font-semibold text-indigo-700 mt-3 mb-1">📅 Плановый расход</p>`;
        html += '<table class="w-full text-xs"><thead><tr class="bg-gray-100 sticky top-0"><th class="p-1 text-left">Ингредиент</th><th class="p-1 text-right">Количество</th><th class="p-1 text-right">Дата списания</th></tr></thead><tbody>';
        pendingRows.forEach(r => {
            html += `<tr class="border-b"><td class="p-1 table-text">${escapeHtml(r.name)}</td><td class="p-1 table-text text-right">${r.qty.toFixed(2)} ${r.unit}</td><td class="p-1 table-text text-right">${formatDateDMY(r.earliestDate)}</td></tr>`;
        });
        html += '</tbody></table>';
    }

    document.getElementById('inventoryContent').innerHTML = html;
    document.getElementById('inventoryModal').style.display = 'flex';
}

// ── Инвентаризация ───────────────────────────────────────────────────────────

function openInventarizationModal() {
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const sorted = ingredients.slice().sort((a, b) => (a.name||'').localeCompare(b.name||''));
    const today  = getLocalDateStr(0);

    let html = '<table class="w-full text-xs">';
    html += '<thead><tr class="bg-gray-100"><th class="p-1 text-left">Ингредиент</th><th class="p-1 text-right">Текущий остаток</th><th class="p-1 text-right">Фактически</th></tr></thead><tbody>';
    sorted.forEach(ing => {
        const unitLabel = UNIT_LABELS[ing.unit] || ing.unit;
        const balance   = getIngredientBalance(ing.id);
        const balStr    = balance !== null ? `${Number(balance).toFixed(2)} ${unitLabel}` : '—';
        html += `<tr class="border-b">
            <td class="p-1">${escapeHtml(ing.name)}</td>
            <td class="p-1 text-right text-gray-500">${balStr}</td>
            <td class="p-1 text-right">
                <input type="number" inputmode="decimal" step="0.01" min="0"
                    data-ing-id="${ing.id}" data-unit="${unitLabel}"
                    class="inv-qty-input border p-0.5 rounded text-xs w-24 text-right"
                    placeholder="${unitLabel}">
            </td>
        </tr>`;
    });
    html += '</tbody></table>';

    document.getElementById('inventarizationContent').innerHTML = html;
    document.getElementById('inventarizationModal').style.display = 'flex';
}

async function saveInventarization() {
    const inputs = document.querySelectorAll('.inv-qty-input');
    const today  = getLocalDateStr(0);
    const rows   = [];

    inputs.forEach(input => {
        const val = parseFloat(input.value);
        if (isNaN(val) || input.value === '') return; // пропускаем пустые
        const ingId   = Number(input.dataset.ingId);
        const balance = getIngredientBalance(ingId) || 0;
        const diff    = parseFloat((val - balance).toFixed(4));
        if (Math.abs(diff) < 0.0001) return; // разницы нет — пропускаем
        rows.push({
            ingredient_id: ingId,
            type:     diff > 0 ? 'приход' : 'расход',
            quantity: Math.abs(diff),
            notes:    `Инвентаризация ${today}`
        });
    });

    if (!rows.length) {
        await showInfo('Нет изменений — все фактические остатки совпадают с текущими.');
        return;
    }

    const ok = await showConfirm(`Записать ${rows.length} корректировок по результатам инвентаризации?`);
    if (!ok) return;

    showLoading('Сохраняю инвентаризацию...');
    try {
        const rowsWithOrg = rows.map(r => ({ org_id: currentOrgId, ...r }));
        const { error } = await db.from('inventory').insert(rowsWithOrg);
        if (error) throw error;
        await loadInventory();
        closeModal();
        displayIngredients();
        logActivity('inventory', `Инвентаризация ${today}: скорректировано ${rows.length} позиций`);
        await showInfo(`Инвентаризация сохранена. Скорректировано: ${rows.length} позиций.`);
    } catch(e) { console.error(e); showInfo('Ошибка сохранения.'); }
    finally { hideLoading(); }
}

// ── Пополнение склада ────────────────────────────────────────────────────────

function openInventoryAddModal(ingId) {
    const ing = ingredients.find(i => i.id === ingId);
    if (!ing) return;
    const UNIT_LABELS = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    document.getElementById('inventoryAddTitle').textContent = `Пополнить: ${ing.name}`;
    document.getElementById('inventoryAddIngId').value = ingId;
    document.getElementById('inventoryAddUnit').textContent = UNIT_LABELS[ing.unit] || ing.unit;
    document.getElementById('inventoryAddQty').value = '';
    document.getElementById('inventoryAddNotes').value = '';
    document.getElementById('inventoryAddModal').style.display = 'flex';
}

async function saveInventoryAdd() {
    const ingId = Number(document.getElementById('inventoryAddIngId').value);
    const qty   = parseFloat(document.getElementById('inventoryAddQty').value);
    const notes = document.getElementById('inventoryAddNotes').value.trim();
    if (!ingId || isNaN(qty) || qty <= 0) { showInfo('Введите корректное количество!'); return; }
    showLoading();
    try {
        const { error } = await db.from('inventory').insert({
            org_id: currentOrgId,
            ingredient_id: ingId,
            type: 'приход',
            quantity: parseFloat(qty.toFixed(4)),
            notes: notes || null
        });
        if (error) throw error;
        closeModal();
        const ing = ingredients.find(i => i.id === ingId);
        logActivity('inventory', `Пополнен склад: «${ing ? ing.name : ingId}» +${qty}`);
        await loadInventory();
        // Обновляем окно склада
        await openInventoryModal();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения.'); }
    finally { hideLoading(); }
}

// ── Списание при создании заказа ─────────────────────────────────────────────

// Вызывается при добавлении позиции в заказ
async function writeOffInventoryForItem(prod, itemQty, orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (!prod || !prod.ingredients || !prod.ingredients.length) return;
    const rows = [];
    const qtyFactor = 1 / Number(prod.batch_size || 1);

    prod.ingredients.forEach(ri => {
        if (ri.semi_finished_id) {
            // Списываем п/ф как единицу склада
            const totalQty = Number(ri.quantity) * itemQty * qtyFactor;
            const existing = rows.find(r => r.semi_finished_id === ri.semi_finished_id);
            if (existing) { existing.quantity += totalQty; }
            else { rows.push({ semi_finished_id: ri.semi_finished_id, quantity: totalQty }); }
        } else if (ri.ingredient_id) {
            // Списываем прямой ингредиент
            const totalQty = Number(ri.quantity) * itemQty * qtyFactor;
            const existing = rows.find(r => r.ingredient_id === ri.ingredient_id);
            if (existing) { existing.quantity += totalQty; }
            else { rows.push({ ingredient_id: ri.ingredient_id, quantity: totalQty }); }
        }
    });

    if (!rows.length) return;
    try {
        await db.from('inventory').insert(rows.map(r => ({
            org_id:           currentOrgId,
            ingredient_id:    r.ingredient_id || null,
            semi_finished_id: r.semi_finished_id || null,
            type:     'расход',
            quantity: parseFloat(r.quantity.toFixed(4)),
            order_id: orderId,
            notes:    `Заказ #${orderId}`
        })));
        await loadInventory();
    } catch (e) { console.error('Ошибка списания со склада:', e); }
}

// Сторнирование при удалении заказа
async function reverseInventoryForOrder(orderId) {
    try {
        const { data, error } = await db.from('inventory')
            .select('id, ingredient_id, semi_finished_id, quantity')
            .eq('order_id', orderId)
            .eq('type', 'расход');
        if (error || !data || !data.length) return;

        await db.from('inventory').insert(data.map(r => ({
            org_id:           currentOrgId,
            ingredient_id:    r.ingredient_id || null,
            semi_finished_id: r.semi_finished_id || null,
            type:     'сторно',
            quantity: r.quantity,
            order_id: orderId,
            notes:    `Сторно заказа #${orderId}`
        })));
        await loadInventory();
    } catch (e) { console.error('Ошибка сторнирования:', e); }
}

// ==================== СПИСОК ПОКУПОК ====================
// Общий список для Сержа и Марка, хранится в Supabase (таблица shopping_list).
// Добавить: вручную из склада кнопкой «+ В список», или «Добавить всё критичное».
// Количество: дефицит из аналитики, редактируется вручную.
// Очистка: только кнопкой «Очистить всё».

let _shoppingList = []; // кэш текущего списка покупок
let _activeInventoryTab = 'stock'; // 'stock' | 'shop'

// ── Переключение вкладок ─────────────────────────────────────────────────────

function switchInventoryTab(tab) {
    _activeInventoryTab = tab;
    document.getElementById('inventoryTabStock').classList.toggle('hidden', tab !== 'stock');
    document.getElementById('inventoryTabShop').classList.toggle('hidden', tab !== 'shop');
    document.getElementById('invTabStock').classList.toggle('active', tab === 'stock');
    document.getElementById('invTabShop').classList.toggle('active', tab === 'shop');
    const title = document.getElementById('inventoryModalTitle');
    if (title) title.innerHTML = tab === 'stock' ? (icon('cart') + 'Аналитика склада') : (icon('cart') + 'Корзина покупок');
    if (tab === 'shop') renderShoppingList();
}

// ── Загрузка списка из Supabase ──────────────────────────────────────────────

async function loadShoppingList() {
    try {
        const { data, error } = await db
            .from('shopping_list')
            .select('id, ingredient_id, semi_finished_id, quantity_to_buy, is_bought, notes')
            .order('id', { ascending: true });
        if (error) throw error;
        _shoppingList = data || [];
        updateShopListBadge();
    } catch (e) { console.error('Ошибка загрузки списка покупок:', e); }
}

// ── Бейдж с количеством непокупленных позиций ────────────────────────────────

function updateShopListBadge() {
    const badge = document.getElementById('shopListBadge');
    if (!badge) return;
    const count = _shoppingList.filter(r => !r.is_bought).length;
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ── Рендер списка покупок ────────────────────────────────────────────────────

function renderShoppingList() {
    const container = document.getElementById('shopListContent');
    if (!container) return;
    const UL = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

    if (!_shoppingList.length) {
        container.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Список пуст. Добавьте позиции кнопкой «+ Добавить критичное» или из карточки ингредиента.</p>';
        updateShopListBadge();
        return;
    }

    let html = '<table class="w-full text-xs" style="table-layout:fixed;">';
    html += '<thead><tr class="bg-gray-100"><th class="p-1 text-left" style="width:38%;">Название</th><th class="p-1 text-right" style="width:20%;">Есть</th><th class="p-1 text-right" style="width:24%;">Купить</th><th class="p-1 text-center" style="width:18%;"></th></tr></thead><tbody>';

    _shoppingList.forEach(row => {
        let name = '—', balanceStr = '—', unit = '';
        if (row.ingredient_id) {
            const ing = (ingredients || []).find(i => i.id === row.ingredient_id);
            if (ing) {
                name = ing.name;
                unit = UL[ing.unit] || ing.unit;
                const bal = getIngredientBalance(ing.id);
                balanceStr = bal !== null ? `${Number(bal).toFixed(1)} ${unit}` : '—';
            }
        } else if (row.semi_finished_id) {
            const sf = (semiFinished || []).find(s => s.id === row.semi_finished_id);
            if (sf) {
                name = sf.name;
                unit = UL[sf.unit] || sf.unit;
                const bal = getSemiFinishedBalance(sf.id);
                balanceStr = bal !== null ? `${Number(bal).toFixed(1)} ${unit}` : '—';
            }
        }

        const doneClass = row.is_bought ? 'line-through text-gray-400' : '';
        const rowBg = row.is_bought ? 'bg-gray-50' : '';

        html += `<tr class="border-b ${rowBg}">
            <td class="p-1 ${doneClass}" style="word-break:break-word;">
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" ${row.is_bought ? 'checked' : ''} onchange="toggleShopItem(${row.id}, this.checked)" class="shrink-0">
                    <span>${escapeHtml(name)}</span>
                </label>
            </td>
            <td class="p-1 text-right text-gray-500 ${doneClass}">${balanceStr}</td>
            <td class="p-1 text-right">
                <input type="number" inputmode="decimal" step="0.01" min="0"
                    value="${Number(row.quantity_to_buy).toFixed(2)}"
                    onchange="updateShopItemQty(${row.id}, this.value)"
                    class="border rounded p-0.5 text-xs w-full text-right ${row.is_bought ? 'text-gray-400' : ''}">
            </td>
            <td class="p-1 text-center">
                <button onclick="removeShopItem(${row.id})" class="text-gray-300 hover:text-red-500" title="Удалить">${icon('close', 'w-3.5 h-3.5')}</button>
            </td>
        </tr>`;
    });

    html += '</tbody></table>';

    // Итог: сколько позиций куплено
    const bought = _shoppingList.filter(r => r.is_bought).length;
    const total  = _shoppingList.length;
    html += `<p class="text-xs text-gray-400 text-right mt-2">Куплено: ${bought} из ${total}</p>`;

    container.innerHTML = html;
    updateShopListBadge();
}

// ── Добавить позицию в список ────────────────────────────────────────────────

async function addToShoppingList(ingredientId, semiFinshedId, qty) {
    // Не добавляем дубли
    const exists = _shoppingList.find(r =>
        (ingredientId && r.ingredient_id === ingredientId) ||
        (semiFinshedId && r.semi_finished_id === semiFinshedId)
    );
    if (exists) return;

    try {
        const { data, error } = await db.from('shopping_list').insert({
            org_id:           currentOrgId,
            ingredient_id:    ingredientId    || null,
            semi_finished_id: semiFinshedId   || null,
            quantity_to_buy:  parseFloat((qty || 0).toFixed(2)),
            is_bought:        false
        }).select().single();
        if (error) throw error;
        _shoppingList.push(data);
        updateShopListBadge();
    } catch (e) { console.error('Ошибка добавления в список покупок:', e); }
}

// ── «+ Добавить критичное» — всё красное из текущей аналитики склада ─────────

async function addCriticalToShoppingList() {
    const UL = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };
    const today = getLocalDateStr(0);

    // Считаем нехватку для заказов — П/ф НЕ раскрываем до ингредиентов
    const neededForOrders = {};    // ingredient_id -> qty
    const neededSfOrders = {};     // semi_finished_id -> qty
    (orders || []).filter(o => o.status !== 'выполнен' && o.date >= today).forEach(o => {
        (o.items || []).forEach(item => {
            const prod = products.find(p => p.id === item.product_id);
            if (!prod || !prod.ingredients) return;
            const factor = 1 / Number(prod.batch_size || 1);
            prod.ingredients.forEach(ri => {
                if (ri.ingredient_id) {
                    neededForOrders[ri.ingredient_id] = (neededForOrders[ri.ingredient_id] || 0) +
                        Number(ri.quantity) * Number(item.quantity) * factor;
                } else if (ri.semi_finished_id) {
                    neededSfOrders[ri.semi_finished_id] = (neededSfOrders[ri.semi_finished_id] || 0) +
                        Number(ri.quantity) * Number(item.quantity) * factor;
                }
            });
        });
    });

    // Ингредиенты в красной зоне
    const criticalIngs = (ingredients || []).filter(ing => {
        const balance  = getIngredientBalance(ing.id);
        const daily    = avgDailyUsage(ing.id);
        const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const shortage = (neededForOrders[ing.id] || 0) > 0 && (balance === null || balance < neededForOrders[ing.id]);
        return shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3);
    });

    // П/ф в красной зоне — используем neededSfOrders, посчитанный выше
    const criticalSf = (semiFinished || []).filter(sf => {
        const balance  = getSemiFinishedBalance(sf.id);
        const daily    = avgDailySfUsage(sf.id);
        const daysLeft = (balance !== null && balance > 0 && daily > 0) ? Math.floor(balance / daily) : null;
        const needed   = neededSfOrders[sf.id] || 0;
        const shortage = needed > 0 && (balance === null || balance < needed);
        return shortage || (balance !== null && balance <= 0) || (daysLeft !== null && daysLeft < 3);
    });

    if (!criticalIngs.length && !criticalSf.length) {
        await showInfo('Нет критичных позиций для добавления.');
        return;
    }

    showLoading('Добавляю в список...');
    try {
        // Для каждого критичного считаем дефицит как количество к покупке
        for (const ing of criticalIngs) {
            const balance = getIngredientBalance(ing.id) || 0;
            const needed  = neededForOrders[ing.id] || 0;
            // Дефицит = сколько не хватает; если просто заканчивается — среднесуточный × 14 дней
            const daily   = avgDailyUsage(ing.id);
            let toBuy = needed > balance ? Math.ceil((needed - balance) / 100) * 100 : 0;
            if (toBuy === 0 && daily > 0) toBuy = Math.ceil((daily * 14) / 100) * 100;
            await addToShoppingList(ing.id, null, toBuy);
        }
        for (const sf of criticalSf) {
            const balance = getSemiFinishedBalance(sf.id) || 0;
            const needed  = neededSfOrders[sf.id] || 0;
            const daily   = avgDailySfUsage(sf.id);
            let toBuy = needed > balance ? Math.ceil((needed - balance) / 100) * 100 : 0;
            if (toBuy === 0 && daily > 0) toBuy = Math.ceil((daily * 14) / 100) * 100;
            await addToShoppingList(null, sf.id, toBuy);
        }
        switchInventoryTab('shop');
    } catch (e) { console.error(e); showInfo('Ошибка добавления.'); }
    finally { hideLoading(); }
}

// ── Добавить один ингредиент из его карточки ─────────────────────────────────

async function addIngredientToShoppingList(ingId) {
    await loadShoppingList();
    const ing     = (ingredients || []).find(i => i.id === ingId);
    if (!ing) return;
    const balance = getIngredientBalance(ingId) || 0;
    const daily   = avgDailyUsage(ingId);
    const toBuy   = daily > 0 ? Math.ceil((daily * 14) / 100) * 100 : 0;
    showLoading();
    try {
        await addToShoppingList(ingId, null, toBuy);
        await showInfo(`«${ing.name}» добавлен в список покупок.`);
    } finally { hideLoading(); }
}

// ── Галочка «куплено» ────────────────────────────────────────────────────────

async function toggleShopItem(id, isBought) {
    try {
        const { error } = await db.from('shopping_list').update({ is_bought: isBought }).eq('id', id);
        if (error) throw error;
        const row = _shoppingList.find(r => r.id === id);
        if (row) row.is_bought = isBought;
        renderShoppingList();
    } catch (e) { console.error(e); showInfo('Ошибка сохранения.'); }
}

// ── Изменить количество к покупке ────────────────────────────────────────────

async function updateShopItemQty(id, val) {
    const qty = parseFloat(val);
    if (isNaN(qty) || qty < 0) return;
    try {
        const { error } = await db.from('shopping_list').update({ quantity_to_buy: parseFloat(qty.toFixed(2)) }).eq('id', id);
        if (error) throw error;
        const row = _shoppingList.find(r => r.id === id);
        if (row) row.quantity_to_buy = qty;
    } catch (e) { console.error(e); }
}

// ── Удалить одну позицию ─────────────────────────────────────────────────────

async function removeShopItem(id) {
    try {
        const { error } = await db.from('shopping_list').delete().eq('id', id);
        if (error) throw error;
        _shoppingList = _shoppingList.filter(r => r.id !== id);
        renderShoppingList();
    } catch (e) { console.error(e); showInfo('Ошибка удаления.'); }
}

// ── Добавить строку из таблицы склада (кнопка «+») ───────────────────────────

async function addRowToShoppingList(ingId, sfId) {
    ingId = ingId ? Number(ingId) : null;
    sfId  = sfId  ? Number(sfId)  : null;
    let toBuy = 0;
    if (ingId) {
        const balance = getIngredientBalance(ingId) || 0;
        const daily   = avgDailyUsage(ingId);
        toBuy = daily > 0 ? Math.ceil((daily * 14) / 100) * 100 : 0;
    } else if (sfId) {
        const daily = avgDailySfUsage(sfId);
        toBuy = daily > 0 ? Math.ceil((daily * 14) / 100) * 100 : 0;
    }
    showLoading();
    try {
        await addToShoppingList(ingId, sfId, toBuy);
        // Перерендерить только таблицу склада чтобы кнопка сменилась на ✓
        await openInventoryModal();
    } finally { hideLoading(); }
}

// ── Поделиться списком покупок ───────────────────────────────────────────────

function shareShoppingList() {
    if (!_shoppingList.length) { showInfo('Список покупок пуст.'); return; }
    const UL = { g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' };

    let text = `Список покупок — ${currentOrgName || 'пекарня'}\n\n`;
    _shoppingList.forEach(row => {
        let name = '—', unit = '';
        if (row.ingredient_id) {
            const ing = (ingredients || []).find(i => i.id === row.ingredient_id);
            if (ing) { name = ing.name; unit = UL[ing.unit] || ing.unit; }
        } else if (row.semi_finished_id) {
            const sf = (semiFinished || []).find(s => s.id === row.semi_finished_id);
            if (sf) { name = sf.name; unit = UL[sf.unit] || sf.unit; }
        }
        const mark = row.is_bought ? '✅' : '☐';
        text += `${mark} ${name} — ${Number(row.quantity_to_buy).toFixed(2)} ${unit}\n`;
    });

    shareOrCopyText(text);
}

// ── Очистить весь список ─────────────────────────────────────────────────────

async function clearShoppingList() {
    if (!_shoppingList.length) { await showInfo('Список уже пуст.'); return; }
    const ok = await showConfirm(`Очистить весь список покупок (${_shoppingList.length} поз.)?`);
    if (!ok) return;
    showLoading();
    try {
        const ids = _shoppingList.map(r => r.id);
        const { error } = await db.from('shopping_list').delete().in('id', ids);
        if (error) throw error;
        _shoppingList = [];
        renderShoppingList();
    } catch (e) { console.error(e); showInfo('Ошибка очистки.'); }
    finally { hideLoading(); }
}
