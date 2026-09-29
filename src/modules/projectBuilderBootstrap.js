import { ProjectBuilderApp } from './projectBuilder.js';

const projectName = document.getElementById('projectName');
projectName.addEventListener('focus', () => projectName.removeAttribute('readonly'), { once: true });

window.app = new ProjectBuilderApp();
