import { LabelerApp } from './labeler.js';

document.querySelectorAll('#layersCard input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
        input.nextElementSibling.value = input.value;
    });
});

window.app = new LabelerApp();
