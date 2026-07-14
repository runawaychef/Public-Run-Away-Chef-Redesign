// ==================== УТИЛИТЫ: ДАТЫ ====================
// Чистые функции для работы с датами. Ни от чего не зависят.
// Обычный скрипт (без модулей) — функции доступны глобально, как раньше.

// Форматирование даты ГГГГ-ММ-ДД -> ДД.MM.ГГГГ
function formatDateDMY(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    return `${d}.${m}.${y}`;
}

// Понедельник недели, содержащей дату d
function getMondayOf(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

// Возвращает Date — понедельник текущей недели (в локальном времени)
function getCurrentWeekStart() {
    return getMondayOf(new Date());
}

// Возвращает строку YYYY-MM-DD — понедельник текущей недели
function getCurrentWeekStartStr() {
    const d = getCurrentWeekStart();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const MONTH_NAMES_RU = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
const MONTH_NAMES_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Название месяца (0-индекс) на текущем языке приложения. Для русского — в
// родительном падеже ("за июля" уже само по себе устоявшийся у Сержа вариант
// в этом проекте, сохраняем как есть), для английского падежей нет.
function monthName(monthIdx0) {
    return (typeof currentLang !== 'undefined' && currentLang === 'en') ? MONTH_NAMES_EN[monthIdx0] : MONTH_NAMES_RU[monthIdx0];
}
