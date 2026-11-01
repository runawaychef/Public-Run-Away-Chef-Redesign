// ==================== НОВЫЙ РАЗДЕЛ «ДОКУМЕНТЫ» — шаг 1: главный экран (31.10.2026) ====================
// ТЕСТ: пока виден только в id1 (currentOrgProtected). Старый documents.js не меняется и работает у всех.
// Новый раздел ТОЛЬКО ЧИТАЕТ: данные грузит старая функция _docsLoad() (documents.js), статусы считает
// _docsInvStatus() оттуда же. Ничего не пишет в базу.
// Главный документ для пекаря — заказ: «К выставлению» считается по заказам (orderNeedsInvoice, orders.js),
// остальные плитки — по документам (счета, сводные, накладные).
// Откат: убрать кнопку #docs2Btn и страницу #docs2HomePage из index.html, блок CSS DOCS2, <script> documents2.js,
// строку в refreshDocsVisibility (payments.js), строки docs2 в helpers.js (_appPageShowTop).
// Следующие шаги: страницы плиток (Ждут оплаты / Просрочено / Оплачены / К выставлению / Накладные / Все документы).
// Зависит от: _docsLoad, _docsAll, _docsInvStatus, _docsDayDiff (documents.js), orders, orderNeedsInvoice,
//             orderGrandTotal, docsEnabled, _anyIssuedDocs (payments.js), formatMoney, getLocalDateStr,
//             openAppPage (helpers.js), showLoading/hideLoading/showInfo, escapeHtml, t.

// Кому показывать новый раздел. Сейчас — только защищённой организации id1.
// Когда откроем всем: убрать условие currentOrgProtected (одна строка).
function docs2Allowed() {
    if (typeof currentOrgProtected === 'undefined' || !currentOrgProtected) return false;
    const on = (typeof docsEnabled === 'function' && docsEnabled()) || (typeof _anyIssuedDocs === 'function' && _anyIssuedDocs());
    return !!on;
}

function refreshDocs2Visibility() {
    const b = document.getElementById('docs2Btn');
    if (b) b.classList.toggle('hidden', !docs2Allowed());
}

async function openDocs2Home() {
    if (!docs2Allowed()) return;
    showLoading();
    try {
        await _docsLoad();
    } catch (e) {
        console.error('Документы 2: ошибка загрузки', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    await _d2LoadPaid();
    hideLoading();
    openAppPage('docs2HomePage');
    docs2RenderHome();
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2HomePage = () => docs2RenderHome();

// Реальные поступления денег за текущий месяц — по дате платежа (order_payments.paid_at), а не по дате документа.
// null — не удалось загрузить (плитка покажет прочерк).
// Текущий и прошлый месяц (YYYY-MM) по локальной дате
function _d2Months() {
    const p = String(getLocalDateStr(0)).split('-').map(Number);
    const cur = p[0] + '-' + String(p[1]).padStart(2, '0');
    const pd = new Date(p[0], p[1] - 2, 1);
    const prev = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0');
    return { cur, prev };
}
let _d2Paid = null;
async function _d2LoadPaid() {
    _d2Paid = null;
    try {
        const mm = _d2Months();
        const { data, error } = await db.from('order_payments').select('amount, paid_at')
            .eq('org_id', currentOrgId).gte('paid_at', mm.prev + '-01').limit(5000);
        if (error) throw error;
        let c = 0, n = 0, pc = 0;
        (data || []).forEach(p => {
            const m = String(p.paid_at || '').slice(0, 7), cc = Math.round(Number(p.amount || 0) * 100);
            if (m === mm.cur) { c += cc; n++; } else if (m === mm.prev) { pc += cc; }
        });
        _d2Paid = { c, n, pc };
    } catch (e) {
        console.error('Документы 2: ошибка загрузки платежей', e);
    }
}

function docs2Soon() { showInfo(t('docs2_next_step')); }

// Число и валюта: «259.08 €» → 259.08 + маленькая «€» (как в плитках «Статистики»)
function _d2Money(c) {
    const s = formatMoney((c || 0) / 100);
    const i = s.lastIndexOf(' ');
    return i < 0 ? escapeHtml(s) : escapeHtml(s.slice(0, i)) + '<small>&nbsp;' + escapeHtml(s.slice(i + 1)) + '</small>';
}

const _D2_ICONS = {
    plus:  '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 15h6M13 12v6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.8L16 9.5"/>',
    dn:    '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    all:   '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    half:  '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    exp:   '<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 15v4h14v-4"/>'
};
function _d2Icon(key) {
    return `<svg class="dashboard-card__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${_D2_ICONS[key]}</svg>`;
}

// Плитка 8-шт. главного экрана: заголовок (+ число-значок справа), крупное значение по центру, подвал «слева — справа».
// footR выводится как простой текст (без разметки).
function _d2Tile(o) {
    const pill = (o.pill !== undefined && o.pill !== null && o.pill !== '') ? `<span class="d2pill">${escapeHtml(String(o.pill))}</span>` : '';
    const cap = o.cap ? `<span class="dc-cap">${escapeHtml(o.cap)}</span>` : '';
    const mid = o.mid ? `<span class="d2mid">${escapeHtml(o.mid)}</span>` : '';
    return `<div class="dashboard-card dc2 d2t${o.cls ? ' ' + o.cls : ''}" role="button" tabindex="0" onclick="${o.click || 'docs2Soon()'}">
        <div class="dashboard-card__hd ${o.color}">${_d2Icon(o.icon)}<span class="dashboard-card__label">${escapeHtml(o.label)}</span>${pill}</div>
        <div class="dc-val${mid ? ' d2col' : ''}"><span class="dashboard-card__value">${o.value}</span>${cap}${mid}</div>
        <div class="dc-foot"><span>${escapeHtml(o.footL || '')}</span><em>${escapeHtml(o.footR || '')}</em></div>
    </div>`;
}

// ---- Неоплаченные заказы (главный документ — заказ). Считается так же, как «Ждут оплаты» в Дашборде:
// сохранённые заказы, не оплаченные полностью; сумма — остаток (заказ минус внесённые платежи). ----
function _d2Unpaid() {
    const today = getLocalDateStr(0);
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    const out = [];
    (typeof orders !== 'undefined' ? orders : []).forEach(o => {
        if (!isOrderSaved(o)) return;
        const st = getOrderPaymentStatus(o);
        if (st.status === 'paid') return;
        const remC = Math.max(0, Math.round(st.grandAmt * 100) - Math.round(st.paidAmt * 100));
        const cons = docs.find(x => x.kind === 'cons' && !x.cancelled && (x.memberIds || []).indexOf(o.id) >= 0) || null;
        const inv = cons ? null : (docs.find(x => x.kind === 'inv' && x.orderId === o.id && !x.cancelled) || null);
        // Срок оплаты: у выставленного счёта — срок из документа (сводного или обычного), иначе срок, заданный в заказе
        const due = (cons && cons.due) || (inv && inv.due) || o.due_date || null;
        const over = !!due && due < today;
        out.push({ o, remC, paidC: Math.round(st.paidAmt * 100), partial: st.status === 'partial', over, due,
            overDays: over ? _docsDayDiff(due, today) : 0, cons, inv });
    });
    return out;
}

function docs2RenderHome() {
    const box = document.getElementById('docs2Home');
    if (!box) return;
    const today = getLocalDateStr(0);
    const ym = _d2Months().cur;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];

    // ---- Неоплаченные заказы: «в срок» и «просрочено» (как в Дашборде) ----
    const over = { n: 0, c: 0, maxDays: 0 };
    const wait = { n: 0, c: 0 };
    const part = { n: 0, c: 0, paidC: 0 };
    _d2Unpaid().forEach(u => {
        if (u.over) { over.n++; over.c += u.remC; over.maxDays = Math.max(over.maxDays, u.overDays); }
        else { wait.n++; wait.c += u.remC; }
        if (u.partial) { part.n++; part.c += u.remC; part.paidC += u.paidC; }
    });
    let unsent = 0, unsentC = 0, dnMonth = 0, lastDn = '', total = 0;
    // Заказы, вошедшие в действующий сводный счёт: их отдельный счёт (старые заказы) в суммах не учитываем — иначе заказ считается дважды
    const inCons = new Set();
    docs.forEach(d => { if (d.kind === 'cons' && !d.cancelled) (d.memberIds || []).forEach(id => inCons.add(id)); });
    docs.forEach(d => {
        if (d.cancelled) return;
        total++;
        if (d.kind === 'dn') {
            if (String(d.date).slice(0, 7) === ym) dnMonth++;
            if (String(d.rawNumber || '') > lastDn) lastDn = String(d.rawNumber || '');
            return;
        }
        if (d.kind === 'inv' && inCons.has(d.orderId)) return;
        const st = _docsInvStatus(d, today);
        if (!st) return;
        if (st.paid) return;
        if (st.wait && st.unsent) { unsent++; unsentC += d.sumC || 0; }
    });

    // ---- Заказы без счёта (главный документ — заказ) ----
    const todo = (typeof orders !== 'undefined' ? orders : []).filter(o => typeof orderNeedsInvoice === 'function' && orderNeedsInvoice(o));
    let todoSumC = 0;
    todo.forEach(o => { todoSumC += Math.round(orderGrandTotal(o) * 100); });
    const plain = c => formatMoney((c || 0) / 100);
    const shortDate = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] : ''; };

    const tiles = [
        _d2Tile({ color: 'dash-c-day', icon: 'plus', label: t('docs_tab_todo'), value: String(todo.length), cap: todo.length ? t('docs2_todo_cap') : t('docs_todo_empty'),
                  footL: todo.length ? t('docs2_todo_sum') : '', footR: todo.length ? plain(todoSumC) : '' }),
        _d2Tile({ color: 'dash-c-day', icon: 'alert', label: t('docs2_unsent_t'), value: String(unsent), cap: unsent ? t('docs2_unsent_cap') : '',
                  footL: unsent ? t('docs2_todo_sum') : '', footR: unsent ? plain(unsentC) : '' }),
        _d2Tile({ color: 'dash-c-tom', icon: 'clock', label: t('docs_tile_wait'), value: _d2Money(wait.c + over.c), pill: wait.n + over.n, click: "openDocs2Wait('all')",
                  mid: part.n ? t('docs2_partial_line').replace('{n}', part.n) : '',
                  footL: over.n ? t('docs2_over_short') : '', footR: over.n ? plain(over.c) : '' }),
        _d2Tile({ color: 'dash-c-acc', icon: 'check', label: t('docs_tile_paid'), value: _d2Paid ? _d2Money(_d2Paid.c) : '&mdash;', pill: _d2Paid ? _d2Paid.n : '', click: "openDocs2Paid()",
                  footL: _d2Paid ? t('docs2_prev_month') : '', footR: _d2Paid ? plain(_d2Paid.pc) : '' }),
        _d2Tile({ color: 'dash-c-stock', icon: 'dn', label: t('docs_type_dn'), value: String(dnMonth), cap: t('docs2_this_month'),
                  footL: lastDn ? t('docs2_last') : '', footR: lastDn }),
        _d2Tile({ color: 'dash-c-rev', icon: 'all', label: t('docs2_all'), value: String(total), footL: t('docs2_all_sub') }),
        _d2Tile({ color: 'dash-c-stock', icon: 'exp', label: t('docs2_export'), value: '&mdash;', footL: t('docs2_export_sub'), footR: t('docs2_soon'), cls: 'docs2-soon sth-wide' })
    ].join('');

    box.innerHTML = `<div class="dashboard-grid stats-home-grid docs2-grid">${tiles}
        <div class="sth-info"><i>i</i><ul><li>${escapeHtml(t('docs2_info'))}</li></ul></div></div>`;
}


// ==================== Страница «Ждут оплаты / Просрочено» (1.11.2026) ====================
// Список неоплаченных заказов по клиентам. Клиент сворачивается/разворачивается; режим «свёрнуто/развёрнуто» запоминается.
// Нажатие на заказ — открывает карточку заказа (оплата принимается там).
const _D2_BAR_ICONS = {
    cust: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .7 3.5 2.4 3.5 5.5"/></svg>',
    per:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    exp:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l5-5 5 5M7 16l5 5 5-5"/></svg>',
    half: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    col:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 5 5-5M7 20l5-5 5 5"/></svg>'
};
let _d2W = { mode: 'all', part: false, cust: '', period: '', open: new Set() };
function _d2View() { try { return localStorage.getItem('docs2_wait_view') === 'expanded' ? 'expanded' : 'collapsed'; } catch (e) { return 'collapsed'; } }
function _d2SetView(v) { try { localStorage.setItem('docs2_wait_view', v); } catch (e) {} }

function _d2GroupKey(u) { return String(u.o.customer_id || ('n:' + (u.o.customer || ''))); }

// Применить сохранённый режим к набору раскрытых клиентов (развёрнуто — все; свёрнуто — никого, кроме единственного клиента)
function _d2ApplyView(groupKeys) {
    _d2W.open = new Set();
    if (_d2View() === 'expanded' || groupKeys.length === 1) groupKeys.forEach(k => _d2W.open.add(k));
}

async function openDocs2Wait(mode, part) {
    if (!docs2Allowed()) return;
    _d2W.mode = mode === 'over' ? 'over' : (mode === 'wait' ? 'wait' : 'all');
    _d2W.part = !!part;
    _d2W.cust = '';
    _d2W.period = '';
    openAppPage('docs2WaitPage');
    docs2RenderWait(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2WaitPage = () => docs2RenderWait(false);

function docs2WaitSet(field, v) {
    _d2W[field] = v;
    docs2RenderWait(true);
}
function docs2WaitPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    docs2WaitSet(field === 'per' ? 'period' : 'cust', v);
}
function docs2WaitToggle(key) {
    if (_d2W.open.has(key)) _d2W.open.delete(key); else _d2W.open.add(key);
    docs2RenderWait(false);
}
function docs2WaitToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderWait(true);
}
function docs2OpenOrder(orderId) {
    if (typeof closeAllAppPages === 'function') closeAllAppPages();
    if (typeof showTab === 'function') showTab('orders');
    if (typeof openOrderDetail === 'function') openOrderDetail(orderId);
}

function docs2RenderWait(reapplyView) {
    const box = document.getElementById('docs2Wait');
    if (!box) return;
    const today = getLocalDateStr(0);
    const all = _d2Unpaid();
    // Фильтры клиент/период действуют на плитки-переключатели и на список; статус выбирается переключателем
    const ymOf = u => String(u.o.date || '').slice(0, 7);
    const base = all.filter(u => (!_d2W.cust || _d2GroupKey(u) === _d2W.cust) && (!_d2W.period || ymOf(u) === _d2W.period) && (!_d2W.part || u.partial));
    const wait = base.filter(u => !u.over), over = base.filter(u => u.over);
    const sum = a => a.reduce((s, u) => s + u.remC, 0);
    const list = _d2W.mode === 'over' ? over : (_d2W.mode === 'wait' ? wait : base);

    // Группы по клиентам, самый большой долг сверху
    const groups = new Map();
    list.forEach(u => {
        const k = _d2GroupKey(u);
        if (!groups.has(k)) groups.set(k, { key: k, name: u.o.customer || t('orders_no_customer'), items: [], sumC: 0 });
        const g = groups.get(k); g.items.push(u); g.sumC += u.remC;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) _d2ApplyView(gl.map(g => g.key));

    // Выпадающие списки (механизм «Заказов»): клиенты и месяцы по всем неоплаченным заказам, выбор один
    const custMap = new Map();
    all.forEach(u => custMap.set(_d2GroupKey(u), u.o.customer || t('orders_no_customer')));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2WaitPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2DdCust'), ddP = document.getElementById('docs2DdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2W.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2W.cust)).join('');
    const yms = [...new Set(all.map(ymOf).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2W.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2W.period)).join('');

    const chip = (mode, label, arr, red) => `<button type="button" class="d2chip${_d2W.mode === mode ? ' on' : ''}${red ? ' red' : ''}" onclick="docs2WaitSet('mode','${mode}')">
        <small>${escapeHtml(label)}</small><b>${arr.length}</b><span>${escapeHtml(formatMoney(sum(arr) / 100))}</span></button>`;
    const expanded = _d2View() === 'expanded';

    const row = u => {
        const o = u.o;
        const doc = u.cons ? t('docs2_in_cons').replace('{n}', u.cons.number) : (u.inv ? u.inv.number : t('docs2_no_inv'));
        const d = u.cons || u.inv;
        const gold = x => `<span class="d2gold">${escapeHtml(x)}</span>`;
        let st = '';
        if (d) st = d.sentAt ? escapeHtml(t('docs_sent_on').replace('{d}', _docsShortDate(d.sentAt))) : gold(t('docs_not_sent_cap'));
        if (u.partial) st += (st ? ' · ' : '') + gold(t('docs_partial'));
        let due = '';
        if (u.over) due = `<div class="red">${escapeHtml(t('docs_overdue_days').replace('{n}', u.overDays))}</div>`;
        else if (u.due) due = `<div>${escapeHtml(t('docs_due_till').replace('{d}', _docsShortDate(u.due + 'T12:00:00')))}</div>`;
        return `<div class="d2o" onclick="docs2OpenOrder(${o.id})"><div class="l">
            <div class="a">${escapeHtml(t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)))}</div>
            <div class="b">${escapeHtml(formatDateDMY(o.date))} · ${escapeHtml(doc)}</div>
            ${st ? `<div class="c">${st}</div>` : ''}</div>
            <div class="r"><b>${escapeHtml(formatMoney(u.remC / 100))}</b>${due}</div></div>`;
    };
    const order = (a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.o.date).localeCompare(String(b.o.date));
    const groupHtml = gl.map(g => {
        const open = _d2W.open.has(g.key);
        const body = open ? g.items.slice().sort(order).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2WaitToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${g.items.length} ${escapeHtml(nWord(g.items.length, 'word_orders'))}</small></div>
            <span class="sm${_d2W.mode === 'over' ? ' red' : ''}">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    box.innerHTML = `<div class="d2chips">${chip('all', t('docs2_chip_all'), base, false)}${chip('wait', t('docs2_in_term'), wait, false)}${chip('over', t('docs_tile_over'), over, true)}</div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2W.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2W.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2DdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button>
            <button type="button" class="view-toggle-btn${_d2W.part ? ' active' : ''}" onclick="docs2WaitSet('part', !_d2W.part)" title="${escapeHtml(t('docs2_partial_t'))}">${_D2_BAR_ICONS.half}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2WaitToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_wait_empty'))}</p>`}`;
}

// ==================== Страница «Оплачены» (1.11.2026) ====================
// Реальные поступления (order_payments.paid_at) за выбранный месяц (по умолчанию текущий), по клиентам.
// Нажатие на платёж — открывает заказ.
let _d2PRows = [];
let _d2P = { cust: '', period: '', open: new Set() };

async function openDocs2Paid() {
    if (!docs2Allowed()) return;
    showLoading();
    try {
        const { data, error } = await db.from('order_payments').select('id, order_id, amount, paid_at, consolidated_invoice_id')
            .eq('org_id', currentOrgId).order('paid_at', { ascending: false }).limit(5000);
        if (error) throw error;
        _d2PRows = data || [];
    } catch (e) {
        console.error('Документы 2: ошибка загрузки платежей', e);
        hideLoading();
        showInfo(t('error_save_check_connection'));
        return;
    }
    hideLoading();
    _d2P.cust = '';
    _d2P.period = _d2Months().cur;
    openAppPage('docs2PaidPage');
    docs2RenderPaid(true);
}
(window._appPageOnShow = window._appPageOnShow || {}).docs2PaidPage = () => docs2RenderPaid(false);

function docs2PaidPick(field, v) {
    if (typeof closeAllFilterDropdowns === 'function') closeAllFilterDropdowns();
    _d2P[field === 'per' ? 'period' : 'cust'] = v;
    docs2RenderPaid(true);
}
function docs2PaidToggle(key) {
    if (_d2P.open.has(key)) _d2P.open.delete(key); else _d2P.open.add(key);
    docs2RenderPaid(false);
}
function docs2PaidToggleAll() {
    _d2SetView(_d2View() === 'expanded' ? 'collapsed' : 'expanded');
    docs2RenderPaid(true);
}

function docs2RenderPaid(reapplyView) {
    const box = document.getElementById('docs2Paid');
    if (!box) return;
    const docs = (typeof _docsAll !== 'undefined' && Array.isArray(_docsAll)) ? _docsAll : [];
    const ordById = new Map((typeof orders !== 'undefined' ? orders : []).map(o => [o.id, o]));
    const rows = _d2PRows.map(p => {
        const o = ordById.get(p.order_id) || null;
        const key = o ? String(o.customer_id || ('n:' + (o.customer || ''))) : 'x';
        const name = o ? (o.customer || t('orders_no_customer')) : t('orders_no_customer');
        return { p, o, key, name, c: Math.round(Number(p.amount || 0) * 100), ym: String(p.paid_at || '').slice(0, 7) };
    });
    const base = rows.filter(r => (!_d2P.cust || r.key === _d2P.cust) && (!_d2P.period || r.ym === _d2P.period));
    const sumC = base.reduce((s, r) => s + r.c, 0);

    const groups = new Map();
    base.forEach(r => {
        if (!groups.has(r.key)) groups.set(r.key, { key: r.key, name: r.name, items: [], sumC: 0 });
        const g = groups.get(r.key); g.items.push(r); g.sumC += r.c;
    });
    const gl = [...groups.values()].sort((a, b) => b.sumC - a.sumC);
    if (reapplyView) {
        _d2P.open = new Set();
        if (_d2View() === 'expanded' || gl.length === 1) gl.forEach(g => _d2P.open.add(g.key));
    }

    // Выпадающие списки: клиенты и месяцы по всем платежам; текущий месяц есть всегда
    const custMap = new Map();
    rows.forEach(r => custMap.set(r.key, r.name));
    const CHK = '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>';
    const opt = (field, v, label, sel) => `<div class="status-option${sel ? ' selected' : ''}" data-v="${escapeHtml(v)}" onclick="docs2PaidPick('${field}', this.getAttribute('data-v'))"><span>${escapeHtml(label)}</span>${CHK}</div>`;
    const ddC = document.getElementById('docs2PdCust'), ddP = document.getElementById('docs2PdPer');
    if (ddC) ddC.innerHTML = opt('cust', '', t('docs_customer_all'), !_d2P.cust)
        + [...custMap.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => opt('cust', k, n, k === _d2P.cust)).join('');
    const yms = [...new Set(rows.map(r => r.ym).concat([_d2Months().cur]).filter(y => /^\d{4}-\d{2}$/.test(y)))].sort().reverse();
    if (ddP) ddP.innerHTML = opt('per', '', t('docs_period_all'), !_d2P.period)
        + yms.map(ym => opt('per', ym, _docsMonthLabel(ym), ym === _d2P.period)).join('');

    const expanded = _d2View() === 'expanded';
    const row = r => {
        const o = r.o;
        const cons = o ? docs.find(x => x.kind === 'cons' && !x.cancelled && (x.memberIds || []).indexOf(o.id) >= 0) : null;
        const inv = (o && !cons) ? docs.find(x => x.kind === 'inv' && x.orderId === o.id && !x.cancelled) : null;
        const doc = cons ? t('docs2_in_cons').replace('{n}', cons.number) : (inv ? inv.number : '');
        const oname = o ? t('docs2_order').replace('{n}', o.order_number || ('#' + o.id)) : '—';
        const click = o ? ` onclick="docs2OpenOrder(${o.id})"` : '';
        return `<div class="d2o"${click}><div class="l">
            <div class="a">${escapeHtml(oname)}</div>
            <div class="b">${escapeHtml(formatDateDMY(String(r.p.paid_at || '').slice(0, 10)))}${doc ? ' · ' + escapeHtml(doc) : ''}</div></div>
            <div class="r"><b>${escapeHtml(formatMoney(r.c / 100))}</b></div></div>`;
    };
    const groupHtml = gl.map(g => {
        const open = _d2P.open.has(g.key);
        const body = open ? g.items.slice().sort((a, b) => String(b.p.paid_at).localeCompare(String(a.p.paid_at))).map(row).join('') : '';
        return `<div class="d2g"><div class="d2gh" onclick="docs2PaidToggle(this.getAttribute('data-k'))" data-k="${escapeHtml(g.key)}">
            <span class="ch">${open ? '&#8964;' : '&rsaquo;'}</span>
            <div class="nm"><b>${escapeHtml(g.name)}</b><small>${escapeHtml(t('docs2_pays_line').replace('{n}', g.items.length))}</small></div>
            <span class="sm">${escapeHtml(formatMoney(g.sumC / 100))}</span></div>${body}</div>`;
    }).join('');

    box.innerHTML = `<div class="d2chips">
            <div class="d2chip on"><small>${escapeHtml(t('docs2_received') + ' \u00b7 ' + t('docs2_pays_line').replace('{n}', base.length))}</small><b>${escapeHtml(formatMoney(sumC / 100))}</b></div></div>
        <div id="docs2WaitBar"><div class="view-toggle-pill">
            <button type="button" class="view-toggle-btn${_d2P.cust ? ' active' : ''}" onclick="toggleFilterDropdown('docs2PdCust')" title="${escapeHtml(t('stats_all_customers_short'))}">${_D2_BAR_ICONS.cust}</button>
            <button type="button" class="view-toggle-btn${_d2P.period ? ' active' : ''}" onclick="toggleFilterDropdown('docs2PdPer')" title="${escapeHtml(t('orders_period'))}">${_D2_BAR_ICONS.per}</button></div>
            <div class="view-toggle-pill"><button type="button" class="view-toggle-btn${expanded ? ' active' : ''}" onclick="docs2PaidToggleAll()" title="${escapeHtml(t(expanded ? 'docs2_collapse' : 'docs2_expand'))}">${expanded ? _D2_BAR_ICONS.col : _D2_BAR_ICONS.exp}</button></div></div>
        ${gl.length ? groupHtml : `<p style="font-size:13px; color:#9a9488; margin:24px 0; text-align:center;">${escapeHtml(t('docs2_paid_empty'))}</p>`}`;
}
