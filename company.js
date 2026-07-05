// ==================== ИНФОРМАЦИЯ О КОМПАНИИ ====================
// Карточка реквизитов организации: физ./юр. лицо, контакты, банковские
// реквизиты, валюта расчёта. Открывается из Настроек (только владелец).
// Зависит от: db (supabaseClient.js), currentOrgId, currentOrgName,
// currentOrgCurrency (employees.js), showLoading/hideLoading/showInfo,
// showAutosaveToast, updateHeaderOrgName (employees.js), logActivity.

let _companyEntityType = 'company'; // текущее выбранное значение в открытой карточке

// Евро/доллар — по умолчанию, остальные — валюты русскоязычных стран
// (страны бывшего СССР; страны Прибалтики уже покрываются евро).
const CURRENCY_OPTIONS = [
    { code: 'EUR', label: 'Евро (€)' },
    { code: 'USD', label: 'Доллар США ($)' },
    { code: 'RUB', label: 'Российский рубль (₽)' },
    { code: 'BYN', label: 'Белорусский рубль (Br)' },
    { code: 'KZT', label: 'Казахстанский тенге (₸)' },
    { code: 'KGS', label: 'Киргизский сом (с)' },
    { code: 'UZS', label: 'Узбекский сум' },
    { code: 'TJS', label: 'Таджикский сомони' },
    { code: 'TMT', label: 'Туркменский манат (m)' },
    { code: 'AZN', label: 'Азербайджанский манат (₼)' },
    { code: 'AMD', label: 'Армянский драм (֏)' },
    { code: 'GEL', label: 'Грузинский лари (₾)' },
    { code: 'MDL', label: 'Молдавский лей (L)' },
    { code: 'UAH', label: 'Украинская гривна (₴)' },
];

function currencyLabel(code) {
    const found = CURRENCY_OPTIONS.find(c => c.code === code);
    return found ? found.label : code;
}

function renderCurrencyDropdown() {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    dropdown.innerHTML = CURRENCY_OPTIONS.map(c =>
        `<div onclick="selectCurrency('${c.code}')" class="table-text px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer">${c.label}</div>`
    ).join('');
}

function toggleCurrencyDropdown() {
    document.getElementById('cmpCurrencyDropdown').classList.toggle('hidden');
}

function selectCurrency(code) {
    document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(code);
    document.getElementById('cmpCurrencyDropdown').classList.add('hidden');
    saveCompanyInfo('currency_code', code);
}

// Закрытие выпадающего списка валют по клику снаружи (как у фильтра заказов)
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('cmpCurrencyDropdown');
    const btn = document.getElementById('cmpCurrencyBtn');
    if (!dropdown || dropdown.classList.contains('hidden')) return;
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

async function openCompanyInfoModal() {
    showLoading();
    try {
        const { data, error } = await db.from('organizations')
            .select('name, currency_code, entity_type, phone, email, address, legal_name, reg_number, vat_code, director_name, personal_code, bank_name, bank_account, bank_swift')
            .eq('id', currentOrgId)
            .single();
        if (error) throw error;

        document.getElementById('cmpOrgName').value      = data.name || '';
        renderCurrencyDropdown();
        document.getElementById('cmpCurrencyLabel').textContent = currencyLabel(data.currency_code || 'EUR');
        document.getElementById('cmpPhone').value        = data.phone || '';
        document.getElementById('cmpEmail').value        = data.email || '';
        document.getElementById('cmpAddress').value      = data.address || '';
        document.getElementById('cmpLegalName').value    = data.legal_name || '';
        document.getElementById('cmpRegNumber').value    = data.reg_number || '';
        document.getElementById('cmpVatCode').value      = data.vat_code || '';
        document.getElementById('cmpDirectorName').value = data.director_name || '';
        document.getElementById('cmpPersonalCode').value = data.personal_code || '';
        document.getElementById('cmpBankName').value     = data.bank_name || '';
        document.getElementById('cmpBankAccount').value  = data.bank_account || '';
        document.getElementById('cmpBankSwift').value    = data.bank_swift || '';

        setCompanyEntityType(data.entity_type || 'company', /*skipSave*/ true);
        document.getElementById('companyInfoModal').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showInfo('Не удалось загрузить информацию о компании.');
    } finally {
        hideLoading();
    }
}

// Переключение Физ. лицо / Юр. лицо — показывает нужный блок полей
// и (если это не просто отрисовка при открытии) сохраняет выбор.
function setCompanyEntityType(type, skipSave) {
    _companyEntityType = type;
    const isCompany = type === 'company';

    document.getElementById('cmpCompanyFields').classList.toggle('hidden', !isCompany);
    document.getElementById('cmpIndividualFields').classList.toggle('hidden', isCompany);

    const companyBtn    = document.getElementById('cmpEntityCompanyBtn');
    const individualBtn = document.getElementById('cmpEntityIndividualBtn');
    companyBtn.className    = 'btn flex-1 text-xs py-1 rounded-md border' + (isCompany ? ' bg-indigo-600 text-white border-indigo-600' : ' bg-white text-gray-700');
    individualBtn.className = 'btn flex-1 text-xs py-1 rounded-md border' + (!isCompany ? ' bg-indigo-600 text-white border-indigo-600' : ' bg-white text-gray-700');

    if (!skipSave) saveCompanyInfo('entity_type', type);
}

// Универсальное сохранение одного поля карточки компании.
async function saveCompanyInfo(field, value) {
    try {
        await updateChecked(db.from('organizations').update({ [field]: value }).eq('id', currentOrgId));

        // Локально обновляем то, что используется в остальном приложении
        if (field === 'name') {
            currentOrgName = value;
            updateHeaderOrgName();
        }
        if (field === 'currency_code') {
            currentOrgCurrency = value;
        }

        logActivity('system', `Изменено поле «${field}» в информации о компании`);
        showAutosaveToast();
    } catch (e) {
        console.error(e);
        showInfo('Не удалось сохранить изменение. Проверьте подключение.');
    }
}
