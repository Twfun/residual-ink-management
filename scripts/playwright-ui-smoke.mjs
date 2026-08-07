import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../node_modules/playwright');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const user = {
  id: '1',
  username: 'admin',
  displayName: '管理员',
  roleCode: 'admin',
  permissions: [
    'dashboard.view',
    'match.view',
    'inventory.view',
    'inventory.create',
    'inventory.update',
    'inventory.import',
    'outbound.manage',
    'users.manage',
    'backup.manage',
    'logs.view',
    'config.manage',
  ],
  mustChangePassword: false,
};

await page.route('**/api/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  let body = {};
  if (path.endsWith('/auth/login')) body = { token: 'test-token', user };
  else if (path.endsWith('/auth/me')) body = user;
  else if (path.endsWith('/dashboard')) {
    body = {
      statistics: {
        inStockCount: 1,
        knownWeightKg: 2.5,
        unknownWeightCount: 0,
        monthlyOutboundOrders: 0,
        monthlyOutboundLines: 0,
      },
      recentInventory: [],
      recentOutbound: [],
    };
  } else if (path.endsWith('/inventory')) {
    body = {
      rows: [
        {
          id: '1',
          storageLocation: 'A-01',
          rollerColorCode: 'R1-C1',
          inboundDate: '2026-08-01T00:00:00.000Z',
          weightKg: 2.5,
          lStar: 50,
          aStar: 1,
          bStar: -2,
          deltaE: null,
          colorFamily: '蓝色',
          note2: null,
          note3: null,
          status: '在库',
        },
      ],
    };
  } else if (path.endsWith('/inventory/active')) body = [];
  else if (path.endsWith('/outbound')) body = { rows: [] };
  else if (path.endsWith('/users')) body = { rows: [] };
  else if (path.endsWith('/roles')) body = { roles: [], permissions: [] };
  else if (path.endsWith('/backup')) body = { rows: [] };
  else if (path.endsWith('/logs')) body = { rows: [] };
  else if (path.endsWith('/desktop-config')) body = { rows: [] };
  else if (path.endsWith('/match/search')) body = { availableCount: 0, matches: [] };
  else if (path.endsWith('/match/measurements')) body = { rows: [] };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto('http://127.0.0.1:39173/');
const loginButton = page.getByRole('button', { name: '登录' });
if ((await loginButton.count()) !== 1) throw new Error(`未找到登录按钮: ${await page.locator('body').innerText()}`);
await loginButton.click();
await page.waitForSelector('.enterprise-sider');
const expectedMenu = ['智能工作台', '标样匹配', '余墨库存', '余墨出库', '用户权限', '备份恢复', '操作日志', '桌面配置'];
const menu = await page.locator('.enterprise-sider .ant-menu-title-content').allTextContents();
if (JSON.stringify(menu) !== JSON.stringify(expectedMenu)) throw new Error(`菜单不符合约定: ${JSON.stringify(menu)}`);

await page.getByText('余墨库存', { exact: true }).click();
await page.waitForSelector('.excel-style-table');
const expectedHeaders = [
  '库位',
  '版辊号+色序',
  '入库日期',
  '重量',
  'L',
  'a',
  'b',
  '色差',
  '色系',
  '备注2',
  '备注3',
  '操作',
];
const headers = await page.locator('.excel-style-table thead th').allTextContents();
if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders))
  throw new Error(`库存表头不符合约定: ${JSON.stringify(headers)}`);
await page.screenshot({ path: '.playwright-desktop.png', fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.getByRole('button', { name: '登录' }).click();
await page.waitForSelector('.enterprise-sider');
await page.screenshot({ path: '.playwright-mobile.png', fullPage: true });
console.log(JSON.stringify({ desktopMenu: menu, inventoryHeaders: headers, mobileWidth: 390 }));
await browser.close();
