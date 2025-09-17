document.addEventListener('DOMContentLoaded', () => {
    const quantityInputs = document.querySelectorAll('.quantity-input');

    quantityInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            const newQuantity = e.target.value;
            const form = e.target.closest('form');
            form.submit();
        });
    });
});