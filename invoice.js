// ==================== СЧЁТ / НАКЛАДНАЯ ПО ЗАКАЗУ ====================
// Формирует PDF-документ (счёт или накладная) на основе данных заказа,
// реквизитов пекарни (organizations) и реквизитов клиента (customers).
//
// Номер документа и даты (выставления/оплаты) "замораживаются" при первом
// формировании — сохраняются в orders.invoice_snapshot / delivery_note_snapshot
// (jsonb) и переиспользуются при повторных открытиях. Остальное содержимое
// (реквизиты сторон, позиции, суммы) пересчитывается заново при КАЖДОМ
// открытии предпросмотра из актуальных данных — документ всегда отражает
// текущее состояние заказа/реквизитов, а не то, что было в момент первого
// формирования. Полный пересчитанный снимок целиком перезаписывает
// сохранённый (кроме номера/дат, которые остаются прежними).
//
// Зависит от: db, currentOrgId, orders/customers (orders.js/customers.js),
// currentOrgVatRate (employees.js), formatDateDMY (dates.js),
// escapeHtml/showLoading/hideLoading/showInfo/updateChecked (helpers.js).

// CURRENCY_SYMBOLS — общая таблица, теперь в money.js (загружается раньше).

let _docPreview = null; // { docType, snapshot, lang } — состояние открытого предпросмотра

// Перевод для документа — в отличие от обычного t(key), берёт язык явным
// параметром, а не из текущих настроек интерфейса приложения. Нужно, чтобы
// пользователь мог сформировать документ на языке, отличном от того, на
// котором сейчас работает само приложение (например, интерфейс на русском,
// а документ для клиента — на английском).
function tDoc(key, lang) {
    const dict = I18N[lang] || I18N.en || {};
    if (dict[key] !== undefined) return dict[key];
    const base = I18N.en;
    if (base && base[key] !== undefined) return base[key];
    return key;
}

// Единица измерения на нужном языке документа (независимо от языка интерфейса).
function unitAbbrevDoc(code, lang) {
    const map = { g: 'unit_g', kg: 'unit_kg', ml: 'unit_ml', l: 'unit_l', pcs: 'unit_pcs', lb: 'unit_lb', oz: 'unit_oz', fl_oz: 'unit_fl_oz', gal: 'unit_gal' };
    return map[code] ? tDoc(map[code], lang) : (code || '');
}

function snapshotField(docType) {
    return docType === 'invoice' ? 'invoice_snapshot' : 'delivery_note_snapshot';
}

function openDocumentTypeModal() {
    document.getElementById('documentTypeModal').style.display = 'flex';
}

// Шаг 1: заказ → свежий снимок (тот же номер, если уже был выписан ранее) → предпросмотр.
// Снимок пересобирается заново при КАЖДОМ открытии — документ всегда отражает
// актуальные данные заказа на момент просмотра, а не то, что было в момент
// самого первого формирования (см. reuseNumber: номер при этом не меняется).
async function openOrderDocumentPreview(docType, langOverride) {
    closeModal();
    const order = orders.find(o => o.id === currentOrderId);
    if (!order) return;

    showLoading(t('inv_generating_document'));
    try {
        // Проверяем номер НАПРЯМУЮ в базе (а не в локальном массиве orders в
        // памяти приложения) — чтобы полностью исключить любую возможную
        // рассинхронизацию между тем, что реально сохранено на сервере, и
        // тем, что видит клиент в данный момент (устаревший кэш и т.п.).
        const field = snapshotField(docType);
        const { data: freshRow, error: freshErr } = await db.from('orders').select(field).eq('id', order.id).single();
        if (freshErr) throw freshErr;
        const existing = freshRow ? freshRow[field] : null;
        const snapshot = await freezeDocumentSnapshot(order, docType, existing);
        _docPreview = { docType, snapshot, lang: langOverride || currentLang };
        renderDocumentPreviewThumbnail();
        updateDocumentLangSwitcherUI();
        document.getElementById('orderDocumentModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
    }
}

// Переключает язык ТЕКУЩЕГО открытого документа независимо от языка
// интерфейса приложения — просто перерисовывает превью на новом языке,
// без похода в базу (снимок с данными уже загружен).
async function setDocumentLang(lang) {
    if (!_docPreview || (lang !== BASE_LANG && lang !== currentLang)) return;
    if (typeof ensureLangLoaded === 'function') await ensureLangLoaded(lang);
    _docPreview.lang = lang;
    renderDocumentPreviewThumbnail();
    updateDocumentLangSwitcherUI();
}

function updateDocumentLangSwitcherUI() {
    if (!_docPreview) return;
    if (typeof renderLangSwitcher === 'function') {
        renderLangSwitcher('docLangSwitchContainer', currentLang, _docPreview.lang, 'setDocumentLang');
    }
    const pickBtn = document.getElementById('docLangPickBtn');
    if (pickBtn) {
        pickBtn.classList.toggle('hidden', currentLang === BASE_LANG);
        const label = pickBtn.querySelector('.lang-pick-label');
        if (label && typeof LANG_META !== 'undefined') {
            const native = (LANG_META[currentLang] && LANG_META[currentLang].native) || currentLang.toUpperCase();
            label.textContent = `${native} · ${t('lang_pick_change_suffix')}`;
        }
    }

    // Кнопка "Сформировать Delivery Note" видна только когда открыт Invoice —
    // из накладной генерировать накладную же незачем.
    const dnBtn = document.getElementById('generateDeliveryNoteBtn');
    if (dnBtn) dnBtn.style.display = _docPreview.docType === 'invoice' ? 'block' : 'none';
}

// Собирает снимок данных из текущего состояния заказа/компании/клиента,
// присваивает номер (если ещё не присвоен) и сохраняет в orders.*_snapshot.
// ==================== СУММА ПРОПИСЬЮ ====================
// Конвертер целого числа в текст (кардинальные числительные) для RU и EN.
// Поддерживает величины до миллиардов — с большим запасом для нужд пекарни.

const _RU_ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const _RU_ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const _RU_TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const _RU_TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const _RU_HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

// Склонение слова по числу (1/2-4/5-20,0 и т.д.) — стандартное правило РЯ.
function ruPlural(n, one, few, many) {
    const n100 = n % 100;
    const n10 = n % 10;
    if (n100 >= 11 && n100 <= 14) return many;
    if (n10 === 1) return one;
    if (n10 >= 2 && n10 <= 4) return few;
    return many;
}

// Число от 0 до 999 словами (femenine=true — для групп типа "тысяча").
function ruTriplet(n, feminine) {
    const parts = [];
    const h = Math.floor(n / 100);
    const rest = n % 100;
    if (h) parts.push(_RU_HUNDREDS[h]);
    if (rest >= 10 && rest <= 19) {
        parts.push(_RU_TEENS[rest - 10]);
    } else {
        const t = Math.floor(rest / 10);
        const o = rest % 10;
        if (t) parts.push(_RU_TENS[t]);
        if (o) parts.push((feminine ? _RU_ONES_F : _RU_ONES_M)[o]);
    }
    return parts.join(' ');
}

function numberToWordsRu(n) {
    n = Math.round(n);
    if (n === 0) return 'ноль';
    const groups = [
        { div: 1000000000, one: 'миллиард', few: 'миллиарда', many: 'миллиардов', feminine: false },
        { div: 1000000, one: 'миллион', few: 'миллиона', many: 'миллионов', feminine: false },
        { div: 1000, one: 'тысяча', few: 'тысячи', many: 'тысяч', feminine: true },
    ];
    let remaining = n;
    const words = [];
    for (const g of groups) {
        const count = Math.floor(remaining / g.div);
        if (count > 0) {
            words.push(ruTriplet(count, g.feminine));
            words.push(ruPlural(count, g.one, g.few, g.many));
            remaining %= g.div;
        }
    }
    if (remaining > 0 || words.length === 0) words.push(ruTriplet(remaining, false));
    return words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

const _EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const _EN_TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const _EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enTriplet(n) {
    const parts = [];
    const h = Math.floor(n / 100);
    const rest = n % 100;
    if (h) parts.push(_EN_ONES[h] + ' hundred');
    if (rest >= 10 && rest <= 19) {
        parts.push(_EN_TEENS[rest - 10]);
    } else {
        const t = Math.floor(rest / 10);
        const o = rest % 10;
        if (t) parts.push(_EN_TENS[t] + (o ? ' ' + _EN_ONES[o] : ''));
        else if (o) parts.push(_EN_ONES[o]);
    }
    return parts.join(' ');
}

function numberToWordsEn(n) {
    n = Math.round(n);
    if (n === 0) return 'zero';
    const groups = [
        { div: 1000000000, word: 'billion' },
        { div: 1000000, word: 'million' },
        { div: 1000, word: 'thousand' },
    ];
    let remaining = n;
    const words = [];
    for (const g of groups) {
        const count = Math.floor(remaining / g.div);
        if (count > 0) {
            words.push(enTriplet(count) + ' ' + g.word);
            remaining %= g.div;
        }
    }
    if (remaining > 0 || words.length === 0) words.push(enTriplet(remaining));
    return words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// Название валюты для RU-варианта суммы прописью — только известные валюты
// склоняются по-русски (сейчас только EUR, основной кейс). Для остальных —
// используется сам код валюты как есть (без склонения), это безопасный
// fallback без риска грамматической ошибки.
const _RU_CURRENCY_MAJOR = { EUR: { one: 'евро', few: 'евро', many: 'евро' } };

// Собирает строку "Сумма прописью" на нужном языке.
// amount — число (например 142.30), currencyCode — 'EUR' и т.п., lang — 'ru'/'en'.
function amountInWords(amount, currencyCode, lang) {
    const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
    const intPart = Math.floor(rounded);
    const cents = Math.round((rounded - intPart) * 100);

    if (lang === 'ru') {
        const major = _RU_CURRENCY_MAJOR[currencyCode];
        const majorWord = major ? ruPlural(intPart, major.one, major.few, major.many) : currencyCode;
        const centsWord = ruPlural(cents, 'цент', 'цента', 'центов');
        return `${numberToWordsRu(intPart)} ${majorWord} и ${cents ? numberToWordsRu(cents) : 'ноль'} ${centsWord}`;
    }
    // EN — валюта всегда как код, чтобы не собирать словарь под все валюты сразу.
    const centsWordEn = 'cents';
    return `${numberToWordsEn(intPart)} ${currencyCode} and ${cents ? numberToWordsEn(cents) : 'zero'} ${centsWordEn}`;
}

async function freezeDocumentSnapshot(order, docType, existing) {
    const productIds = [...new Set((order.items || []).map(it => it.product_id).filter(Boolean))];
    const [{ data: org, error: orgErr }, { data: cust, error: custErr }, { data: prods, error: prodErr }] = await Promise.all([
        db.from('organizations').select('*').eq('id', currentOrgId).single(),
        order.customer_id
            ? db.from('customers').select('*').eq('id', order.customer_id).single()
            : Promise.resolve({ data: null, error: null }),
        productIds.length
            ? db.from('products').select('id, unit').in('id', productIds)
            : Promise.resolve({ data: [], error: null }),
    ]);
    if (orgErr) throw orgErr;
    if (custErr) throw custErr;
    if (prodErr) throw prodErr;
    const unitById = {};
    (prods || []).forEach(p => { unitById[p.id] = p.unit; });

    let number = existing ? existing.number : undefined;
    if (!number) {
        const rpcName = docType === 'invoice' ? 'get_next_invoice_number' : 'get_next_delivery_note_number';
        const { data, error } = await db.rpc(rpcName, { p_org_id: currentOrgId });
        if (error) throw error;
        number = data;
    }

    // Дата счёта и срок оплаты фиксируются ОДИН РАЗ при первом выставлении
    // документа и дальше переиспользуются вместе с номером — иначе при
    // каждом повторном открытии старого счёта дата "уезжала" бы на сегодня.
    let issueDate, dueDate;
    if (existing && existing.issueDate) {
        issueDate = existing.issueDate;
        dueDate = existing.dueDate;
    } else {
        const now = new Date();
        const termDays = (cust && cust.payment_term_days != null) ? Number(cust.payment_term_days) : 7;
        const due = new Date(now);
        due.setDate(due.getDate() + termDays);
        issueDate = now.toISOString().slice(0, 10);
        dueDate = due.toISOString().slice(0, 10);
    }

    const snapshot = {
        number,
        issueDate,
        dueDate,
        customerNameFallback: order.customer || '—',
        order: {
            items: (order.items || []).map(it => ({ product: it.product, quantity: it.quantity, price: it.price, unit: it.product_id ? (unitById[it.product_id] || null) : null })),
            discount: order.discount,
            vat_exempt: order.vat_exempt,
        },
        org: {
            name: org.name, legal_name: org.legal_name, entity_type: org.entity_type,
            personal_code: org.personal_code, reg_number: org.reg_number, vat_code: org.vat_code,
            address: org.address, phone: org.phone, email: org.email,
            bank_name: org.bank_name, bank_account: org.bank_account, bank_swift: org.bank_swift,
            director_name: org.director_name, director_position: org.director_position, currency_code: org.currency_code,
            country: org.country,
            logo_data_url: org.logo_data_url || null, logo_on_documents: !!org.logo_on_documents,
        },
        cust: cust ? {
            name: cust.name, entity_type: cust.entity_type, personal_code: cust.personal_code,
            reg_number: cust.reg_number, vat_code: cust.vat_code, address: cust.address, contact: cust.contact,
        } : null,
    };

    const field = snapshotField(docType);
    await updateChecked(db.from('orders').update({ [field]: snapshot }).eq('id', order.id));
    order[field] = snapshot;
    // Держим кэш мгновенного запуска (cache.js) в курсе присвоенного номера
    // немедленно — иначе при сворачивании приложения (Android часто выгружает
    // процесс из памяти) следующий запуск может подставить старый снимок без
    // этого номера, и следующее открытие документа "не увидит" его и создаст
    // новый вместо переиспользования.
    if (typeof saveAppSnapshot === 'function') saveAppSnapshot();
    return snapshot;
}

// Показывает документ в предпросмотре как уменьшенную копию целой страницы A4
// (настоящий размер 794px используется только "под капотом" — на экране
// телефона он умещается целиком за счёт CSS-трансформации масштаба).
// Точечная правка срока оплаты для ОДНОГО конкретного, уже выставленного
// счёта — не меняет ни отсрочку клиента по умолчанию, ни другие счета.
function promptEditDueDate() {
    if (!_docPreview || !_docPreview.snapshot) return;
    document.getElementById('editDueDateInput').value = _docPreview.snapshot.dueDate || '';
    document.getElementById('editDueDateModal').style.display = 'flex';
}

async function applyEditDueDate() {
    const newDate = document.getElementById('editDueDateInput').value;
    if (!newDate || !_docPreview) return;
    document.getElementById('editDueDateModal').style.display = 'none';
    showLoading();
    try {
        _docPreview.snapshot.dueDate = newDate;
        const field = snapshotField(_docPreview.docType);
        await updateChecked(db.from('orders').update({ [field]: _docPreview.snapshot }).eq('id', currentOrderId));
        renderDocumentPreviewThumbnail();
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}

function renderDocumentPreviewThumbnail() {
    const { org } = _docPreview.snapshot;
    document.getElementById('orderDocumentRuNote').classList.toggle('hidden', !(org.country === 'RU' && org.entity_type === 'individual'));

    const container = document.getElementById('orderDocumentContent');
    container.innerHTML = `<div id="orderDocumentPreviewWrap" style="overflow:hidden;margin:0 auto;background:#f4f1ea;">
        <div id="orderDocumentInner" style="transform-origin:top left;">${buildDocumentHtml(_docPreview.docType, _docPreview.snapshot, _docPreview.lang)}</div>
    </div>`;

    requestAnimationFrame(() => {
        const inner = document.getElementById('orderDocumentInner');
        const wrap = document.getElementById('orderDocumentPreviewWrap');
        const trueWidth = inner.scrollWidth;
        const trueHeight = inner.scrollHeight;
        const targetWidth = Math.min(340, container.clientWidth || 340);
        const scale = targetWidth / trueWidth;
        inner.style.transform = `scale(${scale})`;
        wrap.style.width = Math.round(trueWidth * scale) + 'px';
        wrap.style.height = Math.round(trueHeight * scale) + 'px';
    });
    updateDocumentLangSwitcherUI();
}

// Строит HTML-разметку документа из ЗАМОРОЖЕННОГО снимка (не из текущих
// живых данных) — используется и для предпросмотра, и для снимка в PDF.
// lang — язык ЭТОГО документа, независимый от языка интерфейса приложения.
// Для Беларуси по закону (ст.10 №57-З) первичный документ должен содержать
// должность + ФИО + подпись ответственного лица — для остальных стран
// оставляем как было (просто ФИО, без отдельной строки подписи).
function issuedByLineText(org, sellerName, lang) {
    const name = org.director_name || sellerName;
    if (org.country === 'BY' && org.director_position) {
        return `${name}, ${org.director_position}`;
    }
    return name;
}

function buildDocumentHtml(docType, snapshot, lang) {
    const { order, org, cust, number, issueDate, dueDate, customerNameFallback } = snapshot;
    const isInvoice = docType === 'invoice';
    const title = isInvoice ? (org.vat_code ? tDoc('inv_title_vat_invoice', lang) : tDoc('inv_title_invoice', lang)) : tDoc('inv_title_delivery_note', lang);
    const numberPrefix = isInvoice ? 'INV-' : 'DN-';
    const sym = CURRENCY_SYMBOLS[org.currency_code] || org.currency_code || '€';
    const money = n => Number(n).toFixed(2) + ' ' + sym;
    const personalCodeLabel = org.country === 'LT' ? tDoc('company_personal_code_label_lt', lang) : tDoc('inv_personal_code', lang);

    // ---- Продавец ----
    const sellerName = org.entity_type === 'individual' ? (org.name || '') : (org.legal_name || org.name || '');
    const sellerIdLine = org.entity_type === 'individual'
        ? (org.personal_code ? `${personalCodeLabel}: ${escapeHtml(org.personal_code)}` : '')
        : (org.reg_number ? `${tDoc('inv_reg_number', lang)}: ${escapeHtml(org.reg_number)}` : '');
    const sellerLines = [
        sellerIdLine,
        org.vat_code ? `${tDoc('inv_vat_code', lang)}: ${escapeHtml(org.vat_code)}` : '',
        org.address ? escapeHtml(org.address) : '',
        [org.phone, org.email].filter(Boolean).map(escapeHtml).join(' · '),
        org.bank_name ? `${escapeHtml(org.bank_name)}${org.bank_account ? ' — ' + escapeHtml(org.bank_account) : ''}` : '',
        org.bank_swift ? `SWIFT: ${escapeHtml(org.bank_swift)}` : '',
    ].filter(Boolean);

    // ---- Покупатель ----
    const buyerName = cust ? cust.name : customerNameFallback;
    const buyerIdLine = cust && cust.entity_type === 'individual'
        ? (cust.personal_code ? `${tDoc('inv_personal_code', lang)}: ${escapeHtml(cust.personal_code)}` : '')
        : (cust && cust.reg_number ? `${tDoc('inv_reg_number', lang)}: ${escapeHtml(cust.reg_number)}` : '');
    const buyerLines = cust ? [
        buyerIdLine,
        cust.vat_code ? `${tDoc('inv_vat_code', lang)}: ${escapeHtml(cust.vat_code)}` : '',
        cust.address ? escapeHtml(cust.address) : '',
        cust.contact ? escapeHtml(cust.contact) : '',
    ].filter(Boolean) : [];

    // ---- Позиции с распределением скидки и НДС по строкам ----
    // Считаем по тем же формулам, что и money.js, но на данных из снимка
    const items = order.items || [];
    const subtotalAll = items.reduce((s, it) => s + it.quantity * it.price, 0);
    const discountAll = subtotalAll * (Number(order.discount) || 0) / 100;
    const afterDiscountAll = subtotalAll - discountAll;
    const vatRate = typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0;
    const vatAll = order.vat_exempt ? 0 : afterDiscountAll * vatRate;
    const grandAll = afterDiscountAll + vatAll;
    const vatPctLabel = order.vat_exempt ? '0%' : (vatRate * 100).toFixed(0) + '%';

    let itemsHtml = '';
    let totalQty = 0;
    items.forEach(item => {
        const lineNet = item.quantity * item.price;
        const discShare = subtotalAll > 0 ? (lineNet / subtotalAll) * discountAll : 0;
        const lineNetAfterDiscount = lineNet - discShare;
        const lineVat = order.vat_exempt ? 0 : lineNetAfterDiscount * vatRate;
        const lineSubtotal = lineNetAfterDiscount + lineVat;
        totalQty += Number(item.quantity);
        itemsHtml += `<tr>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.product)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${escapeHtml(unitAbbrevDoc(item.unit, lang))}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(item.price)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineNetAfterDiscount)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineVat)}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${vatPctLabel}</td>
            <td style="padding:9px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(lineSubtotal)}</td>
        </tr>`;
    });

    const dueDateRow = isInvoice
        ? `<div>${tDoc('inv_due_date', lang)}: ${formatDateDMY(dueDate)} <button onclick="promptEditDueDate()" style="border:none;background:none;cursor:pointer;padding:0 0 0 4px;vertical-align:middle;color:#9ca3af;" title="${escapeHtml(t('inv_edit_due_date'))}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg></button></div>`
        : '';

    const amountWords = amountInWords(grandAll, org.currency_code || 'EUR', lang);

    // Макет рассчитан на реальную ширину A4 при 96dpi (794px) — не под экран
    // телефона. На телефоне эта разметка показывается уменьшенной копией
    // (см. renderDocumentPreviewThumbnail), а для PDF снимок делается с
    // нетронутого, полноразмерного варианта — поэтому шрифты и отступы
    // подобраны как для печатной страницы, а не для мобильного экрана.
    return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;width:794px;min-height:1123px;box-sizing:border-box;padding:56px;font-size:16px;background:white;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
            <div style="display:flex;align-items:center;gap:12px;">
                ${org.logo_on_documents && org.logo_data_url ? `<img src="${org.logo_data_url}" style="width:96px;height:96px;border-radius:6px;object-fit:cover;flex-shrink:0;">` : ''}
                <h1 style="font-size:26px;margin:0;">${title}</h1>
            </div>
            <div style="text-align:right;font-size:15px;color:#374151;">
                <div>${tDoc('inv_number', lang)}: ${numberPrefix}${escapeHtml(number)}</div>
                <div>${tDoc('history_col_date', lang)}: ${formatDateDMY(issueDate)}</div>
                ${dueDateRow}
            </div>
        </div>

        <div style="display:flex;gap:32px;margin-bottom:28px;">
            <div style="flex:1;">
                <div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:4px;">${tDoc('inv_seller', lang)}</div>
                <div style="font-weight:600;font-size:16px;">${escapeHtml(sellerName)}</div>
                ${sellerLines.map(l => `<div style="font-size:15px;color:#374151;">${l}</div>`).join('')}
            </div>
            <div style="flex:1;">
                <div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:4px;">${tDoc('inv_buyer', lang)}</div>
                <div style="font-weight:600;font-size:16px;">${escapeHtml(buyerName)}</div>
                ${buyerLines.map(l => `<div style="font-size:15px;color:#374151;">${l}</div>`).join('')}
            </div>
        </div>

        <table class="table-clean" style="width:100%;border-collapse:separate;border-spacing:0;font-size:15px;table-layout:fixed;">
            <thead>
                <tr style="background:#e3e8df;">
                    <th style="padding:10px 8px;text-align:left;width:26%;">${tDoc('inv_col_name', lang)}</th>
                    <th style="padding:10px 8px;text-align:center;width:8%;">${tDoc('inv_col_qty', lang)}</th>
                    <th style="padding:10px 8px;text-align:center;width:8%;">${tDoc('inv_col_unit', lang)}</th>
                    <th style="padding:10px 8px;text-align:right;width:13%;">${tDoc('inv_col_price_no_vat', lang)}</th>
                    <th style="padding:10px 8px;text-align:right;width:13%;">${tDoc('inv_col_sum_no_vat', lang)}</th>
                    <th style="padding:10px 8px;text-align:right;width:12%;">${tDoc('inv_col_vat', lang)}</th>
                    <th style="padding:10px 8px;text-align:center;width:8%;">${tDoc('inv_col_vat_pct', lang)}</th>
                    <th style="padding:10px 8px;text-align:right;width:12%;">${tDoc('inv_col_total', lang)}</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>

        <div style="margin-top:20px;text-align:right;font-size:15px;">
            <div>${tDoc('inv_total_qty', lang)}: <b>${totalQty}</b></div>
            <div>${tDoc('inv_total_no_vat', lang)}: <b>${money(afterDiscountAll)}</b></div>
            <div>${tDoc('inv_vat_sum', lang)}: <b>${money(vatAll)}</b></div>
            <div style="font-size:19px;margin-top:6px;">${tDoc('inv_total_due', lang)}: <b>${money(grandAll)}</b></div>
        </div>

        <div style="margin-top:18px;font-size:13px;color:#4b5563;">
            ${tDoc('inv_amount_in_words', lang)}: ${escapeHtml(amountWords)}
        </div>

        <div style="margin-top:56px;display:flex;justify-content:space-between;font-size:15px;">
            <div>
                <div>${tDoc('inv_issued_by', lang)}: ${escapeHtml(issuedByLineText(org, sellerName, lang))}</div>
                ${org.country === 'BY' ? `<div style="margin-top:8px;">${tDoc('inv_signature', lang)}: _______________________</div>` : ''}
            </div>
            <div>${tDoc('inv_accepted', lang)}: _______________________</div>
        </div>
    </div>`;
}

// Строит счёт/накладную нативно через jsPDF+autoTable (см. helpers.js) —
// используется для скачивания/отправки; buildDocumentHtml() выше остаётся
// только для превью на экране телефона (это HTML, ему не нужна точность PDF).
async function buildDocumentPdf(docType, snapshot, lang) {
    const { order, org, cust, number, issueDate, dueDate, customerNameFallback } = snapshot;
    const isInvoice = docType === 'invoice';
    const title = isInvoice ? (org.vat_code ? tDoc('inv_title_vat_invoice', lang) : tDoc('inv_title_invoice', lang)) : tDoc('inv_title_delivery_note', lang);
    const numberPrefix = isInvoice ? 'INV-' : 'DN-';
    const sym = CURRENCY_SYMBOLS[org.currency_code] || org.currency_code || '€';
    const money = n => Number(n).toFixed(2) + ' ' + sym;
    const personalCodeLabel = org.country === 'LT' ? tDoc('company_personal_code_label_lt', lang) : tDoc('inv_personal_code', lang);

    const sellerName = org.entity_type === 'individual' ? (org.name || '') : (org.legal_name || org.name || '');
    const sellerIdLine = org.entity_type === 'individual'
        ? (org.personal_code ? `${personalCodeLabel}: ${org.personal_code}` : '')
        : (org.reg_number ? `${tDoc('inv_reg_number', lang)}: ${org.reg_number}` : '');
    const sellerLines = [
        sellerIdLine,
        org.vat_code ? `${tDoc('inv_vat_code', lang)}: ${org.vat_code}` : '',
        org.address || '',
        [org.phone, org.email].filter(Boolean).join(' · '),
        org.bank_name ? `${org.bank_name}${org.bank_account ? ' — ' + org.bank_account : ''}` : '',
        org.bank_swift ? `SWIFT: ${org.bank_swift}` : '',
    ].filter(Boolean);

    const buyerName = cust ? cust.name : customerNameFallback;
    const buyerIdLine = cust && cust.entity_type === 'individual'
        ? (cust.personal_code ? `${tDoc('inv_personal_code', lang)}: ${cust.personal_code}` : '')
        : (cust && cust.reg_number ? `${tDoc('inv_reg_number', lang)}: ${cust.reg_number}` : '');
    const buyerLines = cust ? [
        buyerIdLine,
        cust.vat_code ? `${tDoc('inv_vat_code', lang)}: ${cust.vat_code}` : '',
        cust.address || '',
        cust.contact || '',
    ].filter(Boolean) : [];

    const items = order.items || [];
    const subtotalAll = items.reduce((s, it) => s + it.quantity * it.price, 0);
    const discountAll = subtotalAll * (Number(order.discount) || 0) / 100;
    const afterDiscountAll = subtotalAll - discountAll;
    const vatRate = typeof currentOrgVatRate !== 'undefined' ? currentOrgVatRate : 0;
    const vatAll = order.vat_exempt ? 0 : afterDiscountAll * vatRate;
    const grandAll = afterDiscountAll + vatAll;
    const vatPctLabel = order.vat_exempt ? '0%' : (vatRate * 100).toFixed(0) + '%';

    let totalQty = 0;
    const bodyRows = items.map(item => {
        const lineNet = item.quantity * item.price;
        const discShare = subtotalAll > 0 ? (lineNet / subtotalAll) * discountAll : 0;
        const lineNetAfterDiscount = lineNet - discShare;
        const lineVat = order.vat_exempt ? 0 : lineNetAfterDiscount * vatRate;
        const lineSubtotal = lineNetAfterDiscount + lineVat;
        totalQty += Number(item.quantity);
        return [
            item.product, String(item.quantity), unitAbbrevDoc(item.unit, lang), money(item.price),
            money(lineNetAfterDiscount), money(lineVat), vatPctLabel, money(lineSubtotal),
        ];
    });

    const pdf = await createPdfDoc();
    const pageW = pdf.internal.pageSize.getWidth();
    const marginX = 14;

    // ---- Заголовок: тип документа слева (+логотип, если включён), номер/даты справа ----
    let titleX = marginX;
    let logoBottomY = 0;
    if (org.logo_on_documents && org.logo_data_url) {
        try {
            const logoSize = 26; // мм — увеличено вдвое по просьбе (было 13мм)
            const logoFormat = org.logo_data_url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            pdf.addImage(org.logo_data_url, logoFormat, marginX, 8, logoSize, logoSize);
            titleX = marginX + logoSize + 4;
            logoBottomY = 8 + logoSize;
        } catch (e) { console.error('Не удалось вставить логотип в документ:', e); }
    }
    pdf.setFontSize(18); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(title, titleX, 20);
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    pdf.text(`${tDoc('inv_number', lang)}: ${numberPrefix}${number}`, pageW - marginX, 14, { align: 'right' });
    pdf.text(`${tDoc('history_col_date', lang)}: ${formatDateDMY(issueDate)}`, pageW - marginX, 19, { align: 'right' });
    if (isInvoice) pdf.text(`${tDoc('inv_due_date', lang)}: ${formatDateDMY(dueDate)}`, pageW - marginX, 24, { align: 'right' });

    // ---- Продавец / Покупатель — две колонки ----
    const colW = (pageW - marginX * 2 - 10) / 2;
    const col2X = marginX + colW + 10;
    let y = Math.max(34, logoBottomY + 6);

    function drawParty(label, name, lines, x) {
        pdf.setFontSize(9); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textGray);
        pdf.text(label, x, y);
        pdf.setFontSize(11); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
        pdf.text(name || '', x, y + 5, { maxWidth: colW });
        pdf.setFontSize(9.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
        let ly = y + 10;
        lines.forEach(line => {
            const split = pdf.splitTextToSize(line, colW);
            pdf.text(split, x, ly);
            ly += 4.5 * split.length;
        });
        return ly;
    }
    const yAfterSeller = drawParty(tDoc('inv_seller', lang), sellerName, sellerLines, marginX);
    const yAfterBuyer  = drawParty(tDoc('inv_buyer', lang), buyerName, buyerLines, col2X);
    pdf.setTextColor(...PDF_COLORS.textDark);

    // ---- Таблица позиций ----
    pdf.autoTable({
        startY: Math.max(yAfterSeller, yAfterBuyer) + 6,
        margin: { left: marginX, right: marginX },
        head: [[tDoc('inv_col_name', lang), tDoc('inv_col_qty', lang), tDoc('inv_col_unit', lang), tDoc('inv_col_price_no_vat', lang), tDoc('inv_col_sum_no_vat', lang), tDoc('inv_col_vat', lang), tDoc('inv_col_vat_pct', lang), tDoc('inv_col_total', lang)]],
        body: bodyRows,
        headStyles: { ...PDF_TABLE_HEAD_STYLE, fontSize: 9 },
        columnStyles: {
            1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' },
            5: { halign: 'right' }, 6: { halign: 'center' }, 7: { halign: 'right' },
        },
        styles: { fontSize: 9, cellPadding: 2.2, font: 'Roboto' },
    });

    // ---- Итоги (справа) ----
    y = pdf.lastAutoTable.finalY + 8;
    pdf.setFontSize(10); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    const totalsRight = pageW - marginX;
    pdf.text(`${tDoc('inv_total_qty', lang)}: ${totalQty}`, totalsRight, y, { align: 'right' }); y += 5;
    pdf.text(`${tDoc('inv_total_no_vat', lang)}: ${money(afterDiscountAll)}`, totalsRight, y, { align: 'right' }); y += 5;
    pdf.text(`${tDoc('inv_vat_sum', lang)}: ${money(vatAll)}`, totalsRight, y, { align: 'right' }); y += 7;
    pdf.setFontSize(13); pdf.setFont('Roboto', 'bold'); pdf.setTextColor(...PDF_COLORS.textDark);
    pdf.text(`${tDoc('inv_total_due', lang)}: ${money(grandAll)}`, totalsRight, y, { align: 'right' });

    // ---- Сумма прописью ----
    y += 10;
    pdf.setFontSize(9); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    const amountWords = amountInWords(grandAll, org.currency_code || 'EUR', lang);
    const amountWordsSplit = pdf.splitTextToSize(`${tDoc('inv_amount_in_words', lang)}: ${amountWords}`, pageW - marginX * 2);
    pdf.text(amountWordsSplit, marginX, y);
    y += 4.5 * amountWordsSplit.length;

    // ---- Подписи ----
    y += 16;
    pdf.setFontSize(9.5); pdf.setFont('Roboto', 'normal'); pdf.setTextColor(...PDF_COLORS.textGray);
    pdf.text(`${tDoc('inv_issued_by', lang)}: ${issuedByLineText(org, sellerName, lang)}`, marginX, y);
    pdf.text(`${tDoc('inv_accepted', lang)}: _______________________`, pageW - marginX, y, { align: 'right' });
    if (org.country === 'BY') {
        y += 8;
        pdf.text(`${tDoc('inv_signature', lang)}: _______________________`, marginX, y);
    }

    return pdf;
}

// Шаг 2: превращаем предпросмотр в PDF (нативно, через jsPDF+autoTable — см.
// helpers.js) и пытаемся отправить через системное меню "Поделиться".
async function shareOrderDocumentPdf() {
    if (!_docPreview) return;
    const btn = document.getElementById('sendOrderDocumentBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    const { docType, snapshot, lang } = _docPreview;
    const filename = `${docType === 'invoice' ? 'schet' : 'nakladnaya'}_${snapshot.number}.pdf`;

    showLoading(t('customers_pdf_generating'));
    try {
        const pdf = await buildDocumentPdf(docType, snapshot, lang);
        await pdfSaveOrShare(pdf, filename);
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')) + t('customers_pdf_error_suffix'));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}
