// billing.js — Google Play Billing для подписок Light/Full.
//
// ВАЖНО: этот файл подключён во ВСЕХ сборках (в т.ч. у текущих тестировщиков
// на старой сборке без флага playBilling), но это безопасно: Digital Goods API
// физически существует только внутри TWA-сборки, собранной с features.playBilling
// в twa-manifest.json (см. историю проекта — сборка v1.0.3.0+). У остальных
// пользователей window.getDigitalGoodsService просто не существует, поэтому
// кнопка покупки автоматически показывается как неактивная ("Скоро будет доступно"),
// а не ломается и не кидает ошибку.
//
// Серверная проверка покупки (Google Play Developer API, RTDN) — ОТДЕЛЬНЫЙ,
// ещё не реализованный шаг. Сейчас purchasePlan() только доводит пользователя
// до системного экрана оплаты Google и подтверждает получение purchaseToken —
// синхронизация organizations.plan в базе будет сделана позже.

const BILLING_PACKAGE_NAME = 'io.github.runawaychef.twa';
const BILLING_METHOD = 'https://play.google.com/billing';

// product_id → { key: тариф в organizations.plan }
const PLAN_PRODUCTS = {
    light: { sku: 'light_monthly', planValue: 'light' },
    full: { sku: 'full_monthly', planValue: 'full' }
};

let _digitalGoodsService = null;
let _digitalGoodsChecked = false;

// Возвращает сервис Digital Goods, если он доступен в этом окружении (только
// внутри TWA-сборки с включённым Play Billing), иначе null. Результат кешируется
// на время сессии — сам факт доступности API не меняется на лету.
async function getBillingService() {
    if (_digitalGoodsChecked) return _digitalGoodsService;
    _digitalGoodsChecked = true;
    if (!('getDigitalGoodsService' in window)) {
        _digitalGoodsService = null;
        return null;
    }
    try {
        _digitalGoodsService = await window.getDigitalGoodsService(BILLING_METHOD);
    } catch (e) {
        _digitalGoodsService = null;
    }
    return _digitalGoodsService;
}

// Открывает модалку тарифов — сначала рисует карточки со статичными ценами
// (мгновенно, не ждёт сети), затем, если Digital Goods API доступен, тихо
// обновляет цены на реальные из Google Play (могут отличаться по стране).
function openPlanModal() {
    renderPlanModalCards();
    document.getElementById('planModal').style.display = 'flex';
    refreshPlanModalPrices();
}

// Чек-лист фич по тарифам. included: true/false — используется для отрисовки
// галочки/крестика в развёрнутом виде карточки. Список соответствует
// согласованному ранее фич-гейтингу (Free/Light — core, Full — всё).
function planFeatureList() {
    return [
        { key: 'plan_feat_orders', free: true, light: true, full: true },
        { key: 'plan_feat_customers', free: true, light: true, full: true },
        { key: 'plan_feat_inventory', free: true, light: true, full: true },
        { key: 'plan_feat_unlimited_orders', free: false, light: true, full: true },
        { key: 'plan_feat_stats', free: false, light: false, full: true },
        { key: 'plan_feat_cost_profit', free: false, light: false, full: true },
        { key: 'plan_feat_charts_forecast', free: false, light: false, full: true },
        { key: 'plan_feat_staff', free: false, light: false, full: true }
    ];
}

function planCardConfig() {
    return [
        { key: 'free', name: t('plan_free_name'), price: t('plan_free_price'), desc: t('plan_free_desc'), sku: null },
        { key: 'light', name: t('plan_light_name'), price: t('plan_light_price'), desc: t('plan_light_desc'), sku: PLAN_PRODUCTS.light.sku },
        { key: 'full', name: t('plan_full_name'), price: t('plan_full_price'), desc: t('plan_full_desc'), sku: PLAN_PRODUCTS.full.sku }
    ];
}

function planFeatureRowsHtml(planKey) {
    return planFeatureList().map(f => {
        const included = !!f[planKey];
        const icon = included
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="#7c9473" stroke-width="2.5" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="#c9c3b3" stroke-width="2.5" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
        const textColor = included ? '#4a4a42' : '#b3ada0';
        return `<div class="flex items-center gap-2" style="padding:3px 0;">${icon}<span class="text-xs" style="color:${textColor};">${escapeHtml(t(f.key))}</span></div>`;
    }).join('');
}

// Раскрывает/сворачивает чек-лист конкретной карточки (аккордеон — за раз открыта
// только одна). stopPropagation в кнопке покупки не даёт тапу по кнопке случайно
// свернуть карточку.
function togglePlanCard(planKey) {
    planCardConfig().forEach(card => {
        const rows = document.getElementById(`planFeatureRows_${card.key}`);
        const chevron = document.getElementById(`planChevron_${card.key}`);
        if (!rows) return;
        const shouldOpen = card.key === planKey && rows.style.display === 'none';
        rows.style.display = shouldOpen ? 'block' : 'none';
        if (chevron) chevron.style.transform = shouldOpen ? 'rotate(90deg)' : 'rotate(0deg)';
    });
}

function renderPlanModalCards() {
    const wrap = document.getElementById('planModalCards');
    if (!wrap) return;
    const current = currentOrgPlan || 'free';

    wrap.innerHTML = planCardConfig().map(card => {
        const isCurrent = card.key === current;
        const border = isCurrent ? '2px solid #7c9473' : '1px solid #e2ddd0';
        const bg = '#f4f1ea';

        let actionHtml;
        if (isCurrent) {
            actionHtml = `<span class="text-xs font-semibold px-3 py-1.5 rounded-full" style="background:#e3e8df; color:#5a6b52;">${escapeHtml(t('plan_current_badge'))}</span>`;
        } else if (card.sku) {
            actionHtml = `<button type="button" id="planBuyBtn_${card.key}" onclick="event.stopPropagation(); purchasePlan('${card.key}')" class="pill-btn text-xs px-3 py-1.5" disabled style="opacity:0.5;">${escapeHtml(t('plan_coming_soon'))}</button>`;
        } else {
            actionHtml = '';
        }

        return `
            <div onclick="togglePlanCard('${card.key}')" style="border:${border}; background:${bg}; border-radius:14px; padding:12px; cursor:pointer;">
                <div class="flex justify-between items-center mb-1">
                    <span class="flex items-center gap-1.5">
                        <svg id="planChevron_${card.key}" viewBox="0 0 24 24" fill="none" stroke="#9a9488" stroke-width="2" style="width:11px;height:11px;transition:transform 0.15s;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
                        <span class="text-sm font-semibold text-gray-800">${escapeHtml(card.name)}</span>
                    </span>
                    ${actionHtml}
                </div>
                <div class="text-xs font-medium mb-1" id="planPriceLabel_${card.key}" style="color:#7c9473; margin-left:19px;">${escapeHtml(card.price)}</div>
                <div class="text-xs text-gray-500" style="margin-left:19px;">${escapeHtml(card.desc)}</div>
                <div id="planFeatureRows_${card.key}" style="display:none; margin-left:19px; margin-top:8px; padding-top:8px; border-top:1px solid #ece7d9;">${planFeatureRowsHtml(card.key)}</div>
            </div>`;
    }).join('');
}

// Пытается заменить статичные цены на реальные из Google Play (если доступно).
// Не блокирует открытие модалки — цены обновляются "тихо" по готовности.
async function refreshPlanModalPrices() {
    const service = await getBillingService();
    if (!service) return; // API недоступен здесь — оставляем статичные цены, кнопки остаются disabled ("Скоро будет доступно")

    let details;
    try {
        details = await service.getDetails([PLAN_PRODUCTS.light.sku, PLAN_PRODUCTS.full.sku]);
    } catch (e) {
        return;
    }
    if (!details || !details.length) return;

    details.forEach(item => {
        const cardKey = Object.keys(PLAN_PRODUCTS).find(k => PLAN_PRODUCTS[k].sku === item.itemId);
        if (!cardKey) return;
        const priceLabel = document.getElementById(`planPriceLabel_${cardKey}`);
        if (priceLabel && item.price) {
            try {
                const formatted = new Intl.NumberFormat(undefined, { style: 'currency', currency: item.price.currency }).format(Number(item.price.value));
                priceLabel.textContent = formatted;
            } catch (e) { /* оставляем статичную цену при ошибке форматирования */ }
        }
        // Раз getDetails() успешно отдал товар — Play Billing реально доступен здесь,
        // разблокируем кнопку покупки.
        const btn = document.getElementById(`planBuyBtn_${cardKey}`);
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.textContent = t('plan_upgrade_btn');
        }
    });
}

// Запускает покупку тарифа через системный экран Google Play.
// planKey — 'light' | 'full'.
async function purchasePlan(planKey) {
    const product = PLAN_PRODUCTS[planKey];
    if (!product) return;

    const service = await getBillingService();
    if (!service) {
        showInfo(t('plan_coming_soon'));
        return;
    }

    const btn = document.getElementById(`planBuyBtn_${planKey}`);
    const originalLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = t('plan_processing'); }

    try {
        const request = new PaymentRequest(
            [{
                supportedMethods: BILLING_METHOD,
                data: { sku: product.sku }
            }],
            { total: { label: product.sku, amount: { currency: 'EUR', value: '0' } } }
        );

        const response = await request.show();
        await response.complete('success');

        // Отправляем purchaseToken на сервер для проверки через Google Play
        // Developer API и обновления тарифа в базе (Edge Function verify-purchase).
        const { data: verifyResult, error: verifyError } = await db.functions.invoke('verify-purchase', {
            body: {
                purchaseToken: response.details.purchaseToken,
                productId: product.sku,
                orgId: currentOrgId
            }
        });

        if (verifyError || !verifyResult || verifyResult.error) {
            // Покупка на стороне Google прошла, но проверка/синхронизация с базой
            // не удалась — не обманываем пользователя "успехом", честно сообщаем.
            showInfo(t('plan_purchase_error'));
            return;
        }

        currentOrgPlan = verifyResult.plan;
        showInfo(t('plan_purchase_success'));
        document.getElementById('planModal').style.display = 'none';
        if (typeof renderPlanInfo === 'function') renderPlanInfo();
    } catch (e) {
        // Пользователь мог просто закрыть системное окно оплаты — это не ошибка.
        if (e && e.name === 'AbortError') {
            showInfo(t('plan_purchase_cancelled'));
        } else {
            showInfo(t('plan_purchase_error'));
        }
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
}
