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
// Оплата НА САЙТЕ (Stripe, 24.10.2026): для пользователей, которые пришли НЕ из
// приложения Google Play (браузер, установленное с сайта приложение, iPhone).
// В приложении из Google Play (TWA) о сайте и внешней оплате НЕ упоминаем ни
// словом — только Google Play Billing (правила Google). См. isPlayApp() ниже.
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

// ── obfuscatedAccountId: связываем покупку с организацией на стороне Google ──
// Google Play Billing позволяет передать при покупке произвольный "obfuscated
// account id" — он потом возвращается в ЛЮБОМ ответе Play Developer API по
// текущему purchaseToken, включая RTDN-обработку продлений/отмен, даже если
// сам purchaseToken со временем меняется. Так серверная сторона (rtdn-handler)
// узнаёт orgId без своей таблицы соответствий "токен → организация".
//
// Формат — protobuf-сообщение PlayBillingAdditionalData:
//   message PlayBillingAdditionalData { string obfuscated_account_id = 1; }
// Кодируем вручную (без библиотек), как и JWT на сервере в verify-purchase —
// сообщение крайне простое: один string-field.
function _encodeVarint(n) {
    const bytes = [];
    while (n > 0x7f) {
        bytes.push((n & 0x7f) | 0x80);
        n >>>= 7;
    }
    bytes.push(n & 0x7f);
    return bytes;
}

function _encodeProtoStringField(fieldNumber, str) {
    const tag = (fieldNumber << 3) | 2; // wire type 2 = length-delimited
    const strBytes = Array.from(new TextEncoder().encode(str));
    const lenBytes = _encodeVarint(strBytes.length);
    return [tag, ...lenBytes, ...strBytes];
}

function buildBillingAdditionalData(orgId) {
    const bytes = _encodeProtoStringField(1, String(orgId));
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

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
// Настоящая проверка Play-приложения: сервис Digital Goods реально создаётся
// только внутри TWA из Google Play. Если создался — запоминаем флаг.
async function probePlayApp() {
    try {
        const svc = await getBillingService();
        if (svc) { try { sessionStorage.setItem('sb_play_app', '1'); } catch (e) { /* не страшно */ } }
    } catch (e) { /* не Play-приложение */ }
}

async function openPlanModal() {
    await probePlayApp();
    renderPlanModalCards();
    document.getElementById('planModal').style.display = 'flex';
    refreshPlanModalPrices();
    // Данные о подписке (источник оплаты, дата, отмена) — отдельным запросом;
    // после ответа перерисовываем карточки уже с кнопками и пояснениями.
    await loadBillingInfo();
    const modal = document.getElementById('planModal');
    if (modal && modal.style.display !== 'none') {
        renderPlanModalCards();
        refreshPlanModalPrices();
    }
}

// ==================== ОПЛАТА НА САЙТЕ (Stripe) ====================

// Данные о подписке организации (RPC get_billing_info): plan_source
// ('google_play' | 'stripe' | null), web_status, period_end, cancel_at_period_end.
let _billingInfo = null;

// Это приложение, установленное из Google Play (TWA)? Тогда никаких кнопок и текстов
// про оплату на сайте. Признаки: запуск из нашего пакета (referrer) либо наличие
// Digital Goods API. Результат запоминаем на время сеанса (sessionStorage), потому
// что referrer есть только у первой загрузки. Если ни один признак не сработал —
// считаем веб-пользователем (браузер / PWA / iPhone).
function isPlayApp() {
    try { if (sessionStorage.getItem('sb_play_app') === '1') return true; } catch (e) { /* без хранилища — по признакам ниже */ }
    const fromPlay = (document.referrer || '').startsWith('android-app://' + BILLING_PACKAGE_NAME);
    // Одного наличия window.getDigitalGoodsService мало (в обычном Chrome на Android
    // он тоже может быть) — настоящий сервис проверяет probePlayApp() ниже.
    const yes = fromPlay;
    if (yes) { try { sessionStorage.setItem('sb_play_app', '1'); } catch (e) { /* не страшно */ } }
    return yes;
}

// Менять тариф может владелец и сотрудник с правом управлять командой.
function canManagePlan() {
    return typeof hasPermission === 'function' && hasPermission('can_manage_team');
}

async function loadBillingInfo() {
    _billingInfo = null;
    if (typeof currentOrgId === 'undefined' || !currentOrgId) return;
    try {
        const { data, error } = await db.rpc('get_billing_info', { p_org_id: currentOrgId });
        if (!error && data) _billingInfo = data;
    } catch (e) { /* без данных — экран покажется в упрощённом виде */ }
}

function _billingDateLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const locale = { ru: 'ru-RU', uk: 'uk-UA', lt: 'lt-LT', en: 'en-GB' }[currentLang] || 'en-GB';
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Код ошибки из ответа Edge Function (supabase-js отдаёт Response в error.context).
async function _billingFnErrorCode(error) {
    try {
        if (error && error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            return (body && (body.code || body.error)) || null;
        }
    } catch (e) { /* тело не прочиталось */ }
    return null;
}

// Кнопка «Оплатить на сайте»: просим сервер создать страницу оплаты Stripe
// и переходим на неё. Тариф включится только после реальной оплаты (вебхук).
async function startWebCheckout(planKey) {
    if (isPlayApp()) return; // страховка: в приложении Google Play этой кнопки быть не должно
    const btn = document.getElementById(`planWebBtn_${planKey}`);
    const originalLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = t('plan_processing'); }
    const restore = () => { if (btn) { btn.disabled = false; btn.textContent = originalLabel; } };

    try {
        const { data, error } = await db.functions.invoke('create-checkout', {
            body: { orgId: currentOrgId, plan: planKey, returnUrl: location.origin + location.pathname }
        });
        if (error || !data || !data.url) {
            const code = await _billingFnErrorCode(error);
            if (code === 'ALREADY_GOOGLE_PLAY') {
                showInfo(t('plan_note_google_play'));
            } else if (code === 'ALREADY_SUBSCRIBED_WEB') {
                showInfo(t('plan_manage_note'));
            } else {
                showInfo(t('plan_purchase_error'));
            }
            await loadBillingInfo();
            renderPlanModalCards();
            return;
        }
        window.location.href = data.url;
    } catch (e) {
        showInfo(t('plan_purchase_error'));
        restore();
    }
}

// «Управление подпиской» / «Возобновить» / «Обновить способ оплаты» —
// портал Stripe (отмена, карта, смена тарифа).
async function openBillingPortal() {
    if (isPlayApp()) return;
    const btn = document.getElementById('planPortalBtn');
    const originalLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = t('plan_processing'); }
    try {
        const { data, error } = await db.functions.invoke('create-portal', {
            body: { orgId: currentOrgId, returnUrl: location.origin + location.pathname }
        });
        if (error || !data || !data.url) {
            showInfo(t('plan_purchase_error'));
            if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
            return;
        }
        window.location.href = data.url;
    } catch (e) {
        showInfo(t('plan_purchase_error'));
        if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
}

// Возврат со страницы оплаты Stripe: в адресе ?pay=success или ?pay=cancel.
// Убираем параметр из адреса сразу, а сообщение показываем, когда организация
// уже загружена. При success несколько секунд проверяем, включился ли тариф
// (вебхук приходит с небольшой задержкой).
(function initPayReturn() {
    let flag = null;
    try {
        const u = new URL(location.href);
        flag = u.searchParams.get('pay');
        if (flag) {
            u.searchParams.delete('pay');
            history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
        }
    } catch (e) { /* адрес не разобрался — пропускаем */ }
    if (flag !== 'success' && flag !== 'cancel') return;

    let waited = 0;
    const waitTimer = setInterval(() => {
        waited++;
        if (typeof currentOrgId === 'undefined' || !currentOrgId) {
            if (waited > 120) clearInterval(waitTimer);
            return;
        }
        clearInterval(waitTimer);
        handlePayReturn(flag);
    }, 1000);
})();

async function handlePayReturn(flag) {
    if (flag === 'cancel') { showInfo(t('plan_pay_cancelled')); return; }
    showInfo(t('plan_pay_pending'));
    for (let i = 0; i < 30; i++) {
        try {
            const { data } = await db.from('organizations').select('plan, plan_override').eq('id', currentOrgId).single();
            if (data) {
                const newPlan = data.plan_override || data.plan || 'free';
                if (newPlan !== 'free') {
                    currentOrgPlan = newPlan;
                    currentOrgPlanIsOverridden = !!data.plan_override;
                    if (typeof applyPlanGating === 'function') applyPlanGating();
                    if (typeof renderPlanInfo === 'function') renderPlanInfo();
                    showInfo(t('plan_pay_success'));
                    return;
                }
            }
        } catch (e) { /* повторим */ }
        await new Promise(r => setTimeout(r, 2000));
    }
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
        { key: 'plan_feat_staff', free: false, light: false, full: true },
        { key: 'plan_feat_push', free: false, light: false, full: true }
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

    const info = _billingInfo || {};
    const source = info.plan_source || null;            // 'google_play' | 'stripe' | null
    const playApp = isPlayApp();
    const canManage = canManagePlan();
    const overridden = (typeof currentOrgPlanIsOverridden !== 'undefined') && currentOrgPlanIsOverridden;
    const status = info.web_status || '';
    const payProblem = (status === 'past_due' || status === 'unpaid');
    const periodEnd = _billingDateLabel(info.period_end);

    // Пояснения над карточками
    let topHtml = '';
    if (!canManage) {
        topHtml = `<div style="background:#eef2ea;border:1px solid #d5ddcf;border-radius:10px;padding:8px 10px;font-size:12px;color:#4f6349;line-height:1.35;">${escapeHtml(t('plan_note_owner_only'))}</div>`;
    } else if (source === 'google_play' && !playApp) {
        topHtml = `<div style="background:#eef2ea;border:1px solid #d5ddcf;border-radius:10px;padding:8px 10px;font-size:12px;color:#4f6349;line-height:1.35;">${escapeHtml(t('plan_note_google_play'))}</div>`;
    } else if (source === 'stripe' && payProblem && !playApp) {
        topHtml = `<div style="background:#fdf0e3;border:1px solid #f0cfa5;border-radius:10px;padding:8px 10px;font-size:12px;color:#8a4b0f;line-height:1.35;">${escapeHtml(t('plan_past_due_warn'))}</div>`;
    }

    const cardsHtml = planCardConfig().map(card => {
        const isCurrent = card.key === current;
        const border = isCurrent ? '2px solid #7c9473' : '1px solid #e2ddd0';
        const bg = '#f4f1ea';

        let actionHtml = '';
        if (isCurrent) {
            actionHtml = `<span class="text-xs font-semibold px-3 py-1.5 rounded-full" style="background:#e3e8df; color:#5a6b52;">${escapeHtml(t('plan_current_badge'))}</span>`;
        } else if (card.sku && canManage && !overridden) {
            if (playApp) {
                // Приложение из Google Play: только Google Play Billing (как раньше).
                if (source !== 'stripe') {
                    actionHtml = `<button type="button" id="planBuyBtn_${card.key}" onclick="event.stopPropagation(); purchasePlan('${card.key}')" class="pill-btn text-xs px-3 py-1.5" disabled style="opacity:0.5;">${escapeHtml(t('plan_coming_soon'))}</button>`;
                }
            } else if (!source) {
                // Веб: оплата на сайте, только если подписки ещё нет.
                actionHtml = `<button type="button" id="planWebBtn_${card.key}" onclick="event.stopPropagation(); startWebCheckout('${card.key}')" class="pill-btn text-xs px-3 py-1.5">${escapeHtml(t('plan_pay_web_btn'))}</button>`;
            }
        }

        // Строка про срок — у текущей карточки, если тариф оплачен на сайте
        let untilHtml = '';
        if (isCurrent && source === 'stripe' && periodEnd && !payProblem) {
            if (info.cancel_at_period_end) {
                untilHtml = `<div class="text-xs mt-1" style="margin-left:19px; color:#8a4b0f;">${escapeHtml(t('plan_cancelled_until').replace('{date}', periodEnd))}</div>`;
            } else {
                untilHtml = `<div class="text-xs mt-1" style="margin-left:19px; color:#4f6349;">${escapeHtml(t('plan_renews_on').replace('{date}', periodEnd))}</div>`;
            }
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
                ${untilHtml}
                <div id="planFeatureRows_${card.key}" style="display:none; margin-left:19px; margin-top:8px; padding-top:8px; border-top:1px solid #ece7d9;">${planFeatureRowsHtml(card.key)}</div>
            </div>`;
    }).join('');

    // Блок под карточками (только веб, только у тех, кто может менять тариф)
    let bottomHtml = '';
    if (!playApp && canManage && !overridden) {
        if (source === 'stripe') {
            const btnLabel = info.cancel_at_period_end ? t('plan_resume_btn')
                : (payProblem ? t('plan_fix_payment_btn') : t('plan_manage_btn'));
            const note = (info.cancel_at_period_end && periodEnd)
                ? t('plan_after_cancel_note').replace('{date}', periodEnd)
                : t('plan_manage_note');
            bottomHtml = `
                <button type="button" id="planPortalBtn" onclick="openBillingPortal()" class="pill-btn w-full justify-center" style="padding:9px 12px; font-size:12px;">${escapeHtml(btnLabel)}</button>
                <div class="text-xs text-gray-500" style="margin-top:-4px;">${escapeHtml(note)}</div>`;
        } else if (!source) {
            bottomHtml = `<div class="text-xs text-gray-500">${escapeHtml(t('plan_web_price_note'))}</div>`;
        }
    }

    wrap.innerHTML = topHtml + cardsHtml + bottomHtml;
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
                data: { sku: product.sku, additionalData: buildBillingAdditionalData(currentOrgId) }
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


// ==================== КВОТА ЗАКАЗОВ БЕСПЛАТНОГО ТАРИФА ====================
// Числа считает сервер (RPC get_order_quota): живые заказы + удалённые сверх
// бесплатных удалений, лимит и порог напоминания лежат в platform_settings.
// Демо-заказы и черновики-призраки сервер учитывает по своим правилам — поэтому
// клиент НЕ считает заказы сам (иначе показывал бы 38 из 50 из-за демо-данных).
let _orderQuota = null;
let _orderQuotaTimer = null;

// Форма слова по числу: 'one' | 'few' | 'many'. Для каждого языка свои правила
// (ru/uk: 1, 2–4, 5+ с исключением 11–14; lt: 1, 2–9, остальное; en: 1 / не 1).
function pluralForm(n, lang) {
    n = Math.abs(Math.trunc(Number(n) || 0));
    const m10 = n % 10, m100 = n % 100;
    if (lang === 'ru' || lang === 'uk') {
        if (m10 === 1 && m100 !== 11) return 'one';
        if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return 'few';
        return 'many';
    }
    if (lang === 'lt') {
        if (m10 === 1 && m100 !== 11) return 'one';
        if (m10 >= 2 && m10 <= 9 && !(m100 >= 11 && m100 <= 19)) return 'few';
        return 'many';
    }
    return n === 1 ? 'one' : 'many';
}

// nWord(5, 'word_orders') → «заказов». Ключи: word_orders_one / _few / _many.
function nWord(n, baseKey) {
    return t(`${baseKey}_${pluralForm(n, currentLang)}`);
}

// Запрашивает у сервера актуальную квоту. Для платных тарифов не нужна.
async function refreshOrderQuota() {
    if (typeof db === 'undefined' || !currentOrgId) return null;
    if (currentOrgPlan !== 'free') {
        _orderQuota = null;
        if (typeof renderPlanInfo === 'function') renderPlanInfo();
        return null;
    }
    try {
        const { data, error } = await db.rpc('get_order_quota', { p_org_id: currentOrgId });
        if (error) throw error;
        _orderQuota = data || null;
    } catch (e) {
        console.error('refreshOrderQuota:', e);
    }
    if (typeof renderPlanInfo === 'function') renderPlanInfo();
    maybeShowOrderQuotaReminder();
    return _orderQuota;
}

// С задержкой и «склейкой» нескольких вызовов подряд — чтобы не дёргать сервер на каждый чих.
function scheduleRefreshOrderQuota() {
    clearTimeout(_orderQuotaTimer);
    _orderQuotaTimer = setTimeout(refreshOrderQuota, 600);
}

// Окно «лимит достигнут»: текст собирается здесь (с правильной формой слова
// для языка), а не приходит готовой фразой из базы.
async function showOrderLimitDialog(limit) {
    const lim = Number(limit) || (_orderQuota && _orderQuota.limit) || 50;
    const msg = t('quota_limit_reached')
        .replace('{n}', String(lim))
        .replace('{orders}', nWord(lim, 'word_orders'));
    const goToPlans = await showConfirm(msg, { ok: t('quota_open_plans'), cancel: t('quota_dialog_close') });
    if (goToPlans && typeof openPlanModal === 'function') openPlanModal();
}

// Строка в окне подтверждения удаления заказа: бесплатное это удаление или заказ продолжит
// занимать место в лимите. Только для подтверждённых не-демо заказов на Free-тарифе
// (черновики и демо на квоту не влияют).
function orderDeleteQuotaNote(order) {
    const q = _orderQuota;
    if (!q || !q.limited || !order || order.is_demo || !order.is_confirmed) return '';
    if (q.deletes_left > 0) {
        return t('quota_delete_note_left').replace('{n}', String(q.deletes_left)).replace('{m}', String(q.allowance));
    }
    return t('quota_delete_note_none');
}

// ==================== НАПОМИНАНИЕ О ПРИБЛИЖЕНИИ К ЛИМИТУ ====================
// Баннер появляется, когда занято >= warn_at (по умолчанию 40 из 50), и ещё раз на более
// «острых» отметках (limit-5 и limit-1). Не чаще раза в сутки на один уровень, закрывается
// крестиком или кнопкой. Не показывается, пока открыта карточка заказа или любое окно,
// и пока монетизация выключена (кроме организаций с ручной подменой тарифа).
function _quotaReminderLevel(q) {
    const levels = [q.warn_at, q.limit - 5, q.limit - 1]
        .filter(v => v > 0 && v < q.limit)
        .sort((a, b) => a - b)
        .filter((v, i, arr) => arr.indexOf(v) === i);
    let level = 0;
    levels.forEach(v => { if (q.used >= v) level = v; });
    return level;
}

function _isAnyModalOpen() {
    return Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'flex');
}

function maybeShowOrderQuotaReminder() {
    try {
        const q = _orderQuota;
        if (!q || !q.limited || q.used >= q.limit) return;
        if (typeof monetizationLive !== 'undefined' && !monetizationLive && !currentOrgPlanIsOverridden) return;
        if (document.getElementById('quotaBanner')) return;
        const detail = document.getElementById('orderDetail');
        if (detail && detail.classList.contains('active')) return;
        if (_isAnyModalOpen()) return;

        const level = _quotaReminderLevel(q);
        if (!level) return;

        const key = 'quotaReminder_' + currentOrgId;
        const today = (typeof getLocalDateStr === 'function') ? getLocalDateStr(0) : new Date().toISOString().slice(0, 10);
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { stored = null; }
        if (stored && stored.date === today && stored.level >= level) return;
        try { localStorage.setItem(key, JSON.stringify({ date: today, level })); } catch (e) { /* без хранилища просто покажем */ }

        const left = Math.max(q.limit - q.used, 0);
        const text = t('quota_banner_text')
            .replace('{used}', String(q.used))
            .replace('{limit}', String(q.limit))
            .replace('{left}', String(left))
            .replace('{orders}', nWord(left, 'word_orders'));

        const el = document.createElement('div');
        el.id = 'quotaBanner';
        el.style.cssText = 'position:fixed; left:12px; right:12px; bottom:92px; z-index:900; background:#fbf3df; border:1px solid #e6d3a1; ' +
            'border-radius:16px; padding:12px 14px; box-shadow:0 6px 18px rgba(60,58,52,0.18); font-size:13px; color:#5c4a1a; max-width:520px; margin:0 auto;';
        el.innerHTML =
            `<div style="margin-bottom:10px; line-height:1.35;">${escapeHtml(text)}</div>` +
            `<div style="display:flex; gap:8px;">` +
            `<button type="button" id="quotaBannerPlans" class="pill-btn text-xs px-3 py-1.5">${escapeHtml(t('quota_open_plans'))}</button>` +
            `<button type="button" id="quotaBannerClose" class="pill-btn text-xs px-3 py-1.5" style="background:#ece7d9; color:#6b6355;">${escapeHtml(t('quota_dialog_close'))}</button>` +
            `</div>`;
        document.body.appendChild(el);
        const close = () => { el.remove(); };
        document.getElementById('quotaBannerClose').addEventListener('click', close);
        document.getElementById('quotaBannerPlans').addEventListener('click', () => { close(); if (typeof openPlanModal === 'function') openPlanModal(); });
        setTimeout(close, 20000);
    } catch (e) {
        console.error('maybeShowOrderQuotaReminder:', e);
    }
}
