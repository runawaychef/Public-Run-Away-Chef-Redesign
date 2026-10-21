// ==================== ОТМЕТКА "ДОКУМЕНТ ОТПРАВЛЕН" (самолётик на карточке) ====================
// Раздельно по типу документа (invoice/delivery_note), хранится только ПОСЛЕДНЯЯ
// отправка (не история) — orders.invoice_sent_at/_via, orders.delivery_note_sent_at/_via.
// Считается "отправленным" только реальная передача — через email (когда подключим)
// или через нативное меню "Поделиться" (см. pdfSaveOrShare -> shareOrderDocumentPdf) —
// НЕ простое локальное скачивание PDF на устройство.

// ==================== ОТМЕТКА "ДОКУМЕНТ ОТПРАВЛЕН" (самолётик на карточке) ====================
// Раздельно по типу документа (invoice/delivery_note), хранится только ПОСЛЕДНЯЯ
// отправка (не история) — orders.invoice_sent_at/_via, orders.delivery_note_sent_at/_via.
// Считается "отправленным" только реальная передача — через email или через
// нативное меню "Поделиться" (см. pdfSaveOrShare -> shareOrderDocumentPdf) —
// НЕ простое локальное скачивание PDF на устройство.
//
// Для email дополнительно отслеживается СТАТУС ДОСТАВКИ (invoice_delivery_status/
// delivery_note_delivery_status: 'sent' → 'delivered' / 'bounced' / 'complained' /
// 'delayed') — обновляется асинхронно через Resend Webhooks → Edge Function
// resend-webhook, когда почта Resend узнаёт судьбу письма. Для 'share' статуса
// доставки нет и быть не может (Web Share API не даёт такого подтверждения) —
// там значок всегда нейтральный.

// Смотрим на оба документа заказа и выбираем "худший" статус — так значок
// сразу сигналит о проблеме, даже если второй документ ушёл нормально.
function _worstDeliveryStatus(order) {
    const statuses = [order.invoice_delivery_status, order.delivery_note_delivery_status].filter(Boolean);
    if (statuses.includes('bounced') || statuses.includes('complained')) return 'alarm';
    if (statuses.includes('delivered')) return 'delivered';
    if (statuses.includes('delayed') || statuses.includes('sent')) return 'neutral';
    // Отправлено через 'Поделиться' (или email без статуса, вебхук ещё не пришёл) — нейтрально.
    if (order.invoice_sent_at || order.delivery_note_sent_at) return 'neutral';
    return null;
}

function _sentIconHtml(order) {
    const state = _worstDeliveryStatus(order);
    if (!state) return '';
    return `<svg class="oc-sent-icon oc-sent-icon--${state}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" onclick="event.stopPropagation(); showDocumentSentInfo(${order.id})"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h9a2.25 2.25 0 012.25 2.25v5.25M2.25 6.75v7.5A2.25 2.25 0 004.5 16.5h5.25M2.25 6.75L9 11.69a1.5 1.5 0 001.76 0L15.75 8.4"/><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 16.5l2.25 2.25 4.5-4.5"/></svg>`;
}

function _formatSentDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _sentViaLabel(via) {
    return via === 'email' ? t('send_via_email') : t('send_via_share');
}

function _deliveryStatusLabel(status) {
    switch (status) {
        case 'delivered': return t('send_status_delivered');
        case 'bounced': return t('send_status_bounced');
        case 'complained': return t('send_status_complained');
        case 'delayed': return t('send_status_delayed');
        case 'sent': return t('send_status_sent');
        default: return '';
    }
}

function showDocumentSentInfo(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const lines = [];
    if (order.invoice_sent_at) {
        const statusPart = order.invoice_sent_via === 'email' && order.invoice_delivery_status
            ? ` — ${_deliveryStatusLabel(order.invoice_delivery_status)}` : '';
        lines.push(`${t('orders_doc_invoice')}: ${_sentViaLabel(order.invoice_sent_via)}, ${_formatSentDateTime(order.invoice_sent_at)}${statusPart}`);
    }
    if (order.delivery_note_sent_at) {
        const statusPart = order.delivery_note_sent_via === 'email' && order.delivery_note_delivery_status
            ? ` — ${_deliveryStatusLabel(order.delivery_note_delivery_status)}` : '';
        lines.push(`${t('orders_doc_delivery_note')}: ${_sentViaLabel(order.delivery_note_sent_via)}, ${_formatSentDateTime(order.delivery_note_sent_at)}${statusPart}`);
    }
    if (!lines.length) return;
    showInfo(lines.join('\n'));
}

// Фиксирует факт отправки (docType: 'invoice'|'delivery_note', via: 'share'|'email',
// messageId — ID письма от Resend, только для via==='email', нужен вебхуку, чтобы
// потом найти этот заказ по событию доставки). Оптимистичное обновление, как и
// остальные быстрые действия в orders.js — сразу перерисовываем список, откатываем
// при ошибке сохранения.
async function recordDocumentSent(orderId, docType, via, messageId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const atField = docType === 'invoice' ? 'invoice_sent_at' : 'delivery_note_sent_at';
    const viaField = docType === 'invoice' ? 'invoice_sent_via' : 'delivery_note_sent_via';
    const msgIdField = docType === 'invoice' ? 'invoice_sent_message_id' : 'delivery_note_sent_message_id';
    const statusField = docType === 'invoice' ? 'invoice_delivery_status' : 'delivery_note_delivery_status';
    const prev = { at: order[atField], via: order[viaField], msgId: order[msgIdField], status: order[statusField] };
    const nowIso = new Date().toISOString();
    const newMsgId = via === 'email' ? (messageId || null) : null;
    const newStatus = via === 'email' ? 'sent' : null;

    order[atField] = nowIso;
    order[viaField] = via;
    order[msgIdField] = newMsgId;
    order[statusField] = newStatus;
    displayOrders();

    try {
        await updateChecked(db.from('orders').update({
            [atField]: nowIso, [viaField]: via, [msgIdField]: newMsgId, [statusField]: newStatus,
        }).eq('id', orderId));
    } catch (e) {
        console.error(e);
        order[atField] = prev.at;
        order[viaField] = prev.via;
        order[msgIdField] = prev.msgId;
        order[statusField] = prev.status;
        displayOrders();
        showInfo(t('send_status_save_error') + (e && e.message ? e.message : ''));
    }
}

// ==================== ЕДИНАЯ ФОРМА «ДОКУМЕНТ» ====================
// Одна форма и для свайпа карточки, и для кнопки «Счёт / накладная» в заказе.
// При открытии НИЧЕГО не собирается: ни PDF, ни номера, ни записи в базу — форма
// только читает, что уже выставлено по заказу, и показывает статус. Номер документа
// присваивается и PDF собирается лишь в момент «Отправить» / «Поделиться»
// (_sendPrepareDocs). Кнопка «Посмотреть» строит документ только в памяти
// (freezeDocumentSnapshot с preview:true, номер-заглушка «…»).
//
// Язык письма и документов (emailLang) НЕЗАВИСИМ от языка интерфейса. Тексты письма
// и имена вложений строятся через tLang() на выбранном языке, словарь подгружается
// лениво (ensureLangLoaded).
//
// Повторная отправка уже выставленного документа — по ТЕКУЩИМ данным заказа, но с
// прежними номером и датами (так работает freezeDocumentSnapshot). Если сумма заказа
// изменилась с момента выставления, форма предупреждает, а письмо говорит «обновлённый».

let _sendSheetState = null;
// { orderId, custId, emailLang, bccSelf, via:'email'|'share', checked:{invoice,delivery_note},
//   docs:{invoice:{...},delivery_note:{...}}, bodyText, bodyEdited, extraCc, dates:{invoice:{},delivery_note:{}} }

const _SEND_DOC_TYPES = ['delivery_note', 'invoice']; // порядок вложений: накладная, затем счёт

function tLang(key, lang) {
    const dict = (typeof I18N !== 'undefined' && I18N[lang]) || {};
    if (dict[key] !== undefined) return dict[key];
    const base = (typeof I18N !== 'undefined' && I18N[BASE_LANG]) || {};
    if (base[key] !== undefined) return base[key];
    return key;
}

function _sendDocKey(docType) { return docType === 'invoice' ? 'invoice' : 'dn'; }

function _sendAttachmentName(docType, lang, docNumberLabel, orderNumLabel) {
    const base = docType === 'invoice' ? tLang('send_attachment_base_invoice', lang) : tLang('send_attachment_base_delivery', lang);
    return `${base}_${docNumberLabel || orderNumLabel}.pdf`;
}

// Префикс INV-/DN- — тот же, что рисуется на самом PDF (invoice.js, numberPrefix).
function _formatDocNumber(docType, rawNumber) {
    if (!rawNumber) return null;
    return (docType === 'invoice' ? 'INV-' : 'DN-') + rawNumber;
}

function _sendOrderNumLabel(order) {
    return order.order_number ? ('№' + order.order_number) : ('#' + order.id);
}

// Резервирует номер документа и сохраняет снимок. Вызывается ТОЛЬКО при реальной
// отправке. Если документ уже выставлялся — номер и даты прежние. dateOverride —
// даты, выбранные в предпросмотре ещё не выставленного документа.
async function _reserveDocSnapshot(order, docType, dateOverride) {
    const field = snapshotField(docType);
    const { data: freshRow, error: freshErr } = await db.from('orders').select(field).eq('id', order.id).single();
    if (freshErr) throw freshErr;
    const existing = freshRow ? freshRow[field] : null;
    return await freezeDocumentSnapshot(order, docType, existing, dateOverride || undefined);
}

// 21.10: из копий документов берём только номер, даты и состав для сравнения сумм — без логотипа
// (полная копия с логотипом весит сотни КБ; на слабой связи форма не успевала открыться, код C).
// Полную копию по-прежнему грузит только «Посмотреть».
const _SEND_SNAP_FIELDS = ['number', 'issueDate', 'dueDate'];
async function _sendLoadRow(orderId) {
    const part = (col, pre) => _SEND_SNAP_FIELDS.map(f => `${pre}_${f}:${col}->>${f}`).join(', ')
        + `, ${pre}_calc:${col}->calc, ${pre}_vat:${col}->vat_rate, ${pre}_order:${col}->order`;
    const { data, error } = await db.from('orders')
        .select(`${part('invoice_snapshot', 'inv')}, ${part('delivery_note_snapshot', 'dn')}, invoice_sent_at, invoice_sent_via, delivery_note_sent_at, delivery_note_sent_via`)
        .eq('id', orderId).single();
    if (error) throw error;
    const r = data || {};
    const snap = pre => r[pre + '_number'] ? { number: r[pre + '_number'], issueDate: r[pre + '_issueDate'], dueDate: r[pre + '_dueDate'],
        calc: r[pre + '_calc'], vat_rate: r[pre + '_vat'], order: r[pre + '_order'] || { items: [] } } : null;
    return { invoice_snapshot: snap('inv'), delivery_note_snapshot: snap('dn'),
        invoice_sent_at: r.invoice_sent_at, invoice_sent_via: r.invoice_sent_via,
        delivery_note_sent_at: r.delivery_note_sent_at, delivery_note_sent_via: r.delivery_note_sent_via };
}

function _sendBuildDocInfo(order, row) {
    const info = {};
    _SEND_DOC_TYPES.forEach(dt => {
        const snap = row[snapshotField(dt)] || null;
        const issued = !!(snap && snap.number);
        let changed = false, oldTotal = null;
        if (issued) {
            try {
                oldTotal = documentTotals(snap).grandAll;
                const tol = snap.calc === 2 ? 0.004 : 0.05;
                changed = Math.abs(orderGrandTotal(order) - oldTotal) > tol;
            } catch (e) { console.error(e); }
        }
        info[dt] = {
            issued, changed, oldTotal,
            number: issued ? _formatDocNumber(dt, snap.number) : null,
            issueDate: snap ? snap.issueDate : null,
            sentAt: row[dt === 'invoice' ? 'invoice_sent_at' : 'delivery_note_sent_at'] || null,
            sentVia: row[dt === 'invoice' ? 'invoice_sent_via' : 'delivery_note_sent_via'] || null,
        };
    });
    return info;
}


// ---- Сводный счёт (один счёт на несколько заказов клиента) ----
// st.invKind: 'order' — счёт по этому заказу; 'cons' — сводный. Для уже выставленного
// сводного (st.consExisting) состав фиксирован — его меняют отдельным действием.

function _consSelectedOrders() {
    const st = _sendSheetState;
    return (st.consSel || []).map(id => orders.find(o => o.id === id)).filter(Boolean);
}

function _consSelectedTotal() {
    return _consSelectedOrders().reduce((s, o) => s + Math.round(orderGrandTotal(o) * 100), 0) / 100;
}

function _consPeriod(list) {
    const d = list.map(o => o.date).filter(Boolean).sort();
    return { from: d[0] || '', to: d[d.length - 1] || '' };
}

async function _sendLoadConsolidated(order) {
    if (!order.consolidated_invoice_id) return null;
    const { data, error } = await db.from('consolidated_invoices')
        .select('id, number, issue_date, due_date, snapshot, cancelled_at').eq('id', order.consolidated_invoice_id).single();
    if (error) throw error;
    if (!data || !data.snapshot || data.cancelled_at) return null;
    const snap = data.snapshot;
    const memberIds = (snap.consolidated.orders || []).map(o => o.id);
    // Текущий состав — заказы, которые сейчас числятся в счёте (удалённые в корзину сюда не попадают)
    const curOrders = orders.filter(o => o.consolidated_invoice_id === data.id)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.id - b.id));
    const curMemberIds = curOrders.map(o => o.id);
    const cur = curOrders.reduce((s, o) => s + Math.round(orderGrandTotal(o) * 100), 0) / 100;
    const old = snap.consolidated.totals.grand;
    const sameMembers = curMemberIds.length === memberIds.length && memberIds.every(id => curMemberIds.includes(id));
    return { id: data.id, number: _formatDocNumber('invoice', data.number), rawNumber: data.number, snapshot: snap,
        issueDate: data.issue_date, dueDate: data.due_date, memberIds, curMemberIds,
        changed: !sameMembers || Math.abs(cur - old) > 0.004, oldTotal: old, curTotal: cur };
}

// Клиент «сводный», если ему уже выставляли сводные счета (отдельной настройки в карточке нет).
function _custUsesConsolidated(order) {
    return !!order.customer_id && orders.some(o => o.customer_id === order.customer_id && o.consolidated_invoice_id);
}

function _consCandidates(order) {
    if (!order.customer_id) return [];
    return orders.filter(o => o.customer_id === order.customer_id && o.is_confirmed && !o.consolidated_invoice_id)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.id - b.id));
}

// Отдельные счета заказов клиента ({ orderId: номер }). Номер хранится в снимке счёта,
// а снимки в общий список заказов не грузятся — поэтому лёгкий запрос только номеров
// (как в разделе «Документы»). Защита сводного счёта от двойного выставления (вариант Б):
// заказ с отдельным счётом не отмечается по умолчанию; если по нему уже есть оплата —
// включить его в сводный нельзя.
async function _consLoadOwnInvoices(custId) {
    const res = await fetchAllRows(() => db.from('orders')
        .select('id, inv:invoice_snapshot->>number')
        .eq('org_id', currentOrgId).eq('customer_id', custId)
        .is('consolidated_invoice_id', null).is('deleted_at', null)
        .not('invoice_snapshot', 'is', null)
        .order('id'));
    if (res.error) throw res.error;
    const map = {};
    (res.data || []).forEach(r => { if (r.inv) map[r.id] = r.inv; });
    return map;
}

function _consOwnInv(id) {
    const st = _sendSheetState;
    return (st && st.consOwnInv && st.consOwnInv[id]) || null;
}

// Отдельный счёт уже оплачивается (есть хоть одна оплата) — в сводный такой заказ не берём.
function _consOwnInvLocked(o) {
    if (!o || o.id === _sendSheetState.orderId || !_consOwnInv(o.id)) return false;
    const info = typeof getOrderPaymentStatus === 'function' ? getOrderPaymentStatus(o) : null;
    return !!(info && info.paidAmt > 0.005);
}

function setSendInvKind(kind) {
    const st = _sendSheetState;
    if (!st || st.consExisting) return;
    st.invKind = kind === 'cons' ? 'cons' : 'order';
    st.bodyEdited = false;
    _renderSendSheet();
}

function toggleConsOrder(id, on) {
    const st = _sendSheetState;
    if (!st || st.consExisting) return;
    if (on && _consOwnInvLocked(orders.find(o => o.id === id))) return;
    const set = new Set(st.consSel);
    if (on) set.add(id); else if (id !== st.orderId) set.delete(id);
    st.consSel = [...set];
    st.bodyEdited = false;
    _renderSendSheet();
}

function toggleConsOld() {
    const st = _sendSheetState;
    if (!st) return;
    st.consOldOpen = !st.consOldOpen;
    _renderSendSheet();
}

// ---- Календарь выбора заказов сводного счёта (17.10) ----
// Нажатие на день: «По дням» — включить/выключить заказы дня; «Период» — первый и последний день,
// добавляются все доступные заказы между ними (без старых и без заказов с отдельным счётом).
const CONS_CAL_OPEN_KEY = 'cons_cal_open';
function _consCalOpen() { try { return localStorage.getItem(CONS_CAL_OPEN_KEY) !== '0'; } catch (e) { return true; } }
function toggleConsCal() {
    try { localStorage.setItem(CONS_CAL_OPEN_KEY, _consCalOpen() ? '0' : '1'); } catch (e) { /* без хранилища */ }
    _renderSendSheet();
}
function setConsCalMode(mode) {
    const st = _sendSheetState;
    if (!st) return;
    st.consCalMode = mode === 'range' ? 'range' : 'day';
    st.consRangeStart = null;
    _renderSendSheet();
}
function consCalShift(delta) {
    const st = _sendSheetState;
    if (!st) return;
    const [y, m] = st.consCalMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    st.consCalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    _renderSendSheet();
}
// Заказы клиента по дням: кандидаты и заказы, уже вошедшие в другой сводный счёт
function _consCalDayMap() {
    const st = _sendSheetState;
    const map = {};
    const add = (iso, key, o) => { (map[iso] = map[iso] || { cand: [], other: [] })[key].push(o); };
    st.consCand.forEach(o => { if (o.date) add(String(o.date).slice(0, 10), 'cand', o); });
    if (st.custId) orders.forEach(o => {
        if (o.customer_id === st.custId && o.is_confirmed && o.consolidated_invoice_id && o.date) add(String(o.date).slice(0, 10), 'other', o);
    });
    return map;
}
function _consCalSelectable(o) { return !_consOwnInvLocked(o); }
function consCalTap(iso) {
    const st = _sendSheetState;
    if (!st || st.consExisting) return;
    const map = _consCalDayMap();
    if (st.consCalMode === 'range') {
        if (!st.consRangeStart) {
            if (!map[iso] || !map[iso].cand.length) return;
            st.consRangeStart = iso;
            _renderSendSheet();
            return;
        }
        const a = st.consRangeStart < iso ? st.consRangeStart : iso;
        const b = st.consRangeStart < iso ? iso : st.consRangeStart;
        const set = new Set(st.consSel);
        st.consCand.forEach(o => {
            const d = String(o.date || '').slice(0, 10);
            if (d < a || d > b || !_consCalSelectable(o)) return;
            if (o.id !== st.orderId && (o.cons_excluded || _consOwnInv(o.id))) return;
            set.add(o.id);
        });
        st.consSel = [...set];
        st.consRangeStart = null;
        st.bodyEdited = false;
        _renderSendSheet();
        return;
    }
    const day = map[iso];
    if (!day) return;
    const pick = day.cand.filter(_consCalSelectable);
    if (!pick.length) return;
    const allOn = pick.every(o => st.consSel.includes(o.id));
    const set = new Set(st.consSel);
    pick.forEach(o => { if (allOn) { if (o.id !== st.orderId) set.delete(o.id); } else set.add(o.id); });
    st.consSel = [...set];
    st.bodyEdited = false;
    _renderSendSheet();
}
function _consCalHtml() {
    // Вид — как у всех календарей программы (calendar.js): те же шапка, дни недели, клетки и точки.
    const st = _sendSheetState;
    const open = _consCalOpen();
    const head = `<div style="display:flex; justify-content:space-between; align-items:center; margin:2px 0 6px;">
        <span style="font-size:13px; font-weight:700; color:#3c3a34;">${t('send_cons_cal')}</span>
        <button type="button" onclick="toggleConsCal()" style="border:0; background:transparent; color:#7c9473; font-size:12px; font-weight:700; padding:4px 0;">${t(open ? 'send_cons_cal_hide' : 'send_cons_cal_show')}</button></div>`;
    if (!open) return head;
    const seg = `<div class="send-doctype-switch" style="margin:0 0 8px;">
        <button class="${st.consCalMode === 'day' ? 'active' : ''}" onclick="setConsCalMode('day')">${t('send_cons_cal_days')}</button>
        <button class="${st.consCalMode === 'range' ? 'active' : ''}" onclick="setConsCalMode('range')">${t('send_cons_cal_range')}</button></div>`;
    const [y, m] = st.consCalMonth.split('-').map(Number);
    const map = _consCalDayMap();
    const now = typeof orgNowDate === 'function' ? orgNowDate() : new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const C_CAN = '#7c9473', C_OWN = '#d9a441', C_OTHER = '#b9b3a5', C_OLD = '#ddd7c8';
    let lead = new Date(y, m - 1, 1).getDay(); lead = lead === 0 ? 6 : lead - 1;
    const days = new Date(y, m, 0).getDate();
    const prevDays = new Date(y, m - 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<div class="cal-day other-month">${prevDays - lead + i + 1}</div>`;
    for (let d = 1; d <= days; d++) {
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const day = map[iso];
        const cls = ['cal-day'];
        if (iso === todayIso) cls.push('today');
        let dots = [];
        if (day) {
            const pick = day.cand.filter(_consCalSelectable);
            const on = pick.filter(o => st.consSel.includes(o.id)).length;
            const full = pick.length && on === pick.length;
            if (full) cls.push('selected');
            else if (on) cls.push('cons-part');
            if (!pick.length) cls.push('cons-none');
            if (day.cand.some(o => o.id === st.orderId)) cls.push('cons-cur');
            if (st.consRangeStart === iso) cls.push('cons-start');
            // Точка на каждый заказ дня (до 3): зелёная — можно добавить, жёлтая — есть отдельный счёт,
            // серая — уже в другом счёте или нельзя взять, бледная — старый заказ. На выбранном дне — белые.
            day.cand.forEach(o => {
                const own = o.id !== st.orderId && _consOwnInv(o.id);
                const c = !_consCalSelectable(o) ? C_OTHER : own ? C_OWN : (o.cons_excluded && o.id !== st.orderId) ? C_OLD : C_CAN;
                dots.push(full && c !== C_OWN ? '#fff' : c);
            });
            day.other.forEach(() => dots.push(full ? '#fff' : C_OTHER));
        } else cls.push('cons-none');
        dots = dots.slice(0, 3);
        const dotsHtml = dots.length ? `<div class="cal-day-dots">${dots.map(c => `<span class="cal-day-dot" style="background:${c}"></span>`).join('')}</div>` : '';
        cells += `<div class="${cls.join(' ')}" onclick="consCalTap('${iso}')">${d}${dotsHtml}</div>`;
    }
    const tail = (7 - ((lead + days) % 7)) % 7;
    for (let i = 1; i <= tail; i++) cells += `<div class="cal-day other-month">${i}</div>`;
    const chev = dir => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path stroke-linecap="round" stroke-linejoin="round" d="${dir < 0 ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'}"/></svg>`;
    const hint = st.consCalMode === 'range'
        ? `<div class="cal-range-status" style="margin:6px 0 0;">${t(st.consRangeStart ? 'send_cons_cal_pick_end' : 'send_cons_cal_pick_start')}</div>` : '';
    const leg = `<div class="cal-legend"><span><i class="sq"></i>${t('send_cons_leg_in')}</span><span><i style="background:${C_CAN}"></i>${t('send_cons_leg_can')}</span><span><i style="background:${C_OWN}"></i>${t('send_cons_leg_own')}</span><span><i style="background:${C_OTHER}"></i>${t('send_cons_leg_other')}</span><span><i style="background:${C_OLD}"></i>${t('send_cons_leg_old')}</span></div>`;
    return head + seg + `<div class="cal-inline">
        <div class="cal-header">
            <div class="cal-nav-btn" onclick="consCalShift(-1)">${chev(-1)}</div>
            <div class="cal-title">${calMonthName(m - 1)} ${y}</div>
            <div class="cal-nav-btn" onclick="consCalShift(1)">${chev(1)}</div>
        </div>
        <div class="cal-weekdays">${calWeekdays().map(w => `<div class="cal-weekday">${w}</div>`).join('')}</div>
        <div class="cal-days">${cells}</div>${hint}${leg}
    </div><div style="border-top:1px solid #e5e0d0; margin:12px 0 6px;"></div>`;
}

function _consBlockHtml(order) {
    const st = _sendSheetState;
    const box = 'margin:10px 0 0;';
    if (st.consExisting) {
        const c = st.consExisting, co = c.snapshot.consolidated;
        const rows = co.orders.map(o => `<div style="display:flex; justify-content:space-between; font-size:12px; color:#555; padding:2px 0;"><span>${escapeHtml(o.number ? '№' + o.number : '#' + o.id)} · ${formatDateDMY(o.date)}${o.dn ? ' · ' + escapeHtml(o.dn) : ''}</span><span>${formatMoney(o.grossC / 100)}</span></div>`).join('');
        const warn = c.changed ? `<div style="margin-top:6px; font-size:12px; background:#f8efd9; color:#8a6a1f; border-radius:8px; padding:6px 8px;">${t('send_cons_changed_warn').replace('{old}', formatMoney(c.oldTotal)).replace('{new}', formatMoney(c.curTotal))}</div>` : '';
        // Справка об оплате счёта (оплату вносят из окна оплаты любого заказа счёта)
        const pc = typeof _payConsState === 'function' ? _payConsState(order) : null;
        const paidLine = pc ? `<div style="display:flex; justify-content:space-between; font-size:12px; color:#4f6349; border-top:1px solid #e5e0d0; margin-top:4px; padding-top:5px;"><span>${t('send_cons_paid_line').replace('{paid}', formatMoney(pc.paidC / 100)).replace('{total}', formatMoney(pc.totalC / 100))}</span></div>` : '';
        return `<div style="${box}"><div style="font-size:12px; color:#6b675d; margin-bottom:4px;">${t('send_cons_member')}</div>${rows}${paidLine}${warn}</div>`;
    }
    if (!st.consCand.length || st.docs.invoice.issued) return '';
    const seg = `<div class="send-doctype-switch" style="margin:10px 0 0;">
        <button class="${st.invKind === 'order' ? 'active' : ''}" onclick="setSendInvKind('order')">${t('send_inv_kind_order')}</button>
        <button class="${st.invKind === 'cons' ? 'active' : ''}" onclick="setSendInvKind('cons')">${t('send_inv_kind_cons')}</button></div>`;
    if (st.invKind !== 'cons') return seg;
    const rowHtml = o => {
        const on = st.consSel.includes(o.id);
        const dn = o.delivery_note_sent_at ? ' ✓' : '';
        const own = o.id !== st.orderId ? _consOwnInv(o.id) : null;
        const locked = _consOwnInvLocked(o);
        const ownLine = own ? `<div style="margin:-2px 0 3px 24px; font-size:12px; color:#96712a;">${t(locked ? 'send_cons_own_inv_paid' : 'send_cons_own_inv').replace('{n}', escapeHtml(own))}</div>` : '';
        return `<label style="display:flex; align-items:center; gap:8px; font-size:13px; color:${locked ? '#a29c8c' : '#3c3a34'}; padding:3px 0; cursor:${locked ? 'default' : 'pointer'};">
            <input type="checkbox" ${on ? 'checked' : ''} ${(o.id === st.orderId || locked) ? 'disabled' : ''} onchange="toggleConsOrder(${o.id}, this.checked)" style="accent-color:#7c9473; width:16px; height:16px;">
            <span style="flex:1;">${escapeHtml(o.order_number ? '№' + o.order_number : '#' + o.id)} · ${formatDateDMY(o.date)}${dn}</span><span>${formatMoney(orderGrandTotal(o))}</span></label>${ownLine}`;
    };
    // Заказы, помеченные «выставлено вне программы» (cons_excluded), сворачиваются в отдельную строку
    const isOld = o => o.cons_excluded && o.id !== st.orderId;
    const rows = st.consCand.filter(o => !isOld(o)).map(rowHtml).join('');
    const oldList = st.consCand.filter(isOld);
    let oldHtml = '';
    if (oldList.length) {
        const open = !!st.consOldOpen;
        oldHtml = `<div style="margin-top:6px; background:#f6f4ec; border-radius:10px; padding:2px 12px;">
            <div onclick="toggleConsOld()" style="display:flex; align-items:center; gap:8px; font-size:13px; color:#6b675d; min-height:36px; cursor:pointer;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b675d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${open ? 90 : 0}deg);"><polyline points="9 6 15 12 9 18"/></svg>
                <span style="flex:1;">${t('send_cons_old').replace('{n}', oldList.length)}</span></div>
            ${open ? `<div style="padding-bottom:4px; color:#6b675d;">${oldList.map(rowHtml).join('')}</div>` : ''}</div>`;
    }
    const dupSel = st.consSel.filter(id => id !== st.orderId && _consOwnInv(id));
    const dupWarn = dupSel.length ? `<div style="margin-top:6px; font-size:12px; background:#f8efd9; color:#8a6a1f; border-radius:8px; padding:6px 8px;">${t('send_cons_own_inv_warn')}</div>` : '';
    return seg + `<div style="${box}">${_consCalHtml()}<div style="font-size:12px; color:#6b675d; margin-bottom:4px;">${t('send_cons_pick_orders')}</div>${rows}${oldHtml}
        <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:#3c3a34; border-top:1px solid #e5e0d0; margin-top:4px; padding-top:5px;"><span>${t('send_cons_total')} (${st.consSel.length})</span><span>${formatMoney(_consSelectedTotal())}</span></div>${dupWarn}</div>`;
}

function _isConsInvoice() {
    const st = _sendSheetState;
    return !!(st && (st.consExisting || st.invKind === 'cons') && st.checked.invoice);
}

function _sendCheckedTypes() {
    return _SEND_DOC_TYPES.filter(dt => _sendSheetState.checked[dt]);
}

function _sendBuildBody() {
    const st = _sendSheetState;
    const order = orders.find(o => o.id === st.orderId);
    const types = _sendCheckedTypes();
    if (!order || !types.length) return '';
    const lang = st.emailLang;
    const phrases = types.map(dt => {
        const d = st.docs[dt], k = _sendDocKey(dt);
        if (dt === 'invoice' && st.consExisting) {
            return tLang(`send_phr_${k}_${st.consExisting.changed ? 'upd' : 'num'}`, lang).replace('{doc_number}', st.consExisting.number);
        }
        if (dt === 'invoice' && st.invKind === 'cons') return tLang(`send_phr_${k}_num`, lang).replace('{doc_number}', _formatDocNumber(dt, '…'));
        // Номера ещё нет — заглушка «INV-…» / «DN-…», при отправке подставится настоящий номер (21.10)
        if (!d.issued) return tLang(`send_phr_${k}_num`, lang).replace('{doc_number}', _formatDocNumber(dt, '…'));
        return tLang(`send_phr_${k}_${d.changed ? 'upd' : 'num'}`, lang).replace('{doc_number}', d.number);
    });
    if (_isConsInvoice()) {
        let from, to, sum;
        if (st.consExisting && st.consExisting.changed) {
            const curList = st.consExisting.curMemberIds.map(id => orders.find(o => o.id === id)).filter(Boolean);
            const pr = _consPeriod(curList);
            from = pr.from; to = pr.to; sum = st.consExisting.curTotal;
        } else if (st.consExisting) {
            const co = st.consExisting.snapshot.consolidated;
            from = co.periodFrom; to = co.periodTo; sum = co.totals.grand;
        } else {
            const pr = _consPeriod(_consSelectedOrders());
            from = pr.from; to = pr.to; sum = _consSelectedTotal();
        }
        if (from === to) {
            return tLang('send_body_docs_cons_day', lang)
                .replace('{customer}', order.customer || t('orders_no_customer'))
                .replace('{docs}', phrases.join(tLang('send_and', lang)))
                .replace('{date}', formatDateDMY(from))
                .replace('{sum}', formatMoney(sum))
                .replace('{org_name}', currentOrgName || '');
        }
        return tLang('send_body_docs_cons', lang)
            .replace('{customer}', order.customer || t('orders_no_customer'))
            .replace('{docs}', phrases.join(tLang('send_and', lang)))
            .replace('{from}', formatDateDMY(from)).replace('{to}', formatDateDMY(to))
            .replace('{sum}', formatMoney(sum))
            .replace('{org_name}', currentOrgName || '');
    }
    return tLang('send_body_docs', lang)
        .replace('{customer}', order.customer || t('orders_no_customer'))
        .replace('{docs}', phrases.join(tLang('send_and', lang)))
        .replace('{order_number}', _sendOrderNumLabel(order))
        .replace('{sum}', formatMoney(orderGrandTotal(order)))
        .replace('{org_name}', currentOrgName || '');
}

function _sendBuildSubject(entries, lang, orgName) {
    const parts = entries.map(e => tLang(`send_subj_${_sendDocKey(e.dt)}${e.updated ? '_upd' : ''}`, lang).replace('{doc_number}', e.num));
    return parts.join(', ') + (orgName ? ' — ' + orgName : '');
}

function _renderSendEmailLangSwitch() {
    return `<div class="lang-switch" id="sendEmailLangSwitch" style="margin-bottom:10px;">` +
        AVAILABLE_LANGS.map(code =>
            `<button type="button" class="${code === _sendSheetState.emailLang ? 'active' : ''}" onclick="selectSendEmailLang('${code}')">${code.toUpperCase()}</button>`
        ).join('') +
        `</div>`;
}

// ---- Даты документа на странице (21.10) ----
function _isoAddDays(iso, n) {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + (Number(n) || 0));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Отсрочка клиента в днях (как при выставлении: нет значения — 7)
function _sendTermDays(cust) {
    return (cust && cust.payment_term_days != null) ? Number(cust.payment_term_days) : 7;
}
// key: 'inv_issue' | 'inv_due' | 'dn_issue'. Смена даты счёта пересчитывает срок, если его не правили вручную.
function _sendSetDate(key, iso) {
    const st = _sendSheetState;
    if (!st || !iso) return;
    if (key === 'dn_issue') st.dates.delivery_note.issueDate = iso;
    else if (key === 'inv_due') { st.dates.invoice.dueDate = iso; st.dates.invoice.dueManual = true; }
    else {
        st.dates.invoice.issueDate = iso;
        if (!st.dates.invoice.dueManual) {
            const cust = st.custId ? customers.find(c => c.id === st.custId) : null;
            st.dates.invoice.dueDate = _isoAddDays(iso, _sendTermDays(cust));
        }
    }
    _renderSendSheet();
}
function pickSendDate(key) {
    const st = _sendSheetState;
    if (!st) return;
    const cur = key === 'dn_issue' ? st.dates.delivery_note.issueDate : key === 'inv_due' ? st.dates.invoice.dueDate : st.dates.invoice.issueDate;
    const inp = document.getElementById('sendDateInput');
    if (inp) inp.value = cur || '';
    toggleCustomCalendar('globalCalendarPopup', 'sendDateInput', 'sendDateLabel', { onPick: iso => _sendSetDate(key, iso) });
}
function _sendDateTileHtml(key, label, iso, half) {
    return `<div class="send-date-tile" onclick="event.stopPropagation(); pickSendDate('${key}')" style="${half ? 'flex:0 0 calc(50% - 4px);' : 'flex:1;'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7c9473" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="float:right; margin-top:2px;"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        <div style="font-size:11px; color:#8a857a;">${escapeHtml(label)}</div>
        <div style="font-size:14px; font-weight:600; color:#3c3a34;">${formatDateDMY(iso)}</div></div>`;
}
// Плашки — только у ещё не выставленного документа (у выставленного даты меняются в «Посмотреть»)
function _sendDatesHtml(dt) {
    const st = _sendSheetState, d = st.docs[dt];
    if (d.issued || (dt === 'invoice' && st.consExisting)) return '';
    if (dt === 'delivery_note') {
        return `<div style="display:flex; gap:8px; margin-top:10px;">${_sendDateTileHtml('dn_issue', t('send_date_dn'), st.dates.delivery_note.issueDate, true)}</div>
            <div style="font-size:11.5px; color:#8a857a; margin-top:4px;">${escapeHtml(t('send_date_dn_hint'))}</div>`;
    }
    const di = st.dates.invoice;
    const cust = st.custId ? customers.find(c => c.id === st.custId) : null;
    const hint = di.dueManual ? '' : `<div style="font-size:11.5px; color:#8a857a; margin-top:4px;">${escapeHtml(t('send_date_due_hint').replace('{n}', _sendTermDays(cust)))}</div>`;
    return `<div style="display:flex; gap:8px; margin-top:10px;">${_sendDateTileHtml('inv_issue', t('send_date_inv'), di.issueDate)}${_sendDateTileHtml('inv_due', t('send_date_due'), di.dueDate)}</div>${hint}`;
}

function _sendDocRowHtml(dt, order) {
    const st = _sendSheetState, d = st.docs[dt], on = !!st.checked[dt];
    const isCons = dt === 'invoice' && (st.consExisting || (st.invKind === 'cons' && !d.issued));
    const segShown = dt === 'invoice' && !st.consExisting && st.consCand.length && !d.issued;
    const label = dt === 'invoice' ? (st.consExisting ? t('send_cons_invoice') : segShown ? t('send_inv_title') : t('orders_doc_invoice')) : t('orders_doc_delivery_note');
    let status;
    if (isCons && st.consExisting) {
        const c = st.consExisting;
        status = t('send_doc_status_issued').replace('{number}', c.number).replace('{date}', formatDateDMY(c.issueDate));
        if (d.sentAt) status += t('send_doc_status_sent').replace('{date}', _formatSentDateTime(d.sentAt)).replace('{via}', _sentViaLabel(d.sentVia));
    } else if (isCons) {
        status = t('send_cons_status_new');
    } else if (!d.issued) {
        status = t('send_doc_status_new');
    } else {
        status = t('send_doc_status_issued').replace('{number}', d.number).replace('{date}', formatDateDMY(d.issueDate));
        if (d.sentAt) status += t('send_doc_status_sent').replace('{date}', _formatSentDateTime(d.sentAt)).replace('{via}', _sentViaLabel(d.sentVia));
    }
    const warn = (d.changed && !isCons)
        ? `<div style="margin:6px 0 0 28px; font-size:12px; background:#f8efd9; color:#8a6a1f; border-radius:8px; padding:6px 8px;">${t('send_doc_changed_warn').replace('{old}', formatMoney(d.oldTotal)).replace('{new}', formatMoney(orderGrandTotal(order)))}</div>`
        : '';
    return `<div style="border:1px solid ${on ? '#7c9473' : '#d9d4c3'}; background:${on ? '#f3f5ef' : '#fff'}; border-radius:14px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleSendDoc('${dt}', this.checked)" style="accent-color:#7c9473; width:18px; height:18px; flex:none;">
            <b style="font-size:14px; color:#3c3a34;">${label}</b>
            <span onclick="openSendDocPreview('${dt}')" style="margin-left:auto; color:#4f6349; font-weight:700; font-size:12px; text-decoration:underline; cursor:pointer;">${t('send_view')}</span>
        </div>
        <div style="font-size:12px; color:#888; margin:4px 0 0 28px;">${status}</div>${warn}${on ? _sendDatesHtml(dt) : ''}${(dt === 'invoice' && on) ? _consBlockHtml(order) : ''}</div>`;
}

function _renderSendSheet() {
    const st = _sendSheetState;
    const body = document.getElementById('sendSheetBody');
    if (!st || !body) return;
    const order = orders.find(o => o.id === st.orderId);
    const cust = st.custId ? customers.find(c => c.id === st.custId) : null;
    if (!order) return;

    // Сохраняем то, что пользователь уже набрал, до перерисовки
    const ccEl = document.getElementById('sendExtraCc');
    if (ccEl) st.extraCc = ccEl.value;
    const bodyEl = document.getElementById('sendEmailBody');
    if (bodyEl && st.bodyEdited) st.bodyText = bodyEl.value;
    if (!st.bodyEdited) st.bodyText = _sendBuildBody();

    const hasEmail = !!(cust && cust.email);
    const types = _sendCheckedTypes();
    const isEmail = st.via === 'email';
    const orderNumLabel = _sendOrderNumLabel(order);

    const chips = types.map(dt => {
        const d = st.docs[dt];
        const label = dt === 'invoice' ? t('orders_doc_invoice') : t('orders_doc_delivery_note');
        const text = (dt === 'invoice' && st.consExisting) ? _sendAttachmentName(dt, st.emailLang, st.consExisting.number, orderNumLabel) : d.issued ? _sendAttachmentName(dt, st.emailLang, d.number, orderNumLabel) : `${label} (${t('send_number_on_send')})`;
        return `<span style="display:inline-block; background:#f1eee3; border-radius:10px; padding:5px 9px; font-size:12px; color:#555; margin:0 6px 4px 0;">📎 ${escapeHtml(text)}</span>`;
    }).join('');

    let howBlock = '';
    if (isEmail) {
        const recipient = hasEmail
            ? `<div class="send-recipient-row" style="margin-bottom:12px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b675d" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/></svg>
                <span class="email-value">${escapeHtml(cust.email)}</span>
                <span class="send-edit-link" onclick="openEmailQuickEdit(${cust.id})">${t('send_edit_email')}</span>
            </div>`
            : `<div style="font-size:12px; background:#f3ded9; color:#a3493d; border-radius:10px; padding:8px 10px; margin-bottom:12px;">${t('send_no_email_inline')} ${cust ? `<span class="send-edit-link" style="color:#a3493d; text-decoration:underline;" onclick="openEmailQuickEdit(${cust.id})">${t('send_add_email')}</span>` : ''}</div>`;
        howBlock = `${recipient}
            <div class="flex items-center justify-between" style="margin-bottom:6px;">
                <p style="font-size:13px; color:#6b675d; margin:0;">${t('send_body_label')}</p>
                <p style="font-size:11px; color:#9a9488; margin:0;">${t('send_letter_lang_label')}</p>
            </div>
            ${_renderSendEmailLangSwitch()}
            <textarea id="sendEmailBody" rows="6" oninput="_sendSheetState.bodyEdited = true; _sendSheetState.bodyText = this.value;" class="border p-2 rounded-xl table-text w-full resize-none" style="margin-bottom:2px;">${escapeHtml(st.bodyText || '')}</textarea>
            ${/…/.test(st.bodyText || '') ? `<div style="font-size:11.5px; color:#8a857a; margin-bottom:8px;">${escapeHtml(t('send_body_numbers_hint'))}</div>` : '<div style="height:6px;"></div>'}
            <div style="margin-bottom:10px;">${chips}</div>
            <label class="flex items-center gap-1.5" style="margin-bottom:10px; cursor:pointer;">
                <input type="checkbox" id="sendBccSelf" ${st.bccSelf ? 'checked' : ''} onchange="_sendSheetState.bccSelf = this.checked;" class="w-4 h-4" style="accent-color:#7c9473;">
                <span style="font-size:13px; color:#3c3a34;">${t('send_bcc_self_label')}</span>
            </label>
            <p style="font-size:13px; color:#6b675d; margin:0 0 6px;">${t('send_extra_cc_label')}</p>
            <input type="text" id="sendExtraCc" value="${escapeHtml(st.extraCc || '')}" placeholder="${t('send_extra_cc_placeholder')}" class="border p-2 rounded-xl table-text w-full" style="margin-bottom:14px;">`;
    } else {
        howBlock = `<div style="font-size:12px; color:#888; margin-bottom:10px;">${t('send_share_hint')}${!hasEmail && cust ? ` <span class="send-edit-link" style="text-decoration:underline;" onclick="openEmailQuickEdit(${cust.id})">${t('send_add_email')}</span>` : ''}</div>
            <p style="font-size:11px; color:#9a9488; margin:0 0 6px;">${t('send_doc_lang_label')}</p>
            ${_renderSendEmailLangSwitch()}
            <div style="margin-bottom:14px;">${chips}</div>`;
    }

    const canSubmit = types.length > 0 && (!isEmail || hasEmail) && !(_isConsInvoice() && !st.consExisting && !st.consSel.length);
    const btnLabel = isEmail ? t('send_button') : (t('send_share_btn') + (types.length > 1 ? ` (${types.length})` : ''));
    const icon = isEmail
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15A2.25 2.25 0 0121.75 6.75v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zm0 0l9.75 6.75 9.75-6.75"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"/></svg>`;

    body.innerHTML = `
        <input type="hidden" id="sendDateInput"><span id="sendDateLabel" hidden></span>
        <p style="font-size:13px; color:#888; margin:0 0 6px;">${escapeHtml(order.customer || t('orders_no_customer'))} · ${escapeHtml(orderNumLabel)} · ${formatMoney(orderGrandTotal(order))}</p>
        <p class="send-section-label">${t('send_what')}</p>
        ${_SEND_DOC_TYPES.map(dt => _sendDocRowHtml(dt, order)).join('')}
        <p class="send-section-label">${t('send_how')}</p>
        <div class="send-doctype-switch" style="margin-bottom:12px;">
            <button class="${isEmail ? 'active' : ''}" onclick="setSendVia('email')">${t('send_how_email')}</button>
            <button class="${!isEmail ? 'active' : ''}" onclick="setSendVia('share')">${t('send_how_share')}</button>
        </div>
        ${howBlock}
        <button class="pill-btn w-full justify-center" id="sendDocSubmitBtn" onclick="submitSendDocument()" ${canSubmit ? '' : 'disabled style="opacity:.5;"'}>
            ${icon}<span>${btnLabel}</span>
        </button>
        ${st.custId && typeof openDocumentsSection === 'function' ? `<div style="text-align:center; margin-top:12px;"><span onclick="openDocumentsSection({ custId: ${st.custId} })" style="color:#4f6349; font-size:13px; font-weight:700; cursor:pointer;">${t('docs_all_of_customer')} ›</span></div>` : ''}`;
}

// «Разговорчивая» кнопка (16.10): раньше при сбое форма «Документ» молча не открывалась.
// Теперь вместо тишины — сообщение с кодом: A — заказ не найден в памяти, B — ошибка
// при построении формы, C — сервер не ответил за 15 с. Подробности — в консоли.
const _SEND_OPEN_TIMEOUT_MS = 15000;
let _sendOpenSeq = 0;
function _sendOpenFail(code, detail, retry) {
    console.error('[openSendDocumentSheet] код ' + code, detail);
    hideLoading();
    // 21.10: при сбое связи/сервера — «Повторить» вместо совета перезапустить приложение
    if (retry) {
        showConfirm(t('send_open_fail_retry').replace('{code}', code), { ok: t('common_retry'), cancel: t('settings_close') })
            .then(ok => { if (ok) retry(); });
        return;
    }
    showInfo(t('send_open_fail').replace('{code}', code));
}
function _sendWithTimeout(promise) {
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('SEND_OPEN_TIMEOUT')), _SEND_OPEN_TIMEOUT_MS); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function openSendDocumentSheet(orderId, docType) {
    const seq = ++_sendOpenSeq;
    try {
        await _openSendDocumentSheetImpl(orderId, docType, seq);
    } catch (e) {
        if (seq !== _sendOpenSeq) return; // уже открыта другая попытка
        _sendOpenFail(e && e.message === 'SEND_OPEN_TIMEOUT' ? 'C' : 'B', e, () => openSendDocumentSheet(orderId, docType));
    }
}

async function _openSendDocumentSheetImpl(orderId, docType, seq) {
    const order = orders.find(o => o.id === orderId);
    if (!order) { _sendOpenFail('A', { orderId, type: typeof orderId, ordersLoaded: (orders || []).length }); return; }
    const cust = order.customer_id ? customers.find(c => c.id === order.customer_id) : null;

    showLoading();
    let row;
    try {
        row = await _sendWithTimeout(_sendLoadRow(orderId));
    } catch (e) {
        if (e && e.message === 'SEND_OPEN_TIMEOUT') throw e;
        console.error(e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    let consExisting = null;
    try { consExisting = await _sendWithTimeout(_sendLoadConsolidated(order)); } catch (e) {
        if (e && e.message === 'SEND_OPEN_TIMEOUT') throw e;
        console.error(e);
    }
    if (seq !== _sendOpenSeq) { hideLoading(); return; }
    hideLoading();

    const checked = { invoice: false, delivery_note: false };
    if (docType === 'invoice' || docType === 'delivery_note') checked[docType] = true;
    else if (_custUsesConsolidated(order)) checked.delivery_note = true;
    else checked.invoice = true;

    _sendSheetState = {
        orderId, custId: cust ? cust.id : null, emailLang: currentLang, bccSelf: currentOrgBccSelf,
        via: (cust && cust.email) ? 'email' : 'share', checked,
        docs: _sendBuildDocInfo(order, row), bodyText: null, bodyEdited: false, extraCc: '',
        // Даты ещё не выставленных документов (21.10): счёт — сегодня, срок — + отсрочка клиента;
        // накладная — дата заказа. Меняются плашками на странице и в «Посмотреть».
        dates: (() => {
            const today = getLocalDateStr(0);
            return { invoice: { issueDate: today, dueDate: _isoAddDays(today, _sendTermDays(cust)), dueManual: false },
                delivery_note: { issueDate: String(order.date || today).slice(0, 10) } };
        })(),
        consExisting, consCand: [], consSel: [], invKind: 'order', consOwnInv: {},
        consCalMode: 'day', consCalMonth: String(order.date || getLocalDateStr(0)).slice(0, 7), consRangeStart: null,
    };
    const stNew = _sendSheetState;
    if (!consExisting) {
        stNew.consCand = _consCandidates(order);
        if (stNew.consCand.length > 1 && order.customer_id) {
            showLoading();
            try { stNew.consOwnInv = await _sendWithTimeout(_consLoadOwnInvoices(order.customer_id)); } catch (e) { console.error(e); stNew.consOwnInv = {}; }
            hideLoading();
            if (seq !== _sendOpenSeq) return;
        }
        // По умолчанию — все ещё не включённые в счёт заказы клиента до даты этого заказа включительно,
        // кроме заказов, у которых уже есть отдельный счёт
        stNew.consSel = stNew.consCand.filter(o => o.id === orderId || (!o.cons_excluded && !stNew.consOwnInv[o.id] && String(o.date || '') <= String(order.date || ''))).map(o => o.id);
        if (!stNew.consSel.includes(orderId) && stNew.consCand.some(o => o.id === orderId)) stNew.consSel.push(orderId);
        if (_custUsesConsolidated(order) && stNew.consCand.length && !stNew.docs.invoice.issued) stNew.invKind = 'cons';
        if (!stNew.consCand.some(o => o.id === orderId)) stNew.consCand = []; // сам заказ не может быть в сводном (не подтверждён и т.п.)
    }
    _renderSendSheet();
    _showSendDocPage();
}

// ---- Страница «Отправить документ» (17.10) — в общей цепочке страниц (helpers.js: openAppPage) ----
function isSendDocPageOpen() { return typeof isAppPageOpen === 'function' && isAppPageOpen('sendDocPage'); }
function _showSendDocPage() { openAppPage('sendDocPage'); }
function _sendPageEdited() {
    const st = _sendSheetState;
    if (!st || !isSendDocPageOpen()) return false;
    const cc = document.getElementById('sendExtraCc');
    return !!(st.bodyEdited || (cc && cc.value.trim()) || (st.extraCc && st.extraCc.trim()));
}
// Уход со страницы при изменённом тексте письма — с вопросом
async function _sendPageCanLeave() {
    if (!_sendPageEdited()) return true;
    return await showConfirm(t('send_leave_confirm'));
}
_sendPageCanLeave.needed = _sendPageEdited;
(window._appPageCanLeave = window._appPageCanLeave || {}).sendDocPage = _sendPageCanLeave;
(window._appPageOnShow = window._appPageOnShow || {}).sendDocPage = () => _renderSendSheet();
// force — после успешной отправки: закрыть без вопроса
async function closeSendDocPage(force) {
    if (appPageTop() !== 'sendDocPage') return true;
    const ok = await closeAppPage(!!force);
    if (ok) _sendOpenSeq++; // недогруженная форма не откроется поверх
    return ok;
}

function toggleSendDoc(docType, on) {
    if (!_sendSheetState) return;
    _sendSheetState.checked[docType] = !!on;
    _sendSheetState.bodyEdited = false; // текст письма зависит от набора документов
    _renderSendSheet();
}

function setSendVia(via) {
    if (!_sendSheetState) return;
    _sendSheetState.via = via;
    _renderSendSheet();
}

// Переключает ЯЗЫК ПИСЬМА И ДОКУМЕНТОВ (не интерфейса): подгружает словарь выбранного
// языка при первом обращении (LT/UK и т.п. грузятся лениво) и перегенерирует текст письма.
async function selectSendEmailLang(lang) {
    if (!_sendSheetState || !AVAILABLE_LANGS.includes(lang)) return;
    await ensureLangLoaded(lang);
    _sendSheetState.emailLang = lang;
    _sendSheetState.bodyEdited = false;
    _renderSendSheet();
}

// ---- Предпросмотр: документ строится только в памяти, номер-заглушка «…» ----

function _setPreviewReadOnlyUi(on, showBanner) {
    ['sendOrderDocumentBtn', 'emailOrderDocumentBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = on ? 'none' : '';
    });
    const banner = document.getElementById('orderDocumentPreviewBanner');
    if (banner) banner.classList.toggle('hidden', !(on && showBanner));
}

async function openSendDocPreview(docType) {
    const st = _sendSheetState;
    if (!st) return;
    const order = orders.find(o => o.id === st.orderId);
    if (!order) return;
    showLoading(t('inv_generating_document'));
    try {
        let snap, persisted, consolidatedId = null;
        if (docType === 'invoice' && (st.consExisting || st.invKind === 'cons')) {
            if (st.consExisting && st.consExisting.changed) {
                const c = st.consExisting;
                if (!c.curMemberIds.length) { showInfo(t('send_cons_empty')); return; }
                snap = (await freezeConsolidatedInvoice(c.curMemberIds, st.custId, { preview: true,
                    existing: { id: c.id, number: c.rawNumber || c.snapshot.number, issueDate: c.issueDate, dueDate: c.dueDate } })).snapshot;
                // Номер прежний (баннер «номер присвоится при отправке» не нужен). Если в предпросмотре
                // поменять дату, сохранится уже обновлённый вид счёта — это то, что пекарь сейчас видит.
                persisted = true; consolidatedId = c.id;
            } else if (st.consExisting) {
                snap = st.consExisting.snapshot; persisted = true; consolidatedId = st.consExisting.id;
            } else {
                if (!st.consSel.length) { showInfo(t('send_cons_none')); return; }
                snap = (await freezeConsolidatedInvoice(st.consSel, st.custId, {
                    preview: true, issueDate: st.dates.invoice.issueDate, dueDate: st.dates.invoice.dueDate,
                })).snapshot;
                persisted = false;
            }
        } else {
            const row = await _sendLoadRow(st.orderId);
            const existing = row[snapshotField(docType)] || null;
            persisted = !!(existing && existing.number);
            snap = await freezeDocumentSnapshot(order, docType, existing, {
                preview: true, issueDate: st.dates[docType].issueDate, dueDate: st.dates[docType].dueDate,
            });
        }
        await ensureLangLoaded(st.emailLang);
        _docPreview = { docType, snapshot: snap, lang: st.emailLang, readOnly: true, persisted, orderId: st.orderId, consolidatedId };
        renderDocumentPreviewThumbnail();
        _setPreviewReadOnlyUi(true, !persisted);
        document.getElementById('orderDocumentModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
    }
}

// Кнопка «Закрыть» в предпросмотре: из формы — возвращаемся в форму (с перечитыванием
// статусов, т.к. в предпросмотре выставленного документа можно было поправить даты).
async function closeOrderDocumentModal() {
    if (_docPreview && _docPreview.fromRegistry && typeof closeRegistryDocPreview === 'function') {
        closeRegistryDocPreview();
        return;
    }
    if (_docPreview && _docPreview.readOnly && _sendSheetState) {
        document.getElementById('orderDocumentModal').style.display = 'none';
        _docPreview = null;
        _setPreviewReadOnlyUi(false, false);
        try {
            const order = orders.find(o => o.id === _sendSheetState.orderId);
            const row = await _sendLoadRow(_sendSheetState.orderId);
            if (order) _sendSheetState.docs = _sendBuildDocInfo(order, row);
            if (_sendSheetState.consExisting) {
                const fresh = await _sendLoadConsolidated(order);
                if (fresh) _sendSheetState.consExisting = fresh;
            }
        } catch (e) { console.error(e); }
        _renderSendSheet();
        return;
    }
    closeModal();
}

// ---- Отправка ----

// Текст отказа по лимитам писем на языке интерфейса (числа склоняются по форме слова).
function _sendLimitMessage(r) {
    switch (r.code) {
        case 'DAILY_LIMIT':
            return t('send_err_daily').replace('{n}', String(r.limit)).replace('{emails}', nWord(r.limit, 'word_emails'));
        case 'HOURLY_LIMIT':
            return t('send_err_hourly').replace('{n}', String(r.limit)).replace('{emails}', nWord(r.limit, 'word_emails'));
        case 'TOO_LARGE':
            return t('send_err_too_large').replace('{mb}', String(r.maxMb));
        case 'TOO_MANY_CC':
            return t('send_err_too_many_cc').replace('{n}', String(r.max)).replace('{addresses}', nWord(r.max, 'word_addresses'));
        case 'TOO_LONG':
            return t('send_err_too_long');
        default:
            return t('send_error_prefix') + (r.error || r.code);
    }
}

// Резервирует номера (если ещё не выставлены), сохраняет снимки и собирает PDF
// для всех отмеченных документов. Только здесь документ становится «выставленным».
async function _sendPrepareDocs(order, types, lang) {
    const st = _sendSheetState;
    const orderNumLabel = _sendOrderNumLabel(order);
    await ensureLangLoaded(lang);
    const out = [];
    for (const dt of types) {
        const info = st.docs[dt];
        const cons = dt === 'invoice' && (st.consExisting || st.invKind === 'cons');
        let snap, updated = !!(info && info.issued && info.changed);
        if (cons) {
            if (!st.consExisting) {
                // Выставляем сводный счёт один раз; при повторной попытке (ошибка отправки) берём уже созданный
                const r = await freezeConsolidatedInvoice(st.consSel, st.custId, st.dates.invoice);
                st.consExisting = { id: r.id, number: _formatDocNumber('invoice', r.snapshot.number), snapshot: r.snapshot,
                    issueDate: r.snapshot.issueDate, dueDate: r.snapshot.dueDate, memberIds: [...st.consSel], changed: false,
                    oldTotal: r.snapshot.consolidated.totals.grand, curTotal: r.snapshot.consolidated.totals.grand };
            }
            if (st.consExisting.changed) {
                if (!st.consExisting.curMemberIds.length) throw new Error(t('send_cons_empty'));
                const c = st.consExisting;
                const r = await freezeConsolidatedInvoice(c.curMemberIds, st.custId, {
                    existing: { id: c.id, number: c.rawNumber || c.snapshot.number, issueDate: c.issueDate, dueDate: c.dueDate } });
                c.snapshot = r.snapshot; c.memberIds = [...c.curMemberIds];
                c.oldTotal = r.snapshot.consolidated.totals.grand; c.curTotal = c.oldTotal;
                c.changed = false;
                updated = true;
            } else {
                updated = false;
            }
            snap = st.consExisting.snapshot;
        } else {
            snap = await _reserveDocSnapshot(order, dt, st.dates[dt]);
        }
        const num = _formatDocNumber(dt, snap.number);
        const pdf = await buildDocumentPdf(dt, snap, lang);
        out.push({ dt, snap, num, updated, cons: !!cons, pdf, filename: _sendAttachmentName(dt, lang, num, orderNumLabel) });
    }
    return out;
}

async function submitSendDocument() {
    const st = _sendSheetState;
    if (!st) return;
    const order = orders.find(o => o.id === st.orderId);
    const cust = st.custId ? customers.find(c => c.id === st.custId) : null;
    if (!order) return;
    const types = _sendCheckedTypes();
    if (!types.length) { showInfo(t('send_need_one_doc')); return; }
    if (st.via === 'share') return _sendByShare(order, types);
    if (!cust || !cust.email) return;

    // Разбираем "Дополнительные получатели" (через запятую) — валидируем на
    // клиенте, чтобы сразу подсказать про опечатку, а не после похода на сервер.
    const extraCcRaw = (document.getElementById('sendExtraCc')?.value || '').trim();
    const extraCc = extraCcRaw ? extraCcRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidCc = extraCc.filter(e => !emailRe.test(e));
    if (invalidCc.length) {
        showInfo(t('send_extra_cc_invalid') + ' ' + invalidCc.join(', '));
        return;
    }

    const btn = document.getElementById('sendDocSubmitBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));

    try {
        const lang = st.emailLang;
        const prepared = await _sendPrepareDocs(order, types, lang);
        prepared.forEach(p => { p.b64 = p.pdf.output('datauristring').split(',')[1]; });

        // Текст письма (bodyText) НЕ пересобираем — берём как есть из textarea,
        // чтобы не затереть возможные ручные правки пекаря.
        // Заглушки «INV-…» / «DN-…» заменяем номерами, присвоенными при отправке (21.10)
        let bodyText = document.getElementById('sendEmailBody').value;
        prepared.forEach(p => { bodyText = bodyText.split(_formatDocNumber(p.dt, '…')).join(p.num); });
        const subject = _sendBuildSubject(prepared, lang, currentOrgName || '');

        const payload = {
            orgId: currentOrgId,
            recipientEmail: cust.email,
            subject, bodyText,
            senderName: currentOrgName || '',
            bccSelf: !!st.bccSelf,
            extraCc,
        };
        // Один документ — прежний формат (работает и со старой версией серверной функции).
        // Два — список вложений: старая функция такой запрос отклонит, а не отправит неполное письмо.
        if (prepared.length === 1) {
            payload.pdfBase64 = prepared[0].b64;
            payload.pdfFilename = prepared[0].filename;
        } else {
            payload.attachments = prepared.map(p => ({ filename: p.filename, pdfBase64: p.b64 }));
        }

        const { data: result, error: fnError } = await db.functions.invoke('send-document-email', { body: payload });
        if (fnError) throw fnError;
        // Отказ по лимитам: сервер отвечает success:false и кодом (см. send-document-email).
        if (result && !result.success && result.code) {
            showInfo(_sendLimitMessage(result));
            return;
        }
        if (!result || !result.success) throw new Error((result && result.error) || 'send failed');

        for (const p of prepared) {
            await _recordSentFor(order.id, p, 'email', result.id);
            const docLabel = p.dt === 'invoice' ? t('orders_doc_invoice') : t('orders_doc_delivery_note');
            logActivity('order', `${docLabel} ${p.num} ${t('log_doc_email_sent')} (${cust.email})`, order.id);
        }
        closeSendDocPage(true);
        showInfo(t('send_success'));
    } catch (e) {
        console.error(e);
        showInfo(t('send_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

// Сводный счёт считается отправленным по каждому включённому заказу.
async function _recordSentFor(orderId, p, via, messageId) {
    const st = _sendSheetState;
    if (p.cons && st && st.consExisting) {
        const ids = (st.consExisting.memberIds && st.consExisting.memberIds.length) ? st.consExisting.memberIds : [orderId];
        for (const id of ids) await recordDocumentSent(id, 'invoice', via, messageId);
        return;
    }
    await recordDocumentSent(orderId, p.dt, via, messageId);
}

// «PDF / мессенджер»: все отмеченные документы одним вызовом системного меню «Поделиться».
async function _sendByShare(order, types) {
    const st = _sendSheetState;
    const btn = document.getElementById('sendDocSubmitBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    showLoading(t('customers_pdf_generating'));
    try {
        const prepared = await _sendPrepareDocs(order, types, st.emailLang);
        const files = prepared.map(p => new File([p.pdf.output('blob')], p.filename, { type: 'application/pdf' }));
        let shared = false;
        if (navigator.canShare && navigator.canShare({ files })) {
            try { await navigator.share({ files, title: files[0].name }); shared = true; }
            catch (e) { /* закрыли меню или браузер отклонил — сохраняем файлы на устройство ниже */ }
        }
        if (shared) {
            for (const p of prepared) {
                await _recordSentFor(order.id, p, 'share');
                const docLabel = p.dt === 'invoice' ? t('orders_doc_invoice') : t('orders_doc_delivery_note');
                logActivity('order', `${docLabel} ${p.num} ${t('log_doc_shared')}`, order.id);
            }
            closeSendDocPage(true);
        } else {
            prepared.forEach(p => p.pdf.save(p.filename));
            await showInfo(`${t('common_done')}: ${t('send_share_saved')}`);
        }
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')) + t('customers_pdf_error_suffix'));
    } finally {
        hideLoading();
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
}

// ---- Мини-редактор email клиента (открывается по «изменить» / «Добавить e-mail») ----

function openEmailQuickEdit(custId) {
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;
    document.getElementById('emailQuickEditInput').value = cust.email || '';
    const modal = document.getElementById('emailQuickEditModal');
    modal.dataset.custId = custId;
    modal.style.zIndex = '170'; // выше нижней шторки отправки (z-index 160)
    modal.style.display = 'flex';
}

async function saveEmailQuickEdit() {
    const modal = document.getElementById('emailQuickEditModal');
    const custId = Number(modal.dataset.custId);
    const value = document.getElementById('emailQuickEditInput').value.trim();
    const cust = customers.find(c => c.id === custId);
    if (!cust) return;

    suppressRealtimeFor3s();
    showLoading();
    try {
        await updateChecked(db.from('customers').update({ email: value || null }).eq('id', custId));
        cust.email = value || null;
        modal.style.display = 'none';
        if (_sendSheetState && _sendSheetState.custId === custId) {
            // Форма остаётся открытой, выбранные документы и набранное сохраняются
            if (value) _sendSheetState.via = 'email';
            _renderSendSheet();
        } else {
            closeModal();
        }
    } catch (e) {
        console.error(e);
        showInfo(t('error_save_check_connection'));
    } finally {
        hideLoading();
    }
}

function closeEmailQuickEdit() {
    document.getElementById('emailQuickEditModal').style.display = 'none';
}
