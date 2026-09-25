import { mount } from 'svelte';
import CityApp from './CityApp.svelte';
import '../app.css';

mount(CityApp, { target: document.getElementById('app')! });
