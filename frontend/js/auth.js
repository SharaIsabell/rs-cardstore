document.addEventListener('DOMContentLoaded', () => {
    const signUpButton = document.getElementById('signUp');
    const signInButton = document.getElementById('signIn');
    const authContainer = document.querySelector('.auth-container');

    if (signUpButton && signInButton && authContainer) {
        signUpButton.addEventListener('click', () => {
            authContainer.classList.add('right-panel-active');
        });

        signInButton.addEventListener('click', () => {
            authContainer.classList.remove('right-panel-active');
        });
    } else {
        console.error("Um ou mais elementos não foram encontrados no DOM para o script de autenticação.");
    }
});