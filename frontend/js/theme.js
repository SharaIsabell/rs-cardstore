const themeSwitch = document.getElementById('theme-checkbox');
const body = document.body;

const applyTheme = () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.classList.add('dark-mode');
        if (themeSwitch) themeSwitch.checked = true;
    } else {
        body.classList.remove('dark-mode');
        if (themeSwitch) themeSwitch.checked = false;
    }
};

const handleThemeChange = (event) => {
    if (event.target.checked) {
        body.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
    } else {
        body.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
    }
};

document.addEventListener('DOMContentLoaded', applyTheme);

if (themeSwitch) {
    themeSwitch.addEventListener('change', handleThemeChange);
}