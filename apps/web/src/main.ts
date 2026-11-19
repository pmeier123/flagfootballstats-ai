import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const theme = localStorage.getItem('ffs.theme');
if (theme) document.documentElement.dataset.theme = theme;

mount(App, { target: document.getElementById('app')! });
