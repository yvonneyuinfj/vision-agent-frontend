import { createApp } from 'vue';
import Antd from 'ant-design-vue';
import App from './App.vue';
import router from './router';

import 'ant-design-vue/dist/reset.css';
import '@/styles/style.css';
import '@/styles/navigation.css';
import '@/styles/center.css';
import '@/styles/detection.css';
import '@/styles/task.css';
import '@/styles/knowledge.css';
import '@/styles/tools.css';
import '@/styles/report.css';
import '@/styles/login.css';
import '@/styles/antd-overrides.css';

const app = createApp(App);
app.use(Antd);
app.use(router);
app.mount('#app');
