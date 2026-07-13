// ==================== ДЕМО-ДАННЫЕ ДЛЯ ЗНАКОМСТВА С ПРИЛОЖЕНИЕМ ====================
// Предлагаются на экране первого запуска (галочка "Показать пример").
// Набор: 2 клиента (сознательно не увеличиваем — не создавать лишней нагрузки
// на лимиты), 10 ингредиентов, 2 полуфабриката с рецептами, 4 изделия с рецептами
// (часть использует полуфабрикаты), движения по складу (приход сырья +
// производство партий обоих полуфабрикатов) и 5 заказов на разные даты —
// специально подобраны так, чтобы сразу были видны все три статуса
// (принят / в работе / выполнен), а не только один.
// Все демо-записи помечаются is_demo = true — это позволяет потом убрать
// весь набор одной кнопкой в настройках, не трогая то, что ввёл сам пользователь.
// Зависит от: db (supabaseClient.js), currentOrgId (employees.js).

async function createDemoData(orgId, employeeId) {
    // Клиенты
    const { data: customersData, error: custErr } = await db.from('customers').insert([
        { org_id: orgId, name: 'Иван Иванов', contact: '+370 600 00000', discount: 0, vat_exempt: false, notes: 'Демо-клиент для примера', is_demo: true },
        { org_id: orgId, name: 'Кафе «Ромашка»', contact: 'info@romashka.lt', discount: 5, vat_exempt: false, notes: 'Демо-клиент для примера', is_demo: true }
    ]).select();
    if (custErr) throw custErr;

    // Ингредиенты
    const { data: ingData, error: ingErr } = await db.from('ingredients').insert([
        { org_id: orgId, name: 'Мука пшеничная', package_price: 1.20, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Сахар', package_price: 1.50, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Масло сливочное', package_price: 4.00, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Яйца', package_price: 3.00, package_size: 10, unit: 'pcs', is_demo: true },
        { org_id: orgId, name: 'Молоко', package_price: 1.10, package_size: 1, unit: 'l', is_demo: true },
        { org_id: orgId, name: 'Ваниль (экстракт)', package_price: 18.00, package_size: 1, unit: 'l', is_demo: true },
        { org_id: orgId, name: 'Шоколад тёмный', package_price: 9.50, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Разрыхлитель', package_price: 6.00, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Соль', package_price: 0.80, package_size: 1, unit: 'kg', is_demo: true },
        { org_id: orgId, name: 'Орехи грецкие', package_price: 12.00, package_size: 1, unit: 'kg', is_demo: true }
    ]).select();
    if (ingErr) throw ingErr;
    const flour   = ingData.find(i => i.name === 'Мука пшеничная').id;
    const sugar   = ingData.find(i => i.name === 'Сахар').id;
    const butter  = ingData.find(i => i.name === 'Масло сливочное').id;
    const eggs    = ingData.find(i => i.name === 'Яйца').id;
    const milk    = ingData.find(i => i.name === 'Молоко').id;
    const vanilla = ingData.find(i => i.name === 'Ваниль (экстракт)').id;
    const choco   = ingData.find(i => i.name === 'Шоколад тёмный').id;
    const baking  = ingData.find(i => i.name === 'Разрыхлитель').id;
    const salt    = ingData.find(i => i.name === 'Соль').id;
    const walnuts = ingData.find(i => i.name === 'Орехи грецкие').id;

    // Изделия
    const { data: prodData, error: prodErr } = await db.from('products').insert([
        { org_id: orgId, name: 'Круассан', price: 2.50, unit: 'pcs', batch_size: 10, other_costs: 1.00, is_demo: true },
        { org_id: orgId, name: 'Медовик (кусок)', price: 3.20, unit: 'pcs', batch_size: 8, other_costs: 1.50, is_demo: true },
        { org_id: orgId, name: 'Шоколадный кекс', price: 4.50, unit: 'pcs', batch_size: 6, other_costs: 1.20, is_demo: true },
        { org_id: orgId, name: 'Тарт с ягодами', price: 5.00, unit: 'pcs', batch_size: 6, other_costs: 1.80, is_demo: true }
    ]).select();
    if (prodErr) throw prodErr;
    const croissant = prodData.find(p => p.name === 'Круассан').id;
    const honeycake = prodData.find(p => p.name === 'Медовик (кусок)').id;
    const chocoCake = prodData.find(p => p.name === 'Шоколадный кекс').id;
    const berryTart = prodData.find(p => p.name === 'Тарт с ягодами').id;

    // Полуфабрикаты — крем (для "Медовика") и ганаш (для кекса и тарта)
    const { data: sfData, error: sfErr } = await db.from('semi_finished').insert([
        { org_id: orgId, name: 'Крем масляный', unit: 'kg', batch_size: 0.75, other_costs: 0.30, is_demo: true },
        { org_id: orgId, name: 'Шоколадный ганаш', unit: 'kg', batch_size: 0.5, other_costs: 0.20, is_demo: true }
    ]).select();
    if (sfErr) throw sfErr;
    const cream   = sfData.find(s => s.name === 'Крем масляный').id;
    const ganache = sfData.find(s => s.name === 'Шоколадный ганаш').id;

    // Рецепты полуфабрикатов
    const { error: sfRiErr } = await db.from('semi_finished_ingredients').insert([
        { org_id: orgId, semi_finished_id: cream, ingredient_id: butter, quantity: 0.5 },
        { org_id: orgId, semi_finished_id: cream, ingredient_id: sugar, quantity: 0.3 },
        { org_id: orgId, semi_finished_id: ganache, ingredient_id: choco, quantity: 0.3 },
        { org_id: orgId, semi_finished_id: ganache, ingredient_id: butter, quantity: 0.15 }
    ]);
    if (sfRiErr) throw sfRiErr;

    // Рецептура изделий (сырые ингредиенты + полуфабрикаты в разных сочетаниях)
    const { error: riErr } = await db.from('product_ingredients').insert([
        { org_id: orgId, product_id: croissant, ingredient_id: flour, semi_finished_id: null, quantity: 0.5 },
        { org_id: orgId, product_id: croissant, ingredient_id: butter, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: croissant, ingredient_id: sugar, semi_finished_id: null, quantity: 0.05 },
        { org_id: orgId, product_id: croissant, ingredient_id: eggs, semi_finished_id: null, quantity: 2 },
        { org_id: orgId, product_id: honeycake, ingredient_id: flour, semi_finished_id: null, quantity: 0.4 },
        { org_id: orgId, product_id: honeycake, ingredient_id: sugar, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: honeycake, ingredient_id: eggs, semi_finished_id: null, quantity: 4 },
        { org_id: orgId, product_id: honeycake, ingredient_id: null, semi_finished_id: cream, quantity: 0.2 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: flour, semi_finished_id: null, quantity: 0.3 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: sugar, semi_finished_id: null, quantity: 0.2 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: eggs, semi_finished_id: null, quantity: 3 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: milk, semi_finished_id: null, quantity: 0.1 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: baking, semi_finished_id: null, quantity: 0.01 },
        { org_id: orgId, product_id: chocoCake, ingredient_id: null, semi_finished_id: ganache, quantity: 0.1 },
        { org_id: orgId, product_id: berryTart, ingredient_id: flour, semi_finished_id: null, quantity: 0.25 },
        { org_id: orgId, product_id: berryTart, ingredient_id: butter, semi_finished_id: null, quantity: 0.15 },
        { org_id: orgId, product_id: berryTart, ingredient_id: sugar, semi_finished_id: null, quantity: 0.1 },
        { org_id: orgId, product_id: berryTart, ingredient_id: eggs, semi_finished_id: null, quantity: 1 },
        { org_id: orgId, product_id: berryTart, ingredient_id: walnuts, semi_finished_id: null, quantity: 0.05 },
        { org_id: orgId, product_id: berryTart, ingredient_id: null, semi_finished_id: ganache, quantity: 0.05 }
    ]);
    if (riErr) throw riErr;

    // Движения по складу: приход сырья + производство партий обоих полуфабрикатов
    const today = getLocalDateStr ? getLocalDateStr(0) : new Date().toISOString().split('T')[0];
    const { error: invErr } = await db.from('inventory').insert([
        { org_id: orgId, ingredient_id: flour, type: 'приход', quantity: 8, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: sugar, type: 'приход', quantity: 5, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: butter, type: 'приход', quantity: 4, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: eggs, type: 'приход', quantity: 40, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: milk, type: 'приход', quantity: 3, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: vanilla, type: 'приход', quantity: 0.5, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: choco, type: 'приход', quantity: 2, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: baking, type: 'приход', quantity: 0.3, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: salt, type: 'приход', quantity: 0.2, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: walnuts, type: 'приход', quantity: 1, notes: 'Демо: закупка сырья' },
        { org_id: orgId, ingredient_id: butter, type: 'расход', quantity: 0.5, notes: 'Демо: производство п/ф «Крем масляный»' },
        { org_id: orgId, ingredient_id: sugar, type: 'расход', quantity: 0.3, notes: 'Демо: производство п/ф «Крем масляный»' },
        { org_id: orgId, ingredient_id: choco, type: 'расход', quantity: 0.3, notes: 'Демо: производство п/ф «Шоколадный ганаш»' },
        { org_id: orgId, ingredient_id: butter, type: 'расход', quantity: 0.15, notes: 'Демо: производство п/ф «Шоколадный ганаш»' },
        { org_id: orgId, semi_finished_id: cream, type: 'приход', quantity: 0.7, notes: `Демо: произведена партия ${today}` },
        { org_id: orgId, semi_finished_id: ganache, type: 'приход', quantity: 0.4, notes: `Демо: произведена партия ${today}` }
    ]);
    if (invErr) throw invErr;

    // 5 заказов на разные даты — специально подобраны так, чтобы сразу были
    // видны все три статуса (принят / в работе / выполнен), а не только один.
    const ivan = customersData.find(c => c.name === 'Иван Иванов').id;
    const cafe = customersData.find(c => c.name === 'Кафе «Ромашка»').id;
    const demoOrders = [
        { offset: -5, status: 'выполнен', customer: ivan, items: [[croissant, 3, 2.50], [honeycake, 2, 3.20]] },
        { offset: -2, status: 'выполнен', customer: cafe, items: [[chocoCake, 4, 4.50]] },
        { offset: 0,  status: 'в работе', customer: ivan, items: [[berryTart, 2, 5.00], [croissant, 4, 2.50]] },
        { offset: 1,  status: 'принят',   customer: cafe, items: [[honeycake, 6, 3.20]] },
        { offset: 3,  status: 'принят',   customer: ivan, items: [[chocoCake, 2, 4.50], [berryTart, 1, 5.00]] }
    ];

    const allCreatedItems = [];
    for (const o of demoOrders) {
        const orderDate = getLocalDateStr ? getLocalDateStr(o.offset) : today;
        const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: orgId });
        if (numErr) throw numErr;
        const { data: orderData, error: orderErr } = await db.from('orders').insert({
            org_id: orgId, customer_id: o.customer, order_date: orderDate,
            status: o.status, discount: 0, vat_exempt: false, employee_id: employeeId || null,
            order_number: orderNumberData, notes: 'Демо-заказ для примера', is_demo: true
        }).select().single();
        if (orderErr) throw orderErr;

        const { data: itemsData, error: itemsErr } = await db.from('order_items').insert(
            o.items.map(([productId, quantity, price]) => ({
                org_id: orgId, order_id: orderData.id, product_id: productId, quantity, price
            }))
        ).select();
        if (itemsErr) throw itemsErr;
        allCreatedItems.push(...(itemsData || []));
    }

    // Снимок себестоимости для "Детализации" на каждой позиции демо-заказов —
    // без этого шага "Детализация себестоимости" будет недоступна для демо-заказов
    // (та же логика, что срабатывает при обычном создании позиции в приложении;
    // подгружаем свежие данные, чтобы у products/semiFinished были рецепты).
    if (typeof loadAllData === 'function' && typeof saveOrderItemIngredients === 'function') {
        await loadAllData(true);
        for (const item of allCreatedItems) {
            const prod = products.find(p => p.id === item.product_id);
            if (prod) await saveOrderItemIngredients(item.id, prod, Number(item.quantity));
        }
    }
}

// Полностью убирает демо-набор (и всё, что на него ссылается) — вызывается
// из настроек, кнопка "Удалить демо-данные и начать заново".
// Порядок важен: сначала заказы (и их позиции), потом изделия (и их рецепты),
// потом полуфабрикат (и его рецепт + складские движения по нему), потом
// ингредиенты (и их историю цен + складские движения), и только в конце — клиенты.
async function clearDemoData() {
    showLoading(t('demo_deleting'));
    try {
        const { data: demoOrders } = await db.from('orders').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const orderIds = (demoOrders || []).map(o => o.id);
        if (orderIds.length) {
            await db.from('order_items').delete().in('order_id', orderIds);
            await db.from('order_payments').delete().in('order_id', orderIds);
            await db.from('orders').delete().in('id', orderIds);
        }

        const { data: demoProducts } = await db.from('products').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const productIds = (demoProducts || []).map(p => p.id);
        if (productIds.length) {
            await db.from('product_ingredients').delete().in('product_id', productIds);
            await db.from('products').delete().in('id', productIds);
        }

        const { data: demoSf } = await db.from('semi_finished').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const sfIds = (demoSf || []).map(s => s.id);
        if (sfIds.length) {
            await db.from('semi_finished_ingredients').delete().in('semi_finished_id', sfIds);
            await db.from('inventory').delete().in('semi_finished_id', sfIds);
            await db.from('semi_finished').delete().in('id', sfIds);
        }

        const { data: demoIng } = await db.from('ingredients').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const ingIds = (demoIng || []).map(i => i.id);
        if (ingIds.length) {
            await db.from('inventory').delete().in('ingredient_id', ingIds);
            await db.from('ingredient_price_history').delete().in('ingredient_id', ingIds);
            await db.from('ingredients').delete().in('id', ingIds);
        }

        await db.from('customers').delete().eq('org_id', currentOrgId).eq('is_demo', true);

        hideLoading();
        closeModal();
        await loadAllData();
        await loadInventory();
        logActivity('auth', t('demo_activity_deleted'));
        await showInfo(t('demo_deleted_success'));
    } catch (e) {
        hideLoading();
        console.error(e);
        showInfo(t('demo_deleted_error'));
    }
}

// Кнопка в настройках: подтверждение + проверка, что демо-данные вообще есть.
async function confirmClearDemoData() {
    try {
        const { count } = await db.from('customers').select('id', { count: 'exact', head: true }).eq('org_id', currentOrgId).eq('is_demo', true);
        if (!count) { showInfo(t('demo_not_found')); return; }
    } catch (e) { console.error(e); }
    const ok = await showConfirm(t('demo_delete_confirm'));
    if (ok) await clearDemoData();
}

// Показывает кнопку "Удалить демо-данные" только если демо-данные реально ещё
// остались в этой организации — иначе пункт просто лишний шум в настройках
// для реального владельца пекарни, который уже месяцами ведёт бизнес в
// приложении. Управляет видимостью через inline style, не трогая класс
// "hidden" (им отдельно управляет система прав доступа perm-owner-only —
// см. employees.js), чтобы обе проверки не конфликтовали друг с другом.
async function refreshDeleteDemoDataVisibility() {
    const btn = document.getElementById('deleteDemoDataBtn');
    if (!btn) return;
    try {
        const { count } = await db.from('customers').select('id', { count: 'exact', head: true }).eq('org_id', currentOrgId).eq('is_demo', true);
        btn.style.display = count ? '' : 'none';
    } catch (e) {
        console.error(e);
        btn.style.display = 'none'; // при ошибке — безопаснее спрятать, чем показать зря
    }
}
