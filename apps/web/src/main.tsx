import '@ant-design/v5-patch-for-react-19';
import 'antd/dist/reset.css';
import { createRoot } from 'react-dom/client';
import LegacyApp from './LegacyApp';
import { ServiceGate } from './components/ServiceGate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ServiceGate>
    <LegacyApp />
  </ServiceGate>,
);
