// ==================== i18n (русский / английский) ====================
// Подход: словарь I18N.ru / I18N.en с плоскими ключами + функция t(key).
// Для статичной разметки (не генерируемой в JS построчно) используем
// атрибуты data-i18n="ключ" на элементах — applyI18n() проходит по ним и
// подставляет textContent на текущем языке. Для placeholder-ов —
// data-i18n-placeholder="ключ". Для текста, который собирается в JS
// (шаблонные строки в orders.js/products.js и т.д.), будем постепенно
// заменять зашитые русские строки на вызовы t('ключ') отдельным заходом —
// это первый этап (общая рамка приложения: нижняя навигация, окно
// настроек, приветственное окно "Написать нам").
//
// Если для ключа нет перевода на текущем языке — откатываемся на русский,
// а если нет и там — возвращаем сам ключ (чтобы не падать с ошибкой и не
// показывать undefined, а сразу было заметно в интерфейсе, что перевод
// не найден и его нужно добавить).

const I18N = {
    ru: {
        // Нижняя навигация
        nav_orders: 'Заказы',
        nav_products: 'Ассортимент',
        nav_ingredients: 'Склад',
        nav_customers: 'Клиенты',

        // Окно настроек — общее
        settings_title: 'Настройки',
        settings_current_employee_label: 'Текущий сотрудник:',
        settings_language: 'Язык интерфейса',
        settings_limits_not_apply: 'Лимиты не действуют.',
        settings_company_info: 'Информация о компании',
        settings_manage_data: 'Управление данными',
        settings_download_backup: 'Скачать резервную копию',
        settings_activity_log: 'Журнал действий',
        settings_refresh_data: 'Обновить данные',
        settings_orders_trash: 'Корзина удалённых заказов',
        settings_delete_demo: 'Удалить демо-данные и начать заново',
        settings_team: 'Команда и доступ',
        settings_employees_manage: 'Сотрудники и права',
        settings_switch_employee: 'Сменить сотрудника',
        settings_sign_out: 'Выйти из аккаунта',
        settings_about: 'О приложении',
        settings_privacy: 'Политика конфиденциальности',
        settings_terms: 'Условия использования',
        settings_contact: 'Написать нам',
        settings_faq: 'Частые вопросы',
        settings_version_prefix: 'Simple Bake · версия',
        settings_close: 'Закрыть',

        // Окно "Написать нам"
        contact_title: 'Написать нам',
        contact_subject: 'Simple Bake — вопрос',
        contact_desc: 'Опишите вопрос или проблему — при отправке откроется ваше почтовое приложение с уже готовым письмом на simplebake.support@gmail.com.',
        contact_placeholder: 'Ваше сообщение...',
        contact_send: 'Отправить',
        contact_cancel: 'Отмена',
    },
    en: {
        // Bottom navigation
        nav_orders: 'Orders',
        nav_products: 'Menu',
        nav_ingredients: 'Inventory',
        nav_customers: 'Customers',

        // Settings — general
        settings_title: 'Settings',
        settings_current_employee_label: 'Current staff member:',
        settings_language: 'Language',
        settings_limits_not_apply: 'No limits apply.',
        settings_company_info: 'Business info',
        settings_manage_data: 'Data management',
        settings_download_backup: 'Download backup',
        settings_activity_log: 'Activity log',
        settings_refresh_data: 'Refresh data',
        settings_orders_trash: 'Deleted orders',
        settings_delete_demo: 'Delete demo data and start over',
        settings_team: 'Team & access',
        settings_employees_manage: 'Staff & permissions',
        settings_switch_employee: 'Switch staff member',
        settings_sign_out: 'Sign out',
        settings_about: 'About',
        settings_privacy: 'Privacy Policy',
        settings_terms: 'Terms of Use',
        settings_contact: 'Contact us',
        settings_faq: 'FAQ',
        settings_version_prefix: 'Simple Bake · version',
        settings_close: 'Close',

        // "Contact us" window
        contact_title: 'Contact us',
        contact_subject: 'Simple Bake — question',
        contact_desc: 'Describe your question or issue — sending will open your mail app with a ready message to simplebake.support@gmail.com.',
        contact_placeholder: 'Your message...',
        contact_send: 'Send',
        contact_cancel: 'Cancel',
    }
};

let currentLang = localStorage.getItem('appLang')
    || (navigator.language && navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en');

function t(key) {
    const dict = I18N[currentLang] || I18N.ru;
    if (dict[key] !== undefined) return dict[key];
    if (I18N.ru[key] !== undefined) return I18N.ru[key];
    return key;
}

function setLang(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    currentLang = lang;
    localStorage.setItem('appLang', lang);
    applyI18n();
    updateLangSwitcherUI();
    // Текст тарифа (Тариф/Лимиты) собирается в JS и зависит от языка —
    // перерисовываем, если функция уже подключена (inventory.js).
    if (typeof renderPlanInfo === 'function') renderPlanInfo();
}

function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.documentElement.lang = currentLang;
}

function updateLangSwitcherUI() {
    const ruBtn = document.getElementById('langBtnRu');
    const enBtn = document.getElementById('langBtnEn');
    if (!ruBtn || !enBtn) return;
    ruBtn.classList.toggle('active', currentLang === 'ru');
    enBtn.classList.toggle('active', currentLang === 'en');
}

document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    updateLangSwitcherUI();
});
