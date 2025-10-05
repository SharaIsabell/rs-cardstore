document.addEventListener('DOMContentLoaded', () => {
    const confettiContainer = document.querySelector('.confetti-container');
    if (!confettiContainer) return;

    const confettiCount = 150;
    const colors = ['#FF9F1C', '#0A2463', '#FFFFFF', '#2ecc71', '#3498db'];

    const createConfetti = () => {
        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti');
            
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.animationDuration = `${Math.random() * 3 + 4}s`; // Duração entre 4s e 7s
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            
            if (Math.random() > 0.5) {
                confetti.style.borderRadius = '0';
                confetti.style.width = '8px';
                confetti.style.height = '15px';
            }

            confettiContainer.appendChild(confetti);
        }
    };

    createConfetti();

    // Limpa os confetes do DOM após a animação mais longa terminar
    setTimeout(() => {
        confettiContainer.innerHTML = '';
    }, 8000);
});