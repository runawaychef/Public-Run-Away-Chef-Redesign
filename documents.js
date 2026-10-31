// ==================== РАЗДЕЛ «ДОКУМЕНТЫ» ====================
// Единый список выставленных документов: счета по заказу (INV), накладные (DN) и сводные
// счета (INV со значком стопки). Документы живут в двух местах: orders.invoice_snapshot /
// delivery_note_snapshot и таблица consolidated_invoices — здесь они собираются в один список.
// Для скорости из снимков берутся только номер, дата и состав (без логотипа и реквизитов);
// полный снимок загружается при открытии документа.
// Документы удалённых (в корзине) заказов остаются в списке с пометкой — номер уже использован.
// Входы: кнопка в верхнем ряду раздела «Заказы», ссылка в форме «Документ», кнопка в карточке клиента.
// Зависит от: db, currentOrgId, orders, customers, fetchAllRows (index.html), orderGrandTotal,
//             calcTotals (money.js), getOrderPaymentStatus (orders.js), documentTotals,
//             renderDocumentPreviewThumbnail (invoice.js), _formatDocNumber, openSendDocumentSheet,
//             _formatSentDateTime (send-document.js), formatMoney, formatDateDMY, escapeHtml, t.

let _docsStatus = 'wait'; // плитка-статус во «Выставлено»: wait | over | unsent | paid (30.10.2026)
let _docsTab = 'todo';   // вкладка страницы: 'todo' — «К выставлению» (заказы без счёта), 'issued' — «Выставлено» (30.10.2026)
let _docsAll = [];      // все документы организации (после загрузки)
// year: 'YYYY' или null (все годы); month: 'MM' или null (весь год)
let _docsFilter = { type: 'all', custId: null, year: null, month: null, pay: '', q: '' };

const _DOCS_TYPE_STYLE = {
    inv:  'background:#e9eee5; color:#4f6349;',
    dn:   'background:#f1eee3; color:#6b675d;',
    cons: 'background:#dbe4d3; color:#3f5a38;',
};
const _DOCS_PAY_STYLE = {
    paid:    'background:#e3e8df; color:#4f6349;',
    partial: 'background:#f7e6c4; color:#96712a;',
    unpaid:  'background:#f3ded9; color:#a3493d;',
};

function _docsCustName(custId, fallback) {
    const c = custId ? customers.find(x => x.id === custId) : null;
    return (c && c.name) || fallback || t('orders_no_customer');
}

// Сумма документа удалённого заказа — из его снимка (в загруженном списке заказов его нет)
function _docsSnapGrandC(orderPart, calc, vatRate) {
    if (!orderPart) return null;
    try {
        return Math.round(documentTotals({ order: orderPart, calc, vat_rate: vatRate }).grandAll * 100);
    } catch (e) { return null; }
}

async function _docsLoad() {
    const [ordRes, consRes] = await Promise.all([
        fetchAllRows(() => db.from('orders')
            .select('id, customer_id, order_number, order_date, deleted_at, consolidated_invoice_id, invoice_sent_at, invoice_sent_via, delivery_note_sent_at, delivery_note_sent_via, invoice_delivery_status, delivery_note_delivery_status, '
                + 'inv:invoice_snapshot->>number, invDate:invoice_snapshot->>issueDate, invDue:invoice_snapshot->>dueDate, invOrder:invoice_snapshot->order, invCalc:invoice_snapshot->calc, invVat:invoice_snapshot->vat_rate, '
                + 'dn:delivery_note_snapshot->>number, dnDate:delivery_note_snapshot->>issueDate, dnOrder:delivery_note_snapshot->order, dnCalc:delivery_note_snapshot->calc, dnVat:delivery_note_snapshot->vat_rate')
            .eq('org_id', currentOrgId)
            .or('invoice_snapshot.not.is.null,delivery_note_snapshot.not.is.null')
            .order('id')),
        fetchAllRows(() => db.from('consolidated_invoices')
            .select('id, number, issue_date, due_date, customer_id, cancelled_at, grand:snapshot->consolidated->totals->>grand, members:snapshot->consolidated->orders')
            .eq('org_id', currentOrgId)
            .order('id')),
    ]);
    if (ordRes.error) throw ordRes.error;
    if (consRes.error) throw consRes.error;

    const list = [];
    const sentByCons = {}; // { consId: последняя отметка «отправлено» среди заказов счёта }
    (ordRes.data || []).forEach(r => {
        const live = orders.find(o => o.id === r.id) || null;
        const deleted = !!r.deleted_at;
        const custName = live ? (live.customer || _docsCustName(r.customer_id)) : _docsCustName(r.customer_id);
        const base = { orderId: r.id, orderNumber: r.order_number || null, custId: r.customer_id || null, custName, deleted, live };
        if (r.consolidated_invoice_id && r.invoice_sent_at) {
            const prev = sentByCons[r.consolidated_invoice_id];
            if (!prev || r.invoice_sent_at > prev.at) sentByCons[r.consolidated_invoice_id] = { at: r.invoice_sent_at, via: r.invoice_sent_via, status: r.invoice_delivery_status || null };
        }
        if (r.inv) {
            const pay = live ? getOrderPaymentStatus(live).status : null;
            list.push(Object.assign({}, base, {
                key: 'inv-' + r.id, kind: 'inv', docType: 'invoice', rawNumber: r.inv,
                number: _formatDocNumber('invoice', r.inv), date: r.invDate || r.order_date || '', due: r.invDue || null,
                sumC: live ? Math.round(orderGrandTotal(live) * 100) : _docsSnapGrandC(r.invOrder, r.invCalc, r.invVat),
                pay, sentAt: r.invoice_sent_at || null, sentVia: r.invoice_sent_via || null, delivery: r.invoice_delivery_status || null,
            }));
        }
        if (r.dn) {
            list.push(Object.assign({}, base, {
                key: 'dn-' + r.id, kind: 'dn', docType: 'delivery_note', rawNumber: r.dn,
                number: _formatDocNumber('delivery_note', r.dn), date: r.dnDate || r.order_date || '',
                sumC: live ? Math.round(orderGrandTotal(live) * 100) : _docsSnapGrandC(r.dnOrder, r.dnCalc, r.dnVat),
                pay: null, sentAt: r.delivery_note_sent_at || null, sentVia: r.delivery_note_sent_via || null, delivery: r.delivery_note_delivery_status || null,
            }));
        }
    });

    (consRes.data || []).forEach(c => {
        const memberInfos = Array.isArray(c.members) ? c.members : [];
        // Текущий состав счёта — заказы, которые сейчас в нём числятся (из загруженного списка)
        const liveMembers = orders.filter(o => o.consolidated_invoice_id === c.id);
        let pay = null;
        if (!c.cancelled_at && liveMembers.length) {
            let remC = 0, paidC = 0;
            liveMembers.forEach(o => {
                const g = Math.round(orderGrandTotal(o) * 100);
                const p = Math.round(((typeof _orderPaidTotals !== 'undefined' && _orderPaidTotals[o.id]) || 0) * 100);
                remC += Math.max(0, g - p); paidC += Math.min(p, g);
            });
            pay = remC <= 0 ? 'paid' : (paidC > 0 ? 'partial' : 'unpaid');
        }
        const sent = sentByCons[c.id] || null;
        list.push({
            key: 'cons-' + c.id, kind: 'cons', docType: 'invoice', consId: c.id, rawNumber: c.number,
            number: _formatDocNumber('invoice', c.number), date: c.issue_date || '', due: c.due_date || null,
            custId: c.customer_id || null, custName: _docsCustName(c.customer_id),
            sumC: c.grand != null ? Math.round(Number(c.grand) * 100) : null,
            pay, cancelled: !!c.cancelled_at, memberCount: liveMembers.length || memberInfos.length,
            memberIds: liveMembers.map(o => o.id), liveMemberId: liveMembers.length ? liveMembers[0].id : null,
            sentAt: sent ? sent.at : null, sentVia: sent ? sent.via : null, delivery: sent ? sent.status : null,
        });
    });

    list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.rawNumber).localeCompare(String(a.rawNumber)));
    _docsAll = list;
}

// opts: { custId } — открыть сразу с фильтром по клиенту (тогда период — за всё время)
async function openDocumentsSection(opts) {
    const custId = opts && opts.custId ? opts.custId : null;
    const today = getLocalDateStr(0);
    _docsStatus = 'wait';
    // Из карточки клиента — весь текущий год, иначе текущий месяц
    // По умолчанию — счета (обычные и сводные вместе)
    _docsFilter = { type: 'inv', custId, year: null, month: null, pay: '', q: '' }; // период — «Всё время»: неоплаченные счета не должны прятаться
    const q = document.getElementById('docsSearch');
    if (q) q.value = '';
    _docsTab = (!custId && _docsTodoOrders().length) ? 'todo' : 'issued';
    showLoading();
    try {
        await _docsLoad();
    } catch (e) {
        console.error('Документы: ошибка загрузки', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    openAppPage('docsPage'); // страница поверх раздела (helpers.js), «Назад» — на шаг назад
    renderDocumentsSection();
}
(window._appPageOnShow = window._appPageOnShow || {}).docsPage = () => renderDocumentsSection();

function closeDocumentsSection() {
    if (typeof appPageTop === 'function' && appPageTop() === 'docsPage') closeAppPage();
}

function setDocsFilter(field, value) {
    if (field === 'custId') value = value ? Number(value) : null;
    if (field === 'period') { // одно поле «ГГГГ-ММ» или пусто
        _docsFilter.year = value ? value.slice(0, 4) : null;
        _docsFilter.month = value ? value.slice(5, 7) : null;
    } else {
        if (field === 'month' || field === 'year') value = value || null;
        _docsFilter[field] = value;
    }
    renderDocumentsSection();
}

function setDocsStatus(st) {
    _docsStatus = st;
    renderDocumentsSection();
}

function _docsMonthLabel(ym) {
    if (!ym) return t('docs_period_all');
    const [y, m] = ym.split('-').map(Number);
    const name = new Date(y, m - 1, 1).toLocaleDateString(typeof currentLang !== 'undefined' ? currentLang : 'en', { month: 'long' });
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
}

// Для поиска: нижний регистр, без пробелов, дефисов и кавычек — «20260012» находит INV-2026-0012
function _docsNorm(s) {
    return String(s || '').toLowerCase().replace(/[\s\-–—_.«»"'№#]/g, '');
}

// Название месяца в именительном падеже: «Октябрь»
function _docsMonthName(mm) {
    const name = new Date(2000, Number(mm) - 1, 1).toLocaleDateString(typeof currentLang !== 'undefined' ? currentLang : 'en', { month: 'long' });
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function _docsFiltered() {
    const f = _docsFilter;
    const q = _docsNorm(f.q);
    return _docsAll.filter(d => {
        if (f.type === 'inv' && d.kind === 'dn') return false; // «Счета» — обычные и сводные
        if (f.type === 'dn' && d.kind !== 'dn') return false;
        if (f.custId && d.custId !== f.custId) return false;
        const date = String(d.date);
        // Пока идёт поиск — по всему времени (период не учитывается)
        if (!q) {
            if (f.year && date.slice(0, 4) !== f.year) return false;
            if (f.month && date.slice(5, 7) !== f.month) return false;
        }
        if (f.pay && d.pay !== f.pay) return false;
        if (q && !(_docsNorm(d.number).includes(q) || _docsNorm(d.custName).includes(q) || _docsNorm(d.orderNumber).includes(q))) return false;
        return true;
    });
}

// Значок отправки — тот же, что в карточках заказов (конверт с галочкой): серый — отправлен,
// синеватый — письмо доставлено, красный — письмо не дошло; без значка — не отправлялся.
function _docsSentState(d) {
    if (!d.sentAt) return null;
    if (d.delivery === 'bounced' || d.delivery === 'complained') return 'alarm';
    if (d.delivery === 'delivered') return 'delivered';
    return 'neutral';
}

function _docsSentIcon(d) {
    const state = _docsSentState(d);
    if (!state) return '<span style="width:22px; flex:none;"></span>';
    return `<svg class="oc-sent-icon oc-sent-icon--${state}" style="margin-left:0; flex:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" onclick="event.stopPropagation(); showDocSentInfo('${d.key}')"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h9a2.25 2.25 0 012.25 2.25v5.25M2.25 6.75v7.5A2.25 2.25 0 004.5 16.5h5.25M2.25 6.75L9 11.69a1.5 1.5 0 001.76 0L15.75 8.4"/><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 16.5l2.25 2.25 4.5-4.5"/></svg>`;
}

function showDocSentInfo(key) {
    const d = _docsAll.find(x => x.key === key);
    if (!d || !d.sentAt) return;
    const label = d.kind === 'dn' ? t('orders_doc_delivery_note') : (d.kind === 'cons' ? t('send_cons_invoice') : t('orders_doc_invoice'));
    const status = d.sentVia === 'email' && d.delivery ? ` — ${_deliveryStatusLabel(d.delivery)}` : '';
    showInfo(`${label} ${d.number}: ${_sentViaLabel(d.sentVia)}, ${_formatSentDateTime(d.sentAt)}${status}`);
}

function _docsSelect(field, value, options) {
    const opts = options.map(o => `<option value="${escapeHtml(String(o.v))}" ${String(o.v) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(o.l)}</option>`).join('');
    return `<select onchange="setDocsFilter('${field}', this.value)" style="font-size:12px; border-radius:999px; padding:5px 10px; background:#fff; border:1px solid #e3ddcc; color:#4f6349; max-width:100%;">${opts}</select>`;
}

// ---- Вкладка «К выставлению» (30.10.2026): заказы без счёта, по клиентам ----
function _docsTodoOrders() {
    // Если страницу открыли из карточки клиента — только заказы этого клиента (31.10.2026)
    const cid = _docsFilter && _docsFilter.custId ? Number(_docsFilter.custId) : null;
    return (typeof orders !== 'undefined' ? orders : []).filter(o => typeof orderNeedsInvoice === 'function' && orderNeedsInvoice(o)
        && (!cid || Number(o.customer_id) === cid));
}

function setDocsTab(tab) {
    _docsTab = tab;
    renderDocumentsSection();
}

function _docsTabsHtml() {
    const n = _docsTodoOrders().length;
    return `<div class="cd-seg" style="margin:8px 0 10px;">
        <button type="button" class="${_docsTab === 'todo' ? 'active' : ''}" onclick="setDocsTab('todo')">${escapeHtml(t('docs_tab_todo'))}${n ? ' · ' + n : ''}</button>
        <button type="button" class="${_docsTab === 'issued' ? 'active' : ''}" onclick="setDocsTab('issued')">${escapeHtml(t('docs_tab_issued'))}</button></div>`;
}

function docsIssueInvoice(orderId, cons) {
    openSendDocumentSheet(orderId, 'invoice', cons ? { preferCons: true } : undefined);
}

function _docsRenderTodo(box) {
    const q = _docsNorm(_docsFilter.q);
    const byCust = new Map();
    _docsTodoOrders().forEach(o => {
        const name = o.customer || t('orders_no_customer');
        if (q && !(_docsNorm(name).includes(q) || _docsNorm(o.order_number).includes(q))) return;
        const yr = String(o.date || '').slice(0, 4); // сводный счёт — только из заказов одного года (31.10.2026)
        const key = (o.customer_id || ('n:' + name)) + '|' + yr;
        const g = byCust.get(key) || { name, yr, orders: [], sumC: 0 };
        g.orders.push(o);
        g.sumC += Math.round(orderGrandTotal(o) * 100);
        byCust.set(key, g);
    });
    const groups = [...byCust.values()];
    groups.forEach(g => g.orders.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.id - a.id)));
    groups.sort((a, b) => String(b.orders[0].date || '').localeCompare(String(a.orders[0].date || '')));
    // Если у клиента заказы нескольких лет — к имени добавляется год
    const yrsByName = {};
    groups.forEach(g => { (yrsByName[g.name] = yrsByName[g.name] || new Set()).add(g.yr); });
    groups.forEach(g => { g.title = yrsByName[g.name].size > 1 && g.yr ? g.name + ' · ' + g.yr : g.name; });
    let html = _docsTabsHtml();
    // С 15 декабря — напоминание о заказах текущего года без документа (31.10.2026)
    const nowD = orgNowDate();
    if (nowD.getMonth() === 11 && nowD.getDate() >= 15) {
        const left = _docsTodoOrders().filter(o => String(o.date || '').slice(0, 4) === String(nowD.getFullYear())).length;
        if (left) html += `<div style="background:#f7efdc; color:#8a6a24; border-radius:12px; padding:8px 10px; font-size:12.5px; font-weight:600; margin:0 0 10px;">${escapeHtml(t('docs_year_end_banner').replace('{n}', left))}</div>`;
    }
    if (!groups.length) {
        html += `<p style="font-size:13px; color:#9a9488; margin:16px 0; text-align:center;">${escapeHtml(t('docs_todo_empty'))}</p>`;
    } else {
        groups.forEach(g => {
            const consBtn = g.orders.length > 1
                ? `<button type="button" onclick="docsIssueInvoice(${g.orders[0].id}, true)" style="font-size:12px; font-weight:700; border-radius:12px; padding:0 12px; height:30px; background:#7c9473; color:#fff; border:0; white-space:nowrap;">${escapeHtml(t('docs_todo_issue'))}</button>` : '';
            const rows = g.orders.map(o => `<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid #ebe6d8;">
                <div onclick="registryOpenOrder(${o.id})" style="flex:1; min-width:0; font-size:13px; color:#3c3a34; cursor:pointer;">${formatDateDMY(o.date)}${o.order_number ? ' · №' + escapeHtml(o.order_number) : ''}</div>
                <div style="font-size:13px; font-weight:700; color:#3c3a34;">${formatMoney(orderGrandTotal(o))}</div>
                <button type="button" onclick="docsIssueInvoice(${o.id}, false)" style="font-size:12px; font-weight:700; border-radius:12px; padding:0 10px; height:28px; background:#fff; color:#4f6349; border:1px solid #cfd8c8;">${escapeHtml(t('docs_todo_issue_short'))}</button></div>`).join('');
            html += `<div style="background:#f6f4ec; border-radius:12px; padding:8px 10px 2px; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;"><div style="flex:1; min-width:0;">
                    <div style="font-size:13.5px; font-weight:700; color:#3c3a34;">${escapeHtml(g.title)}</div>
                    <div style="font-size:12px; color:#888;">${escapeHtml(g.orders.length + ' ' + nWord(g.orders.length, 'word_orders'))} · ${formatMoney(g.sumC / 100)}</div></div>${consBtn}</div>${rows}</div>`;
        });
        html += `<div style="font-size:11.5px; color:#9a9488; margin:4px 2px 8px;">${escapeHtml(t('docs_todo_hint'))}</div>`;
    }
    box.innerHTML = html;
}

// Статус счёта для плиток (DN и отменённые — вне плиток; находятся поиском)
function _docsInvStatus(d, today) {
    if (d.kind === 'dn' || d.cancelled || d.deleted) return null;
    if (d.pay === 'paid') return { paid: true };
    if (d.pay !== 'unpaid' && d.pay !== 'partial') return null;
    const over = !!d.due && d.due < today;
    return { wait: true, over, unsent: !d.sentAt };
}
function _docsStatusMatch(st, status) {
    if (!st) return false;
    if (status === 'paid') return !!st.paid;
    return !!st[status];
}
function _docsShortDate(iso) {
    const dt = new Date(iso);
    if (isNaN(dt)) return '';
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
function _docsDayDiff(fromIso, toIso) {
    return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

function _docsTile(label, n, sumC, status, red) {
    const act = _docsStatus === status && !_docsNorm(_docsFilter.q);
    const bd = act ? 'border:2px solid #7c9473; background:#eef2ea;' : 'border:1px solid #e3ddcc; background:#fff;';
    const col = red && n ? '#a3493d' : '#3c3a34';
    return `<div onclick="setDocsStatus('${status}')" style="${bd} border-radius:14px; padding:${act ? 7 : 8}px ${act ? 9 : 10}px; cursor:pointer;">
        <div style="font-size:11.5px; color:#6b675d;">${escapeHtml(label)}</div>
        <div style="display:flex; align-items:baseline; gap:6px;"><span style="font-size:20px; font-weight:700; color:${col};">${n}</span>${sumC != null ? `<span style="font-size:12px; color:#6b675d;">${formatMoney(sumC / 100)}</span>` : ''}</div></div>`;
}

function _docsInvNumberOfOrder(orderId) {
    const inv = _docsAll.find(x => x.kind === 'inv' && x.orderId === orderId && !x.cancelled);
    if (inv) return t('docs_dn_inv').replace('{n}', inv.number);
    const cons = _docsAll.find(x => x.kind === 'cons' && !x.cancelled && (x.memberIds || []).includes(orderId));
    if (cons) return t('docs_dn_in_cons').replace('{n}', cons.number);
    return t('docs_dn_no_inv');
}

function renderDocumentsSection() {
    const box = document.getElementById('docsBody');
    if (!box) return;
    if (_docsTab === 'todo') { _docsRenderTodo(box); return; }
    const f = _docsFilter;
    const q = _docsNorm(f.q);
    const today = getLocalDateStr(0);
    const isDn = f.type === 'dn';

    const custIds = [...new Set(_docsAll.map(d => d.custId).filter(Boolean))];
    if (f.custId && !custIds.includes(f.custId)) custIds.push(f.custId); // у клиента ещё нет документов — всё равно показать его в списке
    const custOpts = [{ v: '', l: t('docs_customer_all') }].concat(
        custIds.map(id => ({ v: id, l: _docsCustName(id) })).sort((a, b) => a.l.localeCompare(b.l)));
    const yms = [...new Set(_docsAll.map(d => String(d.date).slice(0, 7)).filter(y => /^\d{4}-\d{2}$/.test(y)))];
    const curYm = f.year && f.month ? f.year + '-' + f.month : '';
    if (curYm && !yms.includes(curYm)) yms.push(curYm);
    yms.sort().reverse();
    const periodOpts = [{ v: '', l: t('docs_period_all') }].concat(yms.map(ym => ({ v: ym, l: _docsMonthLabel(ym) })));

    const sel = `${_docsSelect('custId', f.custId || '', custOpts)}${_docsSelect('period', curYm, periodOpts)}`;
    const btnStyle = 'font-size:12px; border-radius:999px; padding:5px 10px; background:#fff; border:1px solid #e3ddcc; color:#4f6349; cursor:pointer;';

    let head = '', rows = '';
    const all = _docsFiltered();
    const buildRow = d => {
        const sum = d.sumC != null ? formatMoney(d.sumC / 100) : '—';
        const dim = (d.cancelled || d.deleted) ? 'opacity:.55;' : '';
        const gold = txt => `<b style="color:#96712a;">${escapeHtml(txt)}</b>`;
        if (d.kind === 'dn') {
            const sub = [escapeHtml(d.number || '—'), formatDateDMY(d.date)];
            if (d.orderNumber) sub.push(escapeHtml(t('docs_order_n').replace('{n}', d.orderNumber)));
            return `<div onclick="openRegistryDoc('${d.key}')" style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #f0ebde; cursor:pointer; ${dim}">
                <div style="flex:1; min-width:0;"><div style="font-size:14px; font-weight:700; color:#3c3a34;">${escapeHtml(d.custName)}</div>
                    <div style="font-size:12px; color:#888;">${sub.join(' · ')}</div>
                    <div style="font-size:11.5px; margin-top:2px; color:#9a9488;">${escapeHtml(_docsInvNumberOfOrder(d.orderId))}</div></div>
                ${_docsSentIcon(d)}
                <div style="text-align:right; flex:none; font-size:14px; font-weight:700; color:#3c3a34;">${sum}</div></div>`;
        }
        const sub = [escapeHtml(d.number || '—'), formatDateDMY(d.date)];
        if (d.kind === 'cons') sub.push(escapeHtml(`${t('docs_cons_short')}, ${d.memberCount} ${nWord(d.memberCount, 'word_orders')}`));
        else if (d.orderNumber) sub.push(escapeHtml(t('docs_order_n').replace('{n}', d.orderNumber)));
        if (d.cancelled) sub.push(escapeHtml(t('docs_cancelled')));
        else if (d.deleted) sub.push(escapeHtml(t('docs_order_deleted')));
        let sentLine = '';
        if (d.sentAt) {
            const st = _docsSentState(d);
            sentLine = st === 'alarm'
                ? `<b style="color:#a3493d;">${escapeHtml(t('docs_mail_failed'))}</b>`
                : escapeHtml(t('docs_sent_on').replace('{d}', _docsShortDate(d.sentAt)));
        } else if (!d.cancelled && !d.deleted && d.pay !== 'paid') {
            sentLine = gold(t('docs_not_sent_cap'));
        }
        if (d.pay === 'partial') sentLine += (sentLine ? ' · ' : '') + gold(t('docs_partial'));
        let right = '';
        if (d.pay === 'paid') right = `<div style="font-size:12px; font-weight:600; color:#4f6349;">${escapeHtml(t('pay_status_paid'))}</div>`;
        else if ((d.pay === 'unpaid' || d.pay === 'partial') && d.due) {
            right = d.due < today
                ? `<div style="font-size:12px; font-weight:600; color:#a3493d;">${escapeHtml(t('docs_overdue_days').replace('{n}', _docsDayDiff(d.due, today)))}</div>`
                : `<div style="font-size:12px; font-weight:600; color:#6b675d;">${escapeHtml(t('docs_due_till').replace('{d}', _docsShortDate(d.due + 'T12:00:00')))}</div>`;
        }
        return `<div onclick="openRegistryDoc('${d.key}')" style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid #f0ebde; cursor:pointer; ${dim}">
            <div style="flex:1; min-width:0;"><div style="font-size:14px; font-weight:700; color:#3c3a34;">${escapeHtml(d.custName)}</div>
                <div style="font-size:12px; color:#888;">${sub.join(' · ')}</div>
                ${sentLine ? `<div style="font-size:11.5px; margin-top:2px; color:#9a9488;">${sentLine}</div>` : ''}</div>
            <div style="text-align:right; flex:none;"><div style="font-size:14px; font-weight:700; color:#3c3a34; ${d.cancelled ? 'text-decoration:line-through;' : ''}">${sum}</div>${right}</div></div>`;
    };
    const withMonths = arr => {
        let out = '', last = null;
        arr.forEach(d => {
            const ym = String(d.date).slice(0, 7);
            if (ym !== last) { out += `<div style="font-size:12px; color:#9a9488; margin:12px 0 2px;">${escapeHtml(_docsMonthLabel(ym))}</div>`; last = ym; }
            out += buildRow(d);
        });
        return out;
    };

    let list;
    if (isDn) {
        head = `<div style="display:flex; align-items:center; gap:8px; margin:6px 0 8px;">
            <span onclick="setDocsFilter('type','inv')" style="font-size:13px; color:#4f6349; font-weight:600; cursor:pointer;">‹ ${escapeHtml(t('docs_back_inv'))}</span>
            <span style="flex:1; text-align:center; font-size:13px; color:#3c3a34; font-weight:700; padding-right:48px;">${escapeHtml(t('docs_type_dn'))}</span></div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${sel}</div>`;
        list = all;
        rows = withMonths(list);
    } else {
        // Плитки считаются по клиенту и периоду, но не по самому статусу
        const sts = all.map(d => ({ d, st: _docsInvStatus(d, today) }));
        const cnt = status => { const a = sts.filter(x => _docsStatusMatch(x.st, status)); return { n: a.length, sumC: a.reduce((s, x) => s + (x.d.sumC || 0), 0) }; };
        const cw = cnt('wait'), co = cnt('over'), cu = cnt('unsent'), cp = cnt('paid');
        const tiles = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0 10px;">
            ${_docsTile(t('docs_tile_wait'), cw.n, cw.sumC, 'wait')}${_docsTile(t('docs_tile_over'), co.n, co.sumC, 'over', true)}
            ${_docsTile(t('docs_tile_unsent'), cu.n, cu.sumC, 'unsent')}${_docsTile(t('docs_tile_paid'), cp.n, null, 'paid')}</div>`;
        head = `${tiles}<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${sel}
            <button type="button" onclick="setDocsFilter('type','dn')" style="margin-left:auto; ${btnStyle}">${escapeHtml(t('docs_type_dn'))} ›</button></div>`;
        if (q) {
            list = all.filter(d => d.kind !== 'dn');
            rows = withMonths(list);
        } else {
            list = sts.filter(x => _docsStatusMatch(x.st, _docsStatus)).map(x => x.d);
            if (_docsStatus === 'paid') rows = withMonths(list);
            else {
                list.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.date).localeCompare(String(b.date)));
                rows = list.map(buildRow).join('');
            }
        }
    }
    if (!list.length) rows = `<p style="font-size:13px; color:#9a9488; margin:16px 0; text-align:center;">${escapeHtml(t('docs_empty'))}</p>`;
    box.innerHTML = `${_docsTabsHtml()}${head}<div>${rows}</div>`;
}

// ---- Открытие документа из списка ----

let _docsOpenEntry = null;

async function openRegistryDoc(key) {
    const d = _docsAll.find(x => x.key === key);
    if (!d) return;
    _docsTab = 'issued';
    showLoading(t('docs_opening'));
    try {
        let snapshot, consolidatedId = null;
        if (d.kind === 'cons') {
            const { data, error } = await db.from('consolidated_invoices').select('snapshot').eq('id', d.consId).single();
            if (error) throw error;
            snapshot = data && data.snapshot;
            consolidatedId = d.consId;
        } else {
            const field = snapshotField(d.docType);
            const { data, error } = await db.from('orders').select(field).eq('id', d.orderId).single();
            if (error) throw error;
            snapshot = data && data[field];
        }
        if (!snapshot) throw new Error(t('inv_unknown_error'));
        _docsOpenEntry = d;
        _docPreview = { docType: d.docType, snapshot, lang: currentLang, readOnly: true, persisted: true,
            orderId: d.orderId || d.liveMemberId || null, consolidatedId, fromRegistry: true };
        if (typeof _setPreviewReadOnlyUi === 'function') _setPreviewReadOnlyUi(true, false);
        renderDocumentPreviewThumbnail();
        document.getElementById('orderDocumentModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo(t('inv_doc_error_prefix') + (e && e.message ? e.message : t('inv_unknown_error')));
    } finally {
        hideLoading();
    }
}

// Кнопки под документом, открытым из списка (вызывается из renderDocumentPreviewThumbnail)
function renderRegistryDocActions() {
    const box = document.getElementById('docRegistryActions');
    if (!box) return;
    const d = _docsOpenEntry;
    if (!_docPreview || !_docPreview.fromRegistry || !d) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const sendOrderId = d.kind === 'cons' ? d.liveMemberId : (d.live ? d.orderId : null);
    let html = '<div class="flex gap-2 flex-wrap">';
    if (sendOrderId && !d.cancelled) html += `<button onclick="registrySendDoc()" class="pill-btn flex-1 justify-center">${escapeHtml(t('docs_send'))}</button>`;
    if (d.kind !== 'cons' && d.live) html += `<button onclick="registryOpenOrder(${d.orderId})" class="pill-btn-secondary flex-1 justify-center">${escapeHtml(t('docs_open_order'))}</button>`;
    html += '</div>';
    if (d.kind === 'cons' && d.memberIds.length) {
        html += `<div style="font-size:12px; color:#6b675d; margin:10px 0 4px;">${escapeHtml(t('send_cons_member'))}</div>`;
        html += d.memberIds.map(id => {
            const o = orders.find(x => x.id === id);
            if (!o) return '';
            return `<div onclick="registryOpenOrder(${id})" style="display:flex; justify-content:space-between; font-size:13px; color:#4f6349; padding:4px 0; cursor:pointer;"><span>${escapeHtml(o.order_number ? '№' + o.order_number : '#' + o.id)} · ${formatDateDMY(o.date)}</span><span>${formatMoney(orderGrandTotal(o))} ›</span></div>`;
        }).join('');
    }
    if (d.deleted) html += `<div style="font-size:12px; color:#9a9488; margin-top:8px;">${escapeHtml(t('docs_order_deleted_hint'))}</div>`;
    if (d.kind === 'cons' && d.cancelled) html += `<div style="font-size:12px; color:#9a9488; margin-top:8px;">${escapeHtml(t('docs_cons_cancelled_hint'))}</div>`;
    if (d.kind === 'cons' && !d.cancelled && typeof hasPermission === 'function' && hasPermission('can_delete')) {
        html += `<div style="text-align:center; margin-top:12px;"><span onclick="registryCancelConsInvoice()" style="color:#a3493d; font-size:13px; text-decoration:underline; cursor:pointer;">${escapeHtml(t('docs_cons_cancel'))}</span></div>`;
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
}

function registrySendDoc() {
    const d = _docsOpenEntry;
    if (!d) return;
    const orderId = d.kind === 'cons' ? d.liveMemberId : d.orderId;
    _docPreview = null;
    closeModal();
    openSendDocumentSheet(orderId, d.docType);
}

// Заказ из просмотра документа (22.10): «Назад» из заказа возвращает в тот же просмотр
// (через список «Документов» с теми же фильтрами); переход по нижнему меню память сбрасывает.
let _docsReturn = null; // { key, filter, q }
function registryOpenOrder(orderId) {
    const entry = _docsOpenEntry;
    const ret = entry ? { key: entry.key, filter: Object.assign({}, _docsFilter), q: (document.getElementById('docsSearch') || {}).value || '' } : null;
    _docPreview = null;
    _docsOpenEntry = null;
    closeModal();
    if (typeof _setPreviewReadOnlyUi === 'function') _setPreviewReadOnlyUi(false, false);
    if (typeof showTab === 'function') showTab('orders');
    _docsReturn = ret; // после showTab — он сбрасывает память
    openOrderDetail(orderId);
}
function docsReturnPending() { return !!_docsReturn; }
function forgetDocsReturn() { _docsReturn = null; }
async function returnToDocsPreview() {
    const r = _docsReturn;
    _docsReturn = null;
    if (!r) return false;
    showLoading();
    try { await _docsLoad(); }
    catch (e) { console.error('Документы: ошибка загрузки', e); hideLoading(); showInfo(t('error_save_check_connection')); return true; }
    hideLoading();
    _docsFilter = r.filter;
    _docsTab = 'issued';
    const q = document.getElementById('docsSearch');
    if (q) q.value = r.q;
    openAppPage('docsPage');
    renderDocumentsSection();
    if (_docsAll.some(x => x.key === r.key)) await openRegistryDoc(r.key);
    return true;
}

// «Закрыть» в предпросмотре документа из списка — возвращаемся в список
function closeRegistryDocPreview() {
    document.getElementById('orderDocumentModal').style.display = 'none';
    _docPreview = null;
    _docsOpenEntry = null;
    if (typeof _setPreviewReadOnlyUi === 'function') _setPreviewReadOnlyUi(false, false);
    renderRegistryDocActions();
    // Просмотр мог быть открыт не из списка (например, «Открыть счёт» у клиента) — тогда открываем список
    if (!isAppPageOpen('docsPage')) openAppPage('docsPage');
    renderDocumentsSection();
}

// ---- Отмена сводного счёта ----
// Счёт не удаляется, а помечается отменённым (cancelled_at, cancelled_by): номер больше не
// используется, нумерация без дыр. Заказы освобождаются (consolidated_invoice_id = null) и могут
// войти в новый сводный счёт. Оплаты остаются у заказов (подпись «по счёту … (отменён)»).
// Письмо клиенту не отправляется. Право — как на удаление (can_delete).
async function registryCancelConsInvoice() {
    const d = _docsOpenEntry;
    if (!d || d.kind !== 'cons' || d.cancelled) return;
    if (typeof hasPermission === 'function' && !hasPermission('can_delete')) { showInfo(t('ing_no_delete_permission')); return; }
    const n = orders.filter(o => o.consolidated_invoice_id === d.consId).length;
    const text = t('docs_cons_cancel_confirm').replace(/\{number\}/g, d.number).replace('{n}', n);
    const ok = await showConfirm(text, { ok: t('docs_cons_cancel_ok'), cancel: t('docs_cons_cancel_keep') });
    if (!ok) return;
    showLoading();
    try {
        suppressRealtimeFor3s();
        const by = (typeof currentEmployee !== 'undefined' && currentEmployee) ? currentEmployee.id : null;
        await updateChecked(db.from('consolidated_invoices')
            .update({ cancelled_at: new Date().toISOString(), cancelled_by: by })
            .eq('id', d.consId).eq('org_id', currentOrgId));
        // Освобождаем заказы, включая удалённые в корзину (их в загруженном списке нет)
        await dbMust(db.from('orders').update({ consolidated_invoice_id: null })
            .eq('consolidated_invoice_id', d.consId).eq('org_id', currentOrgId));
        const freed = orders.filter(o => o.consolidated_invoice_id === d.consId);
        freed.forEach(o => { o.consolidated_invoice_id = null; });
        if (typeof _consInvCancelled !== 'undefined') _consInvCancelled[d.consId] = true;
        const desc = `${t('log_cons_cancelled')} ${d.number}`;
        if (freed.length) freed.forEach(o => logActivity('order', desc, o.id));
        else logActivity('order', desc, null);
        if (typeof saveAppSnapshot === 'function') saveAppSnapshot();
        if (typeof displayOrders === 'function') displayOrders();
        await _docsLoad();
        hideLoading();
        closeRegistryDocPreview();
        showInfo(t('docs_cons_cancel_done').replace('{number}', d.number));
    } catch (e) {
        console.error(e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
    }
}
