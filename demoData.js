// ==================== ДЕМО-ДАННЫЕ ДЛЯ ЗНАКОМСТВА С ПРИЛОЖЕНИЕМ ====================
// Предлагаются на экране первого запуска (галочка "Показать пример").
// Набор: 6 клиентов, 12 ингредиентов, 2 полуфабриката с рецептами, 6 изделий с
// рецептами (часть использует полуфабрикаты), второй демо-сотрудник с урезанными
// правами (показать разницу ролей), ~35 заказов (сознательно меньше лимита бесплатного тарифа в 50 — оставляем тестеру запас попробовать создать заказ самому), размазанных от -5 месяцев до
// +3 дней (растущая нагрузка по месяцам — красиво смотрится на графике
// "по месяцам" в Статистике), оплаты (70% полностью / 20% частично / 10% без
// оплаты — видны просроченные), закупки сырья двумя партиями на ингредиент
// (давняя + недавний довоз, специально впритык для части ингредиентов — чтобы
// была видна жёлтая/красная зона в Аналитике склада), история цен (3 точки) и
// список покупок.
// Всё содержимое (названия клиентов/изделий/ингредиентов) — на языке, который
// был активен в момент создания демо-набора (currentLang): тот же принцип, что
// и для реальных данных пекарни — переводится интерфейс, а не контент. Служебные
// значения (order.status, inventory.type, stock_batches.source) остаются
// русскими техническими константами независимо от языка — так же, как и у
// реальных данных, они переводятся на лету через orderStatusLabel() и т.п.
// Все демо-записи помечаются is_demo = true — это позволяет потом убрать
// весь набор одной кнопкой в настройках, не трогая то, что ввёл сам пользователь
// (кроме второго демо-сотрудника — у employees нет своей is_demo колонки,
// он ищется по имени при удалении, см. clearDemoData).
// Зависит от: db (supabaseClient.js), currentOrgId (employees.js), currentLang (i18n.js).

const DEMO_CONTENT = {
    ru: {
        customers: ['Иван Иванов', 'Кафе «Ромашка»', 'Мария Петрова', 'Кофейня «Полночь»', 'Отель Švyturys', 'Ольга Кузнецова'],
        customerNote: 'Демо-клиент для примера',
        ingredients: {
            flour:    { name: 'Мука пшеничная',   unit: 'kg',  size: 1 },
            sugar:    { name: 'Сахар',             unit: 'kg',  size: 1 },
            butter:   { name: 'Масло сливочное',   unit: 'kg',  size: 1 },
            eggs:     { name: 'Яйца',              unit: 'pcs', size: 10 },
            milk:     { name: 'Молоко',            unit: 'l',   size: 1 },
            vanilla:  { name: 'Ваниль (экстракт)', unit: 'l',   size: 1 },
            choco:    { name: 'Шоколад тёмный',    unit: 'kg',  size: 1 },
            baking:   { name: 'Разрыхлитель',      unit: 'kg',  size: 1 },
            salt:     { name: 'Соль',              unit: 'kg',  size: 1 },
            walnuts:  { name: 'Орехи грецкие',     unit: 'kg',  size: 1 },
            cinnamon: { name: 'Корица молотая',    unit: 'kg',  size: 0.5 },
            banana:   { name: 'Банан (пюре)',      unit: 'kg',  size: 1 }
        },
        semiFinished: {
            cream:   { name: 'Крем масляный',      unit: 'kg', batch_size: 0.75, other_costs: 0.30 },
            ganache: { name: 'Шоколадный ганаш',   unit: 'kg', batch_size: 0.5,  other_costs: 0.20 }
        },
        products: {
            croissant:   { name: 'Круассан',            price: 2.50, unit: 'pcs', batch_size: 10, other_costs: 1.00 },
            honeycake:   { name: 'Медовик (кусок)',     price: 3.20, unit: 'pcs', batch_size: 8,  other_costs: 1.50 },
            chocoCake:   { name: 'Шоколадный кекс',     price: 4.50, unit: 'pcs', batch_size: 6,  other_costs: 1.20 },
            berryTart:   { name: 'Тарт с ягодами',      price: 5.00, unit: 'pcs', batch_size: 6,  other_costs: 1.80 },
            cinnamonBun: { name: 'Булочка с корицей',   price: 2.20, unit: 'pcs', batch_size: 12, other_costs: 0.80 },
            bananaBread: { name: 'Банановый хлеб',      price: 4.00, unit: 'pcs', batch_size: 4,  other_costs: 1.00 }
        },
        secondEmployeeName: 'Кондитер',
        orderNote: 'Демо-заказ для примера',
        purchaseNote: 'Демо: закупка сырья',
        consumeNote: 'Демо: списание в производство',
        productionNote: 'Демо: произведена партия',
        shoppingNote: 'Демо: пополнить запас'
    },
    en: {
        customers: ['Emma Carter', '"Sunrise" Café', 'Daniel Brooks', '"The Coffee Nook"', 'Riverside Hotel', 'Olivia Bennett'],
        customerNote: 'Demo customer example',
        ingredients: {
            flour:    { name: 'Wheat flour',      unit: 'kg',  size: 1 },
            sugar:    { name: 'Sugar',             unit: 'kg',  size: 1 },
            butter:   { name: 'Butter',            unit: 'kg',  size: 1 },
            eggs:     { name: 'Eggs',              unit: 'pcs', size: 10 },
            milk:     { name: 'Milk',              unit: 'l',   size: 1 },
            vanilla:  { name: 'Vanilla extract',   unit: 'l',   size: 1 },
            choco:    { name: 'Dark chocolate',    unit: 'kg',  size: 1 },
            baking:   { name: 'Baking powder',     unit: 'kg',  size: 1 },
            salt:     { name: 'Salt',              unit: 'kg',  size: 1 },
            walnuts:  { name: 'Walnuts',           unit: 'kg',  size: 1 },
            cinnamon: { name: 'Ground cinnamon',   unit: 'kg',  size: 0.5 },
            banana:   { name: 'Banana (mashed)',   unit: 'kg',  size: 1 }
        },
        semiFinished: {
            cream:   { name: 'Buttercream',        unit: 'kg', batch_size: 0.75, other_costs: 0.30 },
            ganache: { name: 'Chocolate ganache',  unit: 'kg', batch_size: 0.5,  other_costs: 0.20 }
        },
        products: {
            croissant:   { name: 'Croissant',           price: 2.50, unit: 'pcs', batch_size: 10, other_costs: 1.00 },
            honeycake:   { name: 'Honey cake (slice)',  price: 3.20, unit: 'pcs', batch_size: 8,  other_costs: 1.50 },
            chocoCake:   { name: 'Chocolate cake',      price: 4.50, unit: 'pcs', batch_size: 6,  other_costs: 1.20 },
            berryTart:   { name: 'Berry tart',          price: 5.00, unit: 'pcs', batch_size: 6,  other_costs: 1.80 },
            cinnamonBun: { name: 'Cinnamon bun',        price: 2.20, unit: 'pcs', batch_size: 12, other_costs: 0.80 },
            bananaBread: { name: 'Banana bread',        price: 4.00, unit: 'pcs', batch_size: 4,  other_costs: 1.00 }
        },
        secondEmployeeName: 'Pastry Chef',
        orderNote: 'Demo order example',
        purchaseNote: 'Demo: raw material purchase',
        consumeNote: 'Demo: consumed in production',
        productionNote: 'Demo: batch produced',
        shoppingNote: 'Demo: restock needed'
    }
};

// Базовая (текущая) цена ингредиента — одна и та же независимо от языка,
// это цифры, а не текст.
const DEMO_ING_BASE_PRICE = {
    flour: 1.20, sugar: 1.50, butter: 4.00, eggs: 3.00, milk: 1.10, vanilla: 18.00,
    choco: 9.50, baking: 6.00, salt: 0.80, walnuts: 12.00, cinnamon: 15.00, banana: 2.20
};

// Рецепты полуфабрикатов и изделий — ключи ингредиентов/п/ф не зависят от языка.
const DEMO_SF_RECIPES = {
    cream:   [{ ing: 'butter', qty: 0.5 }, { ing: 'sugar', qty: 0.3 }],
    ganache: [{ ing: 'choco',  qty: 0.3 }, { ing: 'butter', qty: 0.15 }]
};

const DEMO_PRODUCT_RECIPES = {
    croissant:   [{ ing: 'flour', qty: 0.5 }, { ing: 'butter', qty: 0.3 }, { ing: 'sugar', qty: 0.05 }, { ing: 'eggs', qty: 2 }],
    honeycake:   [{ ing: 'flour', qty: 0.4 }, { ing: 'sugar', qty: 0.3 }, { ing: 'eggs', qty: 4 }, { sf: 'cream', qty: 0.2 }],
    chocoCake:   [{ ing: 'flour', qty: 0.3 }, { ing: 'sugar', qty: 0.2 }, { ing: 'eggs', qty: 3 }, { ing: 'milk', qty: 0.1 }, { ing: 'baking', qty: 0.01 }, { sf: 'ganache', qty: 0.1 }],
    berryTart:   [{ ing: 'flour', qty: 0.25 }, { ing: 'butter', qty: 0.15 }, { ing: 'sugar', qty: 0.1 }, { ing: 'eggs', qty: 1 }, { ing: 'walnuts', qty: 0.05 }, { sf: 'ganache', qty: 0.05 }],
    cinnamonBun: [{ ing: 'flour', qty: 0.6 }, { ing: 'sugar', qty: 0.15 }, { ing: 'butter', qty: 0.2 }, { ing: 'eggs', qty: 2 }, { ing: 'milk', qty: 0.2 }, { ing: 'cinnamon', qty: 0.05 }, { ing: 'baking', qty: 0.01 }],
    bananaBread: [{ ing: 'flour', qty: 0.35 }, { ing: 'sugar', qty: 0.15 }, { ing: 'butter', qty: 0.1 }, { ing: 'eggs', qty: 2 }, { ing: 'banana', qty: 0.4 }, { ing: 'baking', qty: 0.015 }]
};

// Ингредиенты, которые специально закупаются впритык к расходу — чтобы на
// экране "Аналитика склада" сразу было видно жёлтую/красную зону и позицию
// в списке покупок, а не только зелёные "всего достаточно".
const DEMO_LOW_STOCK_KEYS = ['vanilla', 'walnuts', 'cinnamon'];

// Дата в формате YYYY-MM-DD со смещением от сегодня (используем общий помощник
// из helpers.js, если он доступен, иначе считаем сами — на случай другого
// порядка загрузки файлов).
function demoDateStr(offsetDays) {
    if (typeof getLocalDateStr === 'function') return getLocalDateStr(offsetDays);
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

// План заказов: растущая нагрузка по месяцам (от -5 до -1, "выполнен"), чтобы
// график "по месяцам" в Статистике выглядел как естественный рост, а не ровные
// столбики; последняя неделя — смесь "в работе"/"выполнен"; ближайшие 3 дня —
// "принят" (заказы в ожидании, ещё не расходуют сырьё).
function demoOrderPlan() {
    const plan = [];
    const monthlyCounts = [3, 4, 5, 6, 7]; // от самого дальнего к ближнему завершённому месяцу — суммарно с последней неделей и будущими держим общий итог заметно ниже лимита в 50 заказов бесплатного тарифа, чтобы у тестера остался запас попробовать создать заказ самому
    monthlyCounts.forEach((count, idx) => {
        const monthsAgo = monthlyCounts.length - idx; // 5,4,3,2,1
        for (let i = 0; i < count; i++) {
            const dayInMonth = Math.floor(Math.random() * 28);
            const offset = -(monthsAgo * 30) + dayInMonth;
            plan.push({ offset, status: 'выполнен' });
        }
    });
    for (let i = 6; i >= 1; i--) {
        plan.push({ offset: -i, status: i <= 2 ? 'в работе' : 'выполнен' });
    }
    plan.push({ offset: 0, status: 'в работе' });
    [1, 2, 3].forEach(offset => plan.push({ offset, status: 'принят' }));
    return plan;
}

async function createDemoData(orgId, employeeId) {
    const lang = (typeof currentLang !== 'undefined' && currentLang === 'en') ? 'en' : 'ru';
    const C = DEMO_CONTENT[lang];

    // ---------- Клиенты ----------
    const { data: customersData, error: custErr } = await db.from('customers').insert(
        C.customers.map(name => ({ org_id: orgId, name, contact: null, discount: 0, vat_exempt: false, notes: C.customerNote, is_demo: true }))
    ).select();
    if (custErr) throw custErr;

    // ---------- Ингредиенты ----------
    const ingKeys = Object.keys(C.ingredients);
    const { data: ingData, error: ingErr } = await db.from('ingredients').insert(
        ingKeys.map(key => ({
            org_id: orgId, name: C.ingredients[key].name, unit: C.ingredients[key].unit,
            package_size: C.ingredients[key].size, package_price: DEMO_ING_BASE_PRICE[key], is_demo: true
        }))
    ).select();
    if (ingErr) throw ingErr;
    const ingByKey = {};
    ingKeys.forEach(key => { ingByKey[key] = ingData.find(i => i.name === C.ingredients[key].name).id; });

    // История цен — 3 точки за последние ~4.5 месяца, лёгкий рост к текущей цене.
    const priceHistoryRows = [];
    ingKeys.forEach(key => {
        const base = DEMO_ING_BASE_PRICE[key];
        [[-140, 0.85], [-70, 0.93], [-14, 1.0]].forEach(([offset, factor]) => {
            priceHistoryRows.push({
                org_id: orgId, ingredient_id: ingByKey[key],
                package_price: parseFloat((base * factor).toFixed(2)),
                package_size: C.ingredients[key].size,
                valid_from: demoDateStr(offset)
            });
        });
    });
    const { error: phErr } = await db.from('ingredient_price_history').insert(priceHistoryRows);
    if (phErr) throw phErr;

    // ---------- Полуфабрикаты ----------
    const sfKeys = Object.keys(C.semiFinished);
    const { data: sfData, error: sfErr } = await db.from('semi_finished').insert(
        sfKeys.map(key => ({ org_id: orgId, name: C.semiFinished[key].name, unit: C.semiFinished[key].unit, batch_size: C.semiFinished[key].batch_size, other_costs: C.semiFinished[key].other_costs, recipe_confirmed: true, track_stock: true, is_demo: true }))
    ).select();
    if (sfErr) throw sfErr;
    const sfByKey = {};
    sfKeys.forEach(key => { sfByKey[key] = sfData.find(s => s.name === C.semiFinished[key].name).id; });

    const sfRiRows = [];
    sfKeys.forEach(key => {
        DEMO_SF_RECIPES[key].forEach(r => sfRiRows.push({ org_id: orgId, semi_finished_id: sfByKey[key], ingredient_id: ingByKey[r.ing], quantity: r.qty }));
    });
    const { error: sfRiErr } = await db.from('semi_finished_ingredients').insert(sfRiRows);
    if (sfRiErr) throw sfRiErr;

    // ---------- Изделия ----------
    const prodKeys = Object.keys(C.products);
    const { data: prodData, error: prodErr } = await db.from('products').insert(
        prodKeys.map(key => ({ org_id: orgId, name: C.products[key].name, price: C.products[key].price, unit: C.products[key].unit, batch_size: C.products[key].batch_size, other_costs: C.products[key].other_costs, recipe_confirmed: true, track_stock: true, is_demo: true }))
    ).select();
    if (prodErr) throw prodErr;
    const prodByKey = {};
    prodKeys.forEach(key => { prodByKey[key] = prodData.find(p => p.name === C.products[key].name).id; });

    const riRows = [];
    prodKeys.forEach(key => {
        DEMO_PRODUCT_RECIPES[key].forEach(r => {
            riRows.push({
                org_id: orgId, product_id: prodByKey[key],
                ingredient_id: r.ing ? ingByKey[r.ing] : null,
                semi_finished_id: r.sf ? sfByKey[r.sf] : null,
                quantity: r.qty
            });
        });
    });
    const { error: riErr } = await db.from('product_ingredients').insert(riRows);
    if (riErr) throw riErr;

    // ---------- Второй демо-сотрудник (урезанные права — показать разницу ролей) ----------
    await db.from('employees').insert({
        org_id: orgId, name: C.secondEmployeeName, is_owner: false,
        can_view_costs: false, can_delete: false, can_manage_inventory: true,
        can_view_reports: false, can_manage_team: false, user_id: null
    });

    // ---------- Заказы ----------
    const plan = demoOrderPlan();
    const allCreatedItems = []; // { id, key, quantity } — для снимка себестоимости
    const ingConsumption = {};  // ключ ингредиента -> суммарный расход "напрямую" через заказы
    const sfConsumption = {};   // ключ п/ф -> суммарный расход через заказы

    for (const o of plan) {
      try {
        const orderDate = demoDateStr(o.offset);
        const dueDate = demoDateStr(o.offset + 3);
        const customer = customersData[Math.floor(Math.random() * customersData.length)];
        const itemCount = 1 + Math.floor(Math.random() * 2); // 1-2 позиции
        const chosenKeys = [];
        for (let i = 0; i < itemCount; i++) {
            const key = prodKeys[Math.floor(Math.random() * prodKeys.length)];
            if (!chosenKeys.includes(key)) chosenKeys.push(key);
        }

        const { data: orderNumberData, error: numErr } = await db.rpc('next_order_number', { p_org_id: orgId });
        if (numErr) throw numErr;
        const { data: orderData, error: orderErr } = await db.from('orders').insert({
            org_id: orgId, customer_id: customer.id, order_date: orderDate, due_date: dueDate,
            status: o.status, discount: 0, vat_exempt: false, employee_id: employeeId || null,
            order_number: orderNumberData, notes: C.orderNote, is_demo: true
        }).select().single();
        if (orderErr) throw orderErr;

        const itemsPayload = chosenKeys.map(key => ({
            org_id: orgId, order_id: orderData.id, product_id: prodByKey[key],
            quantity: 1 + Math.floor(Math.random() * 6), price: C.products[key].price
        }));
        const { data: itemsData, error: itemsErr } = await db.from('order_items').insert(itemsPayload).select();
        if (itemsErr) throw itemsErr;

        itemsData.forEach((it, idx) => {
            const key = chosenKeys[idx];
            allCreatedItems.push({ id: it.id, key, quantity: Number(it.quantity) });
            // Расход в товар засчитываем только для заказов, которые реально
            // произведены (в работе/выполнен) — будущие "принят" ещё не готовились.
            if (o.status !== 'принят') {
                DEMO_PRODUCT_RECIPES[key].forEach(r => {
                    const factor = Number(it.quantity) / C.products[key].batch_size;
                    if (r.ing) ingConsumption[r.ing] = (ingConsumption[r.ing] || 0) + r.qty * factor;
                    if (r.sf) sfConsumption[r.sf] = (sfConsumption[r.sf] || 0) + r.qty * factor;
                });
            }
        });

        // Оплата (только для завершённых заказов): 70% — полностью, 20% —
        // частично (виден остаток), 10% — вообще без оплаты (при due_date в
        // прошлом это и создаёт "просрочен платёж" на карточке заказа).
        if (o.status === 'выполнен') {
            try {
                const total = itemsPayload.reduce((s, it) => s + it.price * it.quantity, 0);
                const roll = Math.random();
                if (roll < 0.7) {
                    await db.from('order_payments').insert({ org_id: orgId, order_id: orderData.id, amount: parseFloat(total.toFixed(2)), method: 'cash', paid_at: orderDate, note: null });
                } else if (roll < 0.9) {
                    const partial = parseFloat((total * (0.3 + Math.random() * 0.4)).toFixed(2));
                    await db.from('order_payments').insert({ org_id: orgId, order_id: orderData.id, amount: partial, method: 'transfer', paid_at: orderDate, note: null });
                }
                // остальные 10% — без единой оплаты
            } catch (payErr) {
                console.error('Демо: не удалось создать оплату для заказа', orderData.id, payErr);
            }
        }
      } catch (orderLoopErr) {
        // Один неудачный заказ (сеть/таймаут) — пропускаем и идём дальше,
        // не обрывая создание остальных заказов и всего, что после них
        // (склад, п/ф, список покупок, снимок себестоимости).
        console.error('Демо: не удалось создать один из заказов, продолжаю со следующим', orderLoopErr);
      }
    }

    // ---------- Сколько полуфабрикатов нужно произвести (считаем ДО закупок сырья,
    // т.к. само производство крема/ганаша тоже расходует муку/масло/шоколад и
    // это должно попасть в объём закупки, а не только прямой расход по заказам) ----------
    const sfProducedQty = {};
    sfKeys.forEach(key => {
        const consumed = sfConsumption[key] || 0;
        const produced = Math.max(consumed * 1.4, consumed + 0.3, 0.5);
        sfProducedQty[key] = produced;
        DEMO_SF_RECIPES[key].forEach(r => {
            ingConsumption[r.ing] = (ingConsumption[r.ing] || 0) + r.qty * (produced / C.semiFinished[key].batch_size);
        });
    });

    // ---------- Закупки сырья + партии (FIFO) ----------
    // Каждый ингредиент закупается двумя партиями: "давняя" (~4 месяца назад,
    // 55% объёма) и "недавний довоз" (~18 дней назад, 45%). Для
    // DEMO_LOW_STOCK_KEYS суммарная закупка берётся впритык к расходу (×1.05) —
    // специально создаёт жёлтую/красную зону в Аналитике склада и позицию в
    // списке покупок. Остальные ингредиенты закупаются с запасом (×1.8) — зелёная
    // зона. Списание партий — строго от старой к новой (тот же принцип FIFO, что
    // и в реальном приложении, см. batches.js/consumeFromBatches).
    const invRows = [];
    const batchRows = [];
    ingKeys.forEach(key => {
        const consumed = ingConsumption[key] || 0;
        const isLow = DEMO_LOW_STOCK_KEYS.includes(key);
        const totalPurchased = Math.max(consumed * (isLow ? 1.05 : 1.8), 0.5);
        const unitPrice = DEMO_ING_BASE_PRICE[key];
        const purchases = [
            { offset: -120, qty: totalPurchased * 0.55 },
            { offset: -18,  qty: totalPurchased * 0.45 }
        ];

        let remainingToConsume = consumed;
        purchases.forEach(p => {
            const consumedFromThisBatch = Math.min(remainingToConsume, p.qty);
            remainingToConsume -= consumedFromThisBatch;
            invRows.push({ org_id: orgId, ingredient_id: ingByKey[key], type: 'приход', quantity: parseFloat(p.qty.toFixed(3)), notes: C.purchaseNote, created_at: new Date(Date.now() + p.offset * 86400000).toISOString() });
            batchRows.push({
                org_id: orgId, item_type: 'ingredient', ingredient_id: ingByKey[key], semi_finished_id: null,
                unit_price: unitPrice, qty_original: parseFloat(p.qty.toFixed(3)),
                qty_remaining: parseFloat((p.qty - consumedFromThisBatch).toFixed(3)),
                source: 'приход', notes: C.purchaseNote,
                created_at: new Date(Date.now() + p.offset * 86400000).toISOString()
            });
        });
        if (consumed > 0) {
            invRows.push({ org_id: orgId, ingredient_id: ingByKey[key], type: 'расход', quantity: parseFloat(consumed.toFixed(3)), notes: C.consumeNote, created_at: new Date(Date.now() - 5 * 86400000).toISOString() });
        }
    });
    const { error: invErr } = await db.from('inventory').insert(invRows);
    if (invErr) console.error('Демо: не удалось создать приход/расход сырья (склад останется пустым)', invErr);
    const { error: batchErr } = await db.from('stock_batches').insert(batchRows);
    if (batchErr) console.error('Демо: не удалось создать партии сырья (FIFO-себестоимость будет недоступна)', batchErr);

    // ---------- Производство и расход полуфабрикатов ----------
    const sfInvRows = [];
    const sfBatchRows = [];
    sfKeys.forEach(key => {
        const consumed = sfConsumption[key] || 0;
        const produced = sfProducedQty[key];
        const unitCost = C.semiFinished[key].other_costs + DEMO_SF_RECIPES[key].reduce((s, r) => s + DEMO_ING_BASE_PRICE[r.ing] * r.qty, 0) / C.semiFinished[key].batch_size;
        sfInvRows.push({ org_id: orgId, semi_finished_id: sfByKey[key], type: 'приход', quantity: parseFloat(produced.toFixed(3)), notes: `${C.productionNote} ${demoDateStr(-10)}`, created_at: new Date(Date.now() - 10 * 86400000).toISOString() });
        sfBatchRows.push({
            org_id: orgId, item_type: 'semi_finished', ingredient_id: null, semi_finished_id: sfByKey[key],
            unit_price: parseFloat(unitCost.toFixed(4)), qty_original: parseFloat(produced.toFixed(3)),
            qty_remaining: parseFloat(Math.max(produced - consumed, 0).toFixed(3)),
            source: 'производство', notes: C.productionNote, created_at: new Date(Date.now() - 10 * 86400000).toISOString()
        });
        if (consumed > 0) {
            sfInvRows.push({ org_id: orgId, semi_finished_id: sfByKey[key], type: 'расход', quantity: parseFloat(consumed.toFixed(3)), notes: C.consumeNote, created_at: new Date(Date.now() - 5 * 86400000).toISOString() });
        }
    });
    const { error: sfInvErr } = await db.from('inventory').insert(sfInvRows);
    if (sfInvErr) console.error('Демо: не удалось создать движения по п/ф', sfInvErr);
    const { error: sfBatchErr } = await db.from('stock_batches').insert(sfBatchRows);
    if (sfBatchErr) console.error('Демо: не удалось создать партии п/ф', sfBatchErr);

    // ---------- Список покупок: пара позиций из "тесных" ингредиентов ----------
    const shoppingRows = DEMO_LOW_STOCK_KEYS.slice(0, 2).map(key => ({
        org_id: orgId, ingredient_id: ingByKey[key], quantity_to_buy: 2, is_bought: false, notes: C.shoppingNote
    }));
    await db.from('shopping_list').insert(shoppingRows);

    // ---------- Снимок себестоимости для "Детализации" на каждой позиции демо-заказов —
    // без этого шага "Детализация себестоимости" будет недоступна для демо-заказов
    // (та же логика, что срабатывает при обычном создании позиции в приложении;
    // подгружаем свежие данные, чтобы у products/semiFinished были рецепты). ----------
    if (typeof loadAllData === 'function' && typeof saveOrderItemIngredients === 'function') {
        await loadAllData(true);
        for (const item of allCreatedItems) {
            try {
                const prod = products.find(p => p.id === prodByKey[item.key]);
                if (prod) await saveOrderItemIngredients(item.id, prod, item.quantity);
            } catch (snapErr) {
                console.error('Демо: не удалось сохранить снимок себестоимости для позиции', item.id, snapErr);
            }
        }
    }
}

// ВРЕМЕННО (для цикла тестирования Google Play, потом убрать вместе с кнопкой
// в index.html и ключами fill_demo_* в i18n.js): кнопка в настройках, которая
// позволяет заполнить пустую организацию демо-набором повторно, без создания
// нового тестового приглашения через Simple Hub каждый раз. Показывается
// только если организация по-настоящему пустая (ни одного клиента вообще,
// демо или нет) — чтобы её не увидел случайно реальный владелец пекарни.
async function refreshFillDemoDataVisibility() {
    const btn = document.getElementById('fillDemoDataBtn');
    if (!btn) return;
    try {
        const { count } = await db.from('customers').select('id', { count: 'exact', head: true }).eq('org_id', currentOrgId);
        btn.style.display = count ? 'none' : '';
    } catch (e) {
        console.error(e);
        btn.style.display = 'none';
    }
}

async function fillDemoDataFromSettings() {
    if (!currentEmployee) return;
    const ok = await showConfirm(t('fill_demo_confirm'));
    if (!ok) return;
    showLoading(t('fill_demo_loading'));
    try {
        await createDemoData(currentOrgId, currentEmployee.id);
        await loadAllData();
        await loadInventory();
        closeModal();
        await showInfo(t('fill_demo_success'));
    } catch (e) {
        console.error(e);
        showInfo(t('fill_demo_error') + (e && e.message ? e.message : String(e)));
    } finally {
        hideLoading();
    }
}

// из настроек, кнопка "Удалить демо-данные и начать заново".
// Порядок важен: сначала заказы (позиции + их снимок себестоимости + оплаты),
// потом изделия (и их рецепты), потом полуфабрикаты (рецепт + партии +
// складские движения), потом ингредиенты (история цен + партии + движения +
// список покупок), второй демо-сотрудник, и только в конце — клиенты.
async function clearDemoData() {
    showLoading(t('demo_deleting'));
    try {
        const { data: demoOrders } = await db.from('orders').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const orderIds = (demoOrders || []).map(o => o.id);
        if (orderIds.length) {
            const { data: demoItems } = await db.from('order_items').select('id').in('order_id', orderIds);
            const itemIds = (demoItems || []).map(i => i.id);
            if (itemIds.length) await db.from('order_item_ingredients').delete().in('order_item_id', itemIds);
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
            await db.from('stock_batches').delete().in('semi_finished_id', sfIds);
            await db.from('semi_finished').delete().in('id', sfIds);
        }

        const { data: demoIng } = await db.from('ingredients').select('id').eq('org_id', currentOrgId).eq('is_demo', true);
        const ingIds = (demoIng || []).map(i => i.id);
        if (ingIds.length) {
            await db.from('shopping_list').delete().in('ingredient_id', ingIds);
            await db.from('inventory').delete().in('ingredient_id', ingIds);
            await db.from('stock_batches').delete().in('ingredient_id', ingIds);
            await db.from('ingredient_price_history').delete().in('ingredient_id', ingIds);
            await db.from('ingredients').delete().in('id', ingIds);
        }

        // Второй демо-сотрудник — не имеет своей is_demo колонки, поэтому
        // находится по имени (оба языка) среди не-владельцев этой организации.
        const demoNames = [DEMO_CONTENT.ru.secondEmployeeName, DEMO_CONTENT.en.secondEmployeeName];
        await db.from('employees').delete().eq('org_id', currentOrgId).eq('is_owner', false).in('name', demoNames);

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
