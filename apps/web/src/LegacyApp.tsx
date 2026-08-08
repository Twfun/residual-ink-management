import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  type MenuProps,
} from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BookOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DownOutlined,
  DatabaseOutlined,
  EditOutlined,
  ExportOutlined,
  FileExcelOutlined,
  KeyOutlined,
  LockOutlined,
  LogoutOutlined,
  SaveOutlined,
  SearchOutlined,
  TeamOutlined,
  UpOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import zhCN from 'antd/locale/zh_CN';
import { api, API } from './api';
import { EChart } from './components/EChart';
import { FormulasPage } from './FormulaPages';
import { MeasureModal } from './components/MeasureModal';
import { PantoneLibraryModal } from './components/PantoneLibraryModal';
import { EmptyState, MetricCard } from './components/ui';
import { RIM, rimTheme } from './theme';
import type { XriteMeasurement } from './labColor';
import {
  COLOR_FAMILY_OPTIONS,
  DASHBOARD_DIMENSIONS,
  DASHBOARD_PERIODS,
  INVENTORY_COLUMNS,
  MATCH_FORMULA_OPTIONS,
  PAGE_CONTRACT,
} from './contracts';
import loginLogo from './assets/login-logo.png';
import loginScene from './assets/login-scene.jpg';
import {
  clearRememberedUsernames,
  loadRememberedUsernames,
  saveRememberedUsername,
} from './session';

dayjs.locale('zh-cn');


type User = {
  id: string;
  username: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
  mustChangePassword: boolean;
};
type PageKey =
  | 'dashboard'
  | 'match'
  | 'formulas'
  | 'inventory'
  | 'outbound'
  | 'statistics'
  | 'users'
  | 'backup'
  | 'logs';
type Inventory = Record<string, any> & { id: string; storageLocation: string; weightKg: number | null; status: string };


async function downloadExcel(path: string, params: Record<string, unknown>, token: string) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  }
  const response = await fetch(`${API}${path}${query.size ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || '导出失败。');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const matched =
    disposition.match(/filename\*=(?:UTF-8'')?"?([^";]+)"?/) ?? disposition.match(/filename="?([^";]+)"?/);
  const fileName = matched ? decodeURIComponent(matched[1]) : '导出.xlsx';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const labels = Object.fromEntries(PAGE_CONTRACT.map(([key, label]) => [key, label])) as Record<PageKey, string>;
const pages: Array<[PageKey, string, string, React.ReactNode]> = [
  ['dashboard', labels.dashboard, 'dashboard.view', <DashboardOutlined />],
  ['match', labels.match, 'match.view', <BgColorsOutlined />],
  ['formulas', labels.formulas, 'formula.view', <BookOutlined />],
  ['inventory', labels.inventory, 'inventory.view', <DatabaseOutlined />],
  ['outbound', labels.outbound, 'outbound.view', <ExportOutlined />],
  ['statistics', labels.statistics, 'dashboard.view', <BarChartOutlined />],
  ['users', labels.users, 'users.manage', <TeamOutlined />],
  ['backup', labels.backup, 'backup.manage', <CloudServerOutlined />],
  ['logs', labels.logs, 'logs.view', <AuditOutlined />],
];

export default function LegacyApp() {
  const [token, setToken] = useState<string | null>(() => {
    localStorage.removeItem('rim-token');
    return null;
  });
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<PageKey>('dashboard');
  const [keepAliveKeys, setKeepAliveKeys] = useState<PageKey[]>(['dashboard']);
  const [instrument, setInstrument] = useState<any>();
  useEffect(() => {
    if (token)
      api<User>('/auth/me', {}, token)
        .then(setUser)
        .catch(() => {
          setToken(null);
        });
  }, [token]);
  const connectInstrument = async () => {
    try {
      if (!('__TAURI_INTERNALS__' in window)) return;
      const { invoke } = await import('@tauri-apps/api/core');
      setInstrument(await invoke<any>('xrite_command', { command: 'connect' }));
    } catch (error) {
      setInstrument({
        connected: false,
        error: { message: error instanceof Error ? error.message : '仪器连接失败。' },
      });
    }
  };
  useEffect(() => {
    if (user) void connectInstrument();
  }, [user?.id]);
  if (!token || !user)
    return (
      <ConfigProvider locale={zhCN} theme={rimTheme}>
        <AntApp>
          <Login
            onLogin={(nextToken, nextUser) => {
              setToken(nextToken);
              setUser(nextUser);
            }}
          />
        </AntApp>
      </ConfigProvider>
    );
  const items: MenuProps['items'] = pages
    .filter(([, , right]) => user.permissions.includes(right))
    .map(([key, label, , icon]) => ({ key, label, icon }));
  const logout = () => {
    setToken(null);
    setUser(null);
  };
  return (
    <ConfigProvider locale={zhCN} theme={{ ...rimTheme, token: { ...rimTheme.token, fontSize: 14.5 } }}>
      <AntApp>
        <Layout className="rim-shell">
          <Layout.Sider className="enterprise-sider" width={220} collapsedWidth={72} collapsible>
            <div className="rim-brand">
              <img src={loginLogo} alt="余墨管理系统标识" className="rim-sider-logo" />
              <span>
                <b>余墨管理系统</b>
                <small>企业数据工作台</small>
              </span>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[active]}
              items={items}
              onClick={({ key }) => {
                const next = key as PageKey;
                setActive(next);
                setKeepAliveKeys((prev) => (prev.includes(next) ? prev : [...prev, next]));
              }}
            />
          </Layout.Sider>
          <Layout>
            <Layout.Header className="enterprise-topbar">
              <Typography.Title level={3}>{labels[active]}</Typography.Title>
              <Space>
                <Tag color={instrument?.connected ? 'green' : 'default'}>
                  {instrument?.connected ? '仪器已连接' : '仪器未连接'}
                </Tag>
                <Button type="text" onClick={() => void connectInstrument()}>
                  连接仪器
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'password',
                        icon: <KeyOutlined />,
                        label: '修改密码',
                        onClick: () => setUser({ ...user, mustChangePassword: true }),
                      },
                      { type: 'divider' },
                      { key: 'logout', icon: <LogoutOutlined />, danger: true, label: '退出登录', onClick: logout },
                    ],
                  }}
                >
                  <Button type="text" icon={<UserOutlined />}>
                    {user.displayName}（{user.roleCode}）
                  </Button>
                </Dropdown>
              </Space>
            </Layout.Header>
            <Layout.Content className="enterprise-content">
              <div className="enterprise-page-shell">
                {keepAliveKeys.map((key) => (
                  <div
                    key={key}
                    className="rim-keepalive-page"
                    style={{ display: key === active ? 'block' : 'none' }}
                  >
                    {key === 'dashboard' && (
                      <ConfigProvider theme={{ token: { fontSize: 12.5 } }}>
                        <Dashboard token={token} />
                      </ConfigProvider>
                    )}
                    {key === 'match' && <Match token={token} rights={user.permissions} />}
                    {key === 'formulas' && <FormulasPage token={token} rights={user.permissions} />}
                    {key === 'inventory' && <InventoryPage token={token} rights={user.permissions} />}
                    {key === 'outbound' && <OutboundPage token={token} rights={user.permissions} />}
                    {key === 'statistics' && <StatisticsPage token={token} />}
                    {key === 'users' && <UsersPage token={token} rights={user.permissions} />}
                    {key === 'backup' && <BackupPage token={token} rights={user.permissions} />}
                    {key === 'logs' && <LogsPage token={token} rights={user.permissions} />}
                  </div>
                ))}
              </div>
            </Layout.Content>
          </Layout>
        </Layout>
        {user.mustChangePassword && (
          <PasswordModal token={token} onDone={() => setUser({ ...user, mustChangePassword: false })} />
        )}
      </AntApp>
    </ConfigProvider>
  );
}

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [usernames, setUsernames] = useState<string[]>(() => loadRememberedUsernames());
  const { message } = AntApp.useApp();
  const submit = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    try {
      const result = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: values.username, password: values.password }),
      });
      setUsernames(saveRememberedUsername(values.username));
      onLogin(result.token, result.user);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败。');
    } finally {
      setSubmitting(false);
    }
  };
  const clearHistory = () => {
    clearRememberedUsernames();
    setUsernames([]);
    message.success('已清除历史账号。');
  };
  return (
    <div className="login-screen">
      <section className="login-visual">
        <img className="login-visual-bg" src={loginScene} alt="" />
        <div className="login-visual-shade" />
        <header className="login-brand">
          <img src={loginLogo} alt="余墨管理系统标识" />
          <span>余墨管理系统</span>
        </header>
        <div className="login-arcs" />
      </section>
      <section className="login-panel">
        <div className="login-dots" />
        <div className="login-card">
          <h2>欢迎登录</h2>
          <p>请输入您的本地系统账户。</p>
          <Form
            layout="vertical"
            onFinish={submit}
            initialValues={{ username: usernames[0] ?? 'admin' }}
          >
            <Form.Item name="username" label="账户" rules={[{ required: true, message: '请输入账户' }]}>
              <AutoComplete
                size="large"
                prefix={<UserOutlined />}
                placeholder="请输入账户"
                options={usernames.map((name) => ({ value: name }))}
                filterOption={(input, option) =>
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </Form.Item>
            {usernames.length > 0 && (
              <div className="login-remember-bar">
                <span className="login-remember-hint">仅记住账号，不保存密码</span>
                <a
                  className="login-clear-link"
                  onClick={(event) => {
                    event.preventDefault();
                    clearHistory();
                  }}
                >
                  清除历史账号
                </a>
              </div>
            )}
            <Button block type="primary" htmlType="submit" size="large" loading={submitting}>
              登录
            </Button>
          </Form>
        </div>
        <footer className="login-footer">© 2026 余墨管理系统　保留所有权利</footer>
      </section>
    </div>
  );
}
function PasswordModal({ token, onDone }: { token: string; onDone: () => void }) {
  const { message } = AntApp.useApp();
  return (
    <Modal open title="修改密码" closable={false} footer={null}>
      <Form
        layout="vertical"
        onFinish={async (value) => {
          try {
            await api('/auth/change-password', { method: 'POST', body: JSON.stringify(value) }, token);
            message.success('密码已修改。');
            onDone();
          } catch (error) {
            message.error(error instanceof Error ? error.message : '修改失败。');
          }
        }}
      >
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8 }]}>
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          确认修改
        </Button>
      </Form>
    </Modal>
  );
}

type DimensionKey = 'day' | 'week' | 'month' | 'year';
type SeriesBucket = { key: string; label: string; inbound: number; outbound: number };
const DIMENSION_OPTIONS = DASHBOARD_DIMENSIONS.map(([value, label]) => ({ value, label }));
const PERIOD_OPTIONS = DASHBOARD_PERIODS.map(([value, label]) => ({ value, label }));
const INBOUND_COLOR = RIM.primary;
const OUTBOUND_COLOR = RIM.accent;

function trendOption(
  buckets: SeriesBucket[],
  kind: 'line' | 'bar',
  field: 'inbound' | 'outbound',
  name: string,
  color: string,
) {
  const labels = buckets.map((bucket) => bucket.label);
  const values = buckets.map((bucket) => bucket[field]);
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 16, top: 24, bottom: buckets.length > 30 ? 52 : 30 },
    xAxis: { type: 'category', data: labels, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', minInterval: 1 },
    dataZoom:
      buckets.length > 30 ? [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }] : [{ type: 'inside' }],
    series: [
      {
        name,
        type: kind,
        data: values,
        smooth: kind === 'line',
        itemStyle: { color },
        areaStyle: kind === 'line' ? { opacity: 0.12 } : undefined,
        barMaxWidth: 26,
      },
    ],
  };
}

function colorPieOption(rows: Array<{ colorFamily: string; count: number }>) {
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '色系分布',
        type: 'pie',
        radius: ['38%', '66%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        label: { formatter: '{b} {c}条' },
        data: rows.map((row) => ({ name: row.colorFamily, value: row.count })),
      },
    ],
  };
}

function weightDistOption(rows: Array<{ label: string; count: number }>) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 16, top: 24, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((row) => `${row.label} kg`) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '库存条数',
        type: 'bar',
        data: rows.map((row) => row.count),
        itemStyle: { color: INBOUND_COLOR },
        barMaxWidth: 36,
        label: { show: true, position: 'top' },
      },
    ],
  };
}

function locationRankOption(rows: Array<{ storageLocation: string; weightKg: number }>) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 56, top: 10, bottom: 24, containLabel: true },
    xAxis: { type: 'value', name: 'kg' },
    yAxis: { type: 'category', inverse: true, data: rows.map((row) => row.storageLocation) },
    series: [
      {
        name: '剩余重量',
        type: 'bar',
        data: rows.map((row) => row.weightKg),
        itemStyle: { color: INBOUND_COLOR },
        barMaxWidth: 16,
        label: { show: true, position: 'right' },
      },
    ],
  };
}

function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<any>();
  const [period, setPeriod] = useState<string>('all');
  const [inDimension, setInDimension] = useState<DimensionKey>('day');
  const [outDimension, setOutDimension] = useState<DimensionKey>('day');
  const [inBuckets, setInBuckets] = useState<SeriesBucket[]>([]);
  const [outBuckets, setOutBuckets] = useState<SeriesBucket[]>([]);
  const [colorDist, setColorDist] = useState<Array<{ colorFamily: string; count: number }>>([]);
  const [weightDist, setWeightDist] = useState<Array<{ label: string; count: number }>>([]);
  const [locationRank, setLocationRank] = useState<Array<{ storageLocation: string; weightKg: number }>>([]);
  useEffect(() => {
    const params = new URLSearchParams();
    if (period !== 'all') params.set('period', period);
    const query = params.size ? '?' + params.toString() : '';
    api('/dashboard' + query, {}, token)
      .then(setData)
      .catch((error) => console.error('dashboard load failed', error));
  }, [token, period]);
  useEffect(() => {
    api(`/dashboard/series?dimension=${inDimension}`, {}, token).then((result: any) =>
      setInBuckets(result.buckets ?? []),
    );
  }, [token, inDimension]);
  useEffect(() => {
    api(`/dashboard/series?dimension=${outDimension}`, {}, token).then((result: any) =>
      setOutBuckets(result.buckets ?? []),
    );
  }, [token, outDimension]);
  useEffect(() => {
    api<any>('/dashboard/color-distribution', {}, token).then((result) => setColorDist(result.rows ?? []));
    api<any>('/dashboard/weight-distribution', {}, token).then((result) => setWeightDist(result.buckets ?? []));
    api<any>('/dashboard/location-rank?limit=10', {}, token).then((result) => setLocationRank(result.rows ?? []));
  }, [token]);
  if (!data) return <Card loading />;
  const s = data.statistics;
  const periodLabel = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? '全部';
  const scoped = (allLabel: string, scopedLabel: string) =>
    period === 'all' ? allLabel : `${periodLabel}${scopedLabel}`;
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <Space wrap size={8}>
          <span>统计周期</span>
          <Segmented
            size="small"
            value={period}
            onChange={(value) => setPeriod(value as string)}
            options={PERIOD_OPTIONS}
          />
        </Space>
      </Card>
      <div className="metric-grid">
        <MetricCard title={scoped('在库条数', '入库·在库条数')} value={s.inStockCount} />
        <MetricCard
          title={scoped('已知重量合计', '入库·已知重量')}
          value={s.knownWeightKg ?? '—'}
          suffix={s.knownWeightKg === null ? '' : 'kg'}
        />
        <MetricCard title={scoped('未知重量条数', '入库·未知重量条数')} value={s.unknownWeightCount} />
        <MetricCard title={scoped('出库单 / 明细', '出库单 / 明细')} value={`${s.outboundOrders} / ${s.outboundLines}`} />
      </div>
      <div className="two-columns">
        <Card
          title="入库数量趋势"
          extra={
            <Segmented
              size="small"
              value={inDimension}
              onChange={(value) => setInDimension(value as DimensionKey)}
              options={DIMENSION_OPTIONS}
            />
          }
        >
          {inBuckets.length ? (
            <EChart option={trendOption(inBuckets, 'line', 'inbound', '入库数量', INBOUND_COLOR)} />
          ) : (
            <EmptyState />
          )}
        </Card>
        <Card
          title="入库数量统计"
          extra={
            <Segmented
              size="small"
              value={inDimension}
              onChange={(value) => setInDimension(value as DimensionKey)}
              options={DIMENSION_OPTIONS}
            />
          }
        >
          {inBuckets.length ? (
            <EChart option={trendOption(inBuckets, 'bar', 'inbound', '入库数量', INBOUND_COLOR)} />
          ) : (
            <EmptyState />
          )}
        </Card>
      </div>
      <div className="two-columns">
        <Card
          title="出库数量趋势"
          extra={
            <Segmented
              size="small"
              value={outDimension}
              onChange={(value) => setOutDimension(value as DimensionKey)}
              options={DIMENSION_OPTIONS}
            />
          }
        >
          {outBuckets.length ? (
            <EChart option={trendOption(outBuckets, 'line', 'outbound', '出库数量', OUTBOUND_COLOR)} />
          ) : (
            <EmptyState />
          )}
        </Card>
        <Card
          title="出库数量统计"
          extra={
            <Segmented
              size="small"
              value={outDimension}
              onChange={(value) => setOutDimension(value as DimensionKey)}
              options={DIMENSION_OPTIONS}
            />
          }
        >
          {outBuckets.length ? (
            <EChart option={trendOption(outBuckets, 'bar', 'outbound', '出库数量', OUTBOUND_COLOR)} />
          ) : (
            <EmptyState />
          )}
        </Card>
      </div>
      <div className="chart-grid">
        <Card className="chart-card" title="色系分布（在库）">
          {colorDist.length ? <EChart option={colorPieOption(colorDist)} height={300} /> : <EmptyState />}
        </Card>
        <Card className="chart-card" title="重量区间分布（在库）">
          {weightDist.some((bucket) => bucket.count > 0) ? (
            <EChart option={weightDistOption(weightDist)} height={300} />
          ) : (
            <EmptyState />
          )}
        </Card>
        <Card className="chart-card" title="库位剩余重量 Top 10">
          {locationRank.length ? <EChart option={locationRankOption(locationRank)} height={300} /> : <EmptyState />}
        </Card>
      </div>
      <div className="two-columns">
        <SimpleTable
          title="最近库存"
          extra={<Typography.Text type="secondary">{periodLabel}记录</Typography.Text>}
          rows={data.recentInventory}
          columns={['storageLocation', 'weightKg', 'colorFamily', 'createdAt']}
        />
        <SimpleTable
          title="最近出库"
          extra={<Typography.Text type="secondary">{periodLabel}记录</Typography.Text>}
          rows={data.recentOutbound}
          columns={['outboundNo', 'storageLocation', 'weightKg', 'outboundDate']}
        />
      </div>
    </Space>
  );
}
function Match({ token, rights }: { token: string; rights: string[] }) {
  const { message } = AntApp.useApp();
  const [result, setResult] = useState<any>();
  const [history, setHistory] = useState<any[]>([]);
  const [colorFamilies, setColorFamilies] = useState<string[]>([]);
  const [form] = Form.useForm();
  const lastRecordedRef = useRef<string | null>(null);
  const loadHistory = async () => {
    try {
      const data = await api<any>('/match/measurements?limit=30', {}, token);
      setHistory(data.rows ?? []);
    } catch {
      setHistory([]);
    }
  };
  useEffect(() => {
    loadHistory();
    api<any>('/match/color-families', {}, token)
      .then((data) => setColorFamilies(data.rows ?? []))
      .catch(() => setColorFamilies([]));
  }, [token]);
  const recordMeasurement = async (value: any, source: 'manual' | 'instrument', extra?: Record<string, unknown>) => {
    const signature = `${value.l},${value.a},${value.b},${source}`;
    if (signature === lastRecordedRef.current) return;
    await api('/match/measurements', { method: 'POST', body: JSON.stringify({ ...value, source, ...extra }) }, token);
    lastRecordedRef.current = signature;
  };
  const [lastSearch, setLastSearch] = useState<any>(null);
  const [quickOutbound, setQuickOutbound] = useState<any>(null);
  const runSearch = async (value: any, record: boolean) => {
    try {
      if (record) await recordMeasurement(value, 'manual');
      setLastSearch(value);
      setResult(await api('/match/search', { method: 'POST', body: JSON.stringify(value) }, token));
      if (record) await loadHistory();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '匹配失败。');
    }
  };
  const search = (value: any) => runSearch(value, true);
  const matchFromHistory = (row: any) => {
    const next = { ...form.getFieldsValue(), l: row.lStar, a: row.aStar, b: row.bStar };
    form.setFieldsValue(next);
    void runSearch(next, false);
  };
  const restoreMeasurement = async (row: any) => {
    try {
      await api(`/match/measurements/${row.id}/restore`, { method: 'POST' }, token);
      await loadHistory();
      message.success('已撤回删除。');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '撤回失败。');
      await loadHistory();
    }
  };
  const removeMeasurement = async (row: any) => {
    try {
      await api(`/match/measurements/${row.id}`, { method: 'DELETE' }, token);
      setHistory((rows) => rows.filter((item) => item.id !== row.id));
      const key = `measurement-undo-${row.id}`;
      message.open({
        key,
        duration: 10,
        type: 'success',
        content: (
          <span>
            测量记录已删除。
            <Button
              type="link"
              size="small"
              onClick={() => {
                message.destroy(key);
                void restoreMeasurement(row);
              }}
            >
              撤回
            </Button>
          </span>
        ),
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败。');
    }
  };
  const refreshResult = async () => {
    if (!lastSearch) return;
    try {
      setResult(await api('/match/search', { method: 'POST', body: JSON.stringify(lastSearch) }, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '刷新匹配结果失败。');
    }
  };
  const [measureOpen, setMeasureOpen] = useState(false);
  const [pantoneOpen, setPantoneOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const handleMeasured = async (measurement: XriteMeasurement) => {
    setMeasureOpen(false);
    form.setFieldsValue({ l: measurement.l, a: measurement.a, b: measurement.b });
    try {
      await recordMeasurement({ l: measurement.l, a: measurement.a, b: measurement.b }, 'instrument', {
        serial: measurement.instrumentSerial,
        model: measurement.instrumentModel,
        measureCondition: measurement.measureCondition,
        densityT: measurement.densityT,
      });
      await loadHistory();
      message.success('测量完成，Lab 已自动填入并保存到历史记录。');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存测量记录失败。');
    }
  };
  // 清空目标颜色输入表单（Lab、色差、色系、公式等），不影响匹配结果
  const clearTargetForm = () => {
    form.resetFields();
    message.success('目标颜色已清空。');
  };
  // 清空颜色匹配结果表，不影响目标颜色输入
  const clearMatchResult = () => {
    setResult(undefined);
    setLastSearch(null);
    message.success('颜色匹配结果已清空。');
  };
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="目标颜色">
        <Form form={form} layout="inline" className="match-form-inline" onFinish={search}>
          <Form.Item name="l" label="L" rules={[{ required: true }]}>
            <InputNumber />
          </Form.Item>
          <Form.Item name="a" label="a" rules={[{ required: true }]}>
            <InputNumber />
          </Form.Item>
          <Form.Item name="b" label="b" rules={[{ required: true }]}>
            <InputNumber />
          </Form.Item>
          <Form.Item name="formula" label="公式" initialValue="CIE94">
            <Select style={{ width: 160 }} options={MATCH_FORMULA_OPTIONS.map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="maxDeltaE" label="色差≤">
            <InputNumber min={0} placeholder="不限" style={{ width: 96 }} />
          </Form.Item>
          <Form.Item name="limit" label="前 N 条">
            <InputNumber min={1} max={500} placeholder="全部" style={{ width: 96 }} />
          </Form.Item>
          <Form.Item name="colorFamily" label="色系">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 160 }}
              options={colorFamilies.map((family) => ({ value: family, label: family }))}
            />
          </Form.Item>
          <Form.Item className="match-actions">
            <Space>
              <Button type="primary" htmlType="submit">
                查找相近颜色
              </Button>
              <Button onClick={() => setMeasureOpen(true)}>测量(M)</Button>
              <Button onClick={() => setPantoneOpen(true)}>色库</Button>
              <Button onClick={clearTargetForm}>清空</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card
        size="small"
        title="最近测量"
        extra={
          <Button
            type="link"
            size="small"
            icon={historyOpen ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {historyOpen ? '收起' : '展开'}
          </Button>
        }
      >
        {historyOpen && (
          <Table
            rowKey="id"
            size="small"
            dataSource={history}
            onRow={(row) => ({
              onClick: () => matchFromHistory(row),
              style: { cursor: 'pointer' },
              title: '点击用这条 Lab 匹配颜色',
            })}
            pagination={{ defaultPageSize: 8 }}
            scroll={{ x: true }}
            locale={{ emptyText: <EmptyState text="暂无测量记录，测量或查找颜色后会自动保存。" /> }}
            columns={[
              {
                title: '测量时间',
                dataIndex: 'measuredAt',
                render: (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : ''),
              },
              {
                title: '来源',
                dataIndex: 'source',
                render: (value) => (value === 'instrument' ? 'X-Rite 仪器' : '手动输入'),
              },
              { title: 'L', dataIndex: 'lStar' },
              { title: 'a', dataIndex: 'aStar' },
              { title: 'b', dataIndex: 'bStar' },
              { title: '密度T', dataIndex: 'densityT', render: print },
              {
                title: '仪器',
                key: 'instrument',
                render: (_, row) => [row.instrumentModel, row.instrumentSerial].filter(Boolean).join(' / '),
              },
              { title: '测量人', dataIndex: 'measuredBy' },
              {
                title: '操作',
                key: 'action',
                width: 64,
                render: (_: unknown, row: any) => (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeMeasurement(row);
                    }}
                  >
                    删除
                  </Button>
                ),
              },
            ]}
          />
        )}
        {!historyOpen && (
          <Typography.Text type="secondary">共 {history.length} 条测量记录，点击「展开」查看。</Typography.Text>
        )}
      </Card>
      {result && (
        <SimpleTable
          title={`颜色匹配结果（${result.formula ?? 'CIE94'} · 命中 ${result.matchCount ?? result.matches?.length ?? 0} / 在库 ${result.availableCount} 条）`}
          extra={<Button size="small" onClick={clearMatchResult}>清空</Button>}
          rows={result.matches}
          columns={[
            'storageLocation',
            { title: '复用来源', key: 'source', width: 240, render: (_: unknown, row: any) => sourceTag(row) },
            'rollerColorCode',
            'weightKg',
            'lStar',
            'aStar',
            'bStar',
            'deltaE',
            'colorFamily',
          ]}
          appendColumns={
            rights.includes('outbound.create')
              ? [
                  {
                    title: '操作',
                    key: 'action',
                    fixed: 'right',
                    width: 76,
                    render: (_: unknown, row: any) => (
                      <Button size="small" onClick={() => setQuickOutbound(row)}>
                        出库
                      </Button>
                    ),
                  },
                ]
              : undefined
          }
        />
      )}
      <MeasureModal open={measureOpen} onCancel={() => setMeasureOpen(false)} onSuccess={handleMeasured} />
      <PantoneLibraryModal
        open={pantoneOpen}
        onCancel={() => setPantoneOpen(false)}
        onSelect={(color) => {
          form.setFieldsValue({ l: color.l, a: color.a, b: color.b });
          setPantoneOpen(false);
          message.success(`已填入色号 ${color.name} 的 Lab 值，点击「查找相近颜色」进行匹配。`);
        }}
      />
      <QuickOutboundModal
        value={quickOutbound}
        token={token}
        onClose={() => setQuickOutbound(null)}
        onSaved={() => {
          setQuickOutbound(null);
          void refreshResult();
        }}
      />
    </Space>
  );
}

function QuickOutboundModal({
  value,
  token,
  onClose,
  onSaved,
}: {
  value: any;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  if (!value) return null;
  const unknownWeight = value.weightKg === null || value.weightKg === undefined;
  return (
    <Modal open title="快捷出库" onCancel={onClose} footer={null} destroyOnHidden width={460}>
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="库位">{value.storageLocation}</Descriptions.Item>
        <Descriptions.Item label="版辊号+色序">{value.rollerColorCode ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="色系">{value.colorFamily ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Lab">{`L ${value.lStar} / a ${value.aStar} / b ${value.bStar}`}</Descriptions.Item>
        <Descriptions.Item label="色差">{value.deltaE ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="当前库存">{unknownWeight ? '重量未知' : `${value.weightKg} kg`}</Descriptions.Item>
      </Descriptions>
      {unknownWeight && (
        <Alert type="warning" showIcon message="库位重量未知，请确认后手动填写。" style={{ marginBottom: 12 }} />
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={async (data) => {
          setSubmitting(true);
          try {
            await api(
              '/outbound',
              {
                method: 'POST',
                body: JSON.stringify({ lines: [{ residualInkId: value.id, weightKg: data.weightKg }] }),
              },
              token,
            );
            message.success('出库成功，出库单号已自动生成。');
            onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : '出库失败。');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <Form.Item
          name="weightKg"
          label="本次出库重量 (kg)"
          rules={[{ required: true, message: '请输入本次出库重量' }]}
        >
          <InputNumber
            min={0.001}
            precision={3}
            max={unknownWeight ? undefined : Number(value.weightKg)}
            style={{ width: '100%' }}
            placeholder="输入本次出库重量"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={submitting} block>
          确认出库
        </Button>
      </Form>
    </Modal>
  );
}

function InventoryPage({ token, rights }: { token: string; rights: string[] }) {
  const { message, modal } = AntApp.useApp();
  const [rows, setRows] = useState<Inventory[]>([]);
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState<any>();
  const [quickOutbound, setQuickOutbound] = useState<any>(null);
  const [preflight, setPreflight] = useState<any>();
  const [exporting, setExporting] = useState(false);
  const [deletedRows, setDeletedRows] = useState<any[]>([]);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [filterForm] = Form.useForm();
  const buildQuery = (values: Record<string, unknown>) => {
    const query = new URLSearchParams();
    if (values.keyword) query.set('keyword', String(values.keyword));
    if (values.status) query.set('status', String(values.status));
    const dateRange = values.dateRange as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null | undefined;
    if (dateRange?.[0]) query.set('from', dateRange[0].format('YYYY-MM-DD'));
    if (dateRange?.[1]) query.set('to', dateRange[1].format('YYYY-MM-DD'));
    if (values.targetL != null && values.targetA != null && values.targetB != null) {
      query.set('targetL', String(values.targetL));
      query.set('targetA', String(values.targetA));
      query.set('targetB', String(values.targetB));
    }
    return query.toString();
  };
  const load = async (nextFilters = filters) => {
    try {
      const q = buildQuery(nextFilters);
      setRows((await api<any>(`/inventory${q ? `?${q}` : ''}`, {}, token)).rows);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    }
  };
  const loadDeleted = async () => {
    try {
      setDeletedRows((await api<any>('/inventory/deleted', {}, token)).rows ?? []);
    } catch {
      setDeletedRows([]);
    }
  };
  const restoreInventory = async (row: any) => {
    try {
      await api(`/inventory/${row.id}/restore`, { method: 'POST' }, token);
      message.success(`库位 ${row.storageLocation} 已恢复。`);
      await Promise.all([load(), loadDeleted()]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复失败。');
    }
  };
  const purgeInventory = (row: any) => {
    modal.confirm({
      title: '彻底清理该记录？',
      content: '库位 ' + row.storageLocation + ' 清理后不可恢复。',
      okText: '清理',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api(`/inventory/${row.id}/purge`, { method: 'DELETE' }, token);
          message.success('已彻底清理。');
          await loadDeleted();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '清理失败。');
        }
      },
    });
  };
  const removeInventory = (row: Inventory) => {
    modal.confirm({
      title: '确认删除该库存？',
      content: '库位 ' + row.storageLocation + ' 将移入「最近删除」，可随时恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api('/inventory/' + row.id, { method: 'DELETE' }, token);
          message.success('已删除。');
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败。');
        }
      },
    });
  };
  const exportInventory = async () => {
    setExporting(true);
    try {
      await downloadExcel('/excel/export/inventory', filters, token);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const cols: any[] = INVENTORY_COLUMNS.map(([key, title]) => ({
    title,
    dataIndex: key,
    width: 132,
    render: print,
    ...(key === 'storageLocation' || key === 'rollerColorCode' ? { fixed: 'left' as const } : {}),
  }));
  cols.splice(1, 0, {
    title: '来源配方',
    key: 'source',
    width: 220,
    render: (_: unknown, row: any) => sourceTag(row),
  });
  cols.push({
    title: '操作',
    key: 'action',
    fixed: 'right',
    width: 168,
    render: (_: unknown, row: Inventory) => (
      <Space size={4}>
        <Button size="small" onClick={() => setEditing(row)} disabled={!rights.includes('inventory.update')}>
          编辑
        </Button>
        {rights.includes('outbound.create') && (
          <Button size="small" onClick={() => setQuickOutbound(row)}>
            出库
          </Button>
        )}
        {rights.includes('inventory.delete') && (
          <Button size="small" danger onClick={() => removeInventory(row)}>
            删除
          </Button>
        )}
      </Space>
    ),
  } as any);
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      setPreflight(await api('/excel/preview', { method: 'POST', body: form }, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '预检失败。');
    }
    return false;
  };
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <Form
          form={filterForm}
          layout="inline"
          onFinish={(values) => {
            setFilters(values);
            void load(values);
          }}
        >
          <Form.Item name="keyword" label="关键词">
            <Input allowClear placeholder="库位、版辊号或色系" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 160 }}
              options={[
                { value: '在库', label: '在库' },
                { value: '已出清', label: '已出清' },
              ]}
            />
          </Form.Item>
          <Form.Item name="dateRange" label="入库日期">
            <DatePicker.RangePicker allowClear />
          </Form.Item>
          <Form.Item name="targetL" label="目标 L" style={{ marginBottom: 8 }}>
            <InputNumber placeholder="可选" style={{ width: 96 }} />
          </Form.Item>
          <Form.Item name="targetA" label="a">
            <InputNumber placeholder="可选" style={{ width: 96 }} />
          </Form.Item>
          <Form.Item name="targetB" label="b">
            <InputNumber placeholder="可选" style={{ width: 96 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            筛选
          </Button>
          <Button
            onClick={() => {
              filterForm.resetFields();
              setFilters({});
              void load({});
            }}
          >
            重置
          </Button>
          {rights.includes('inventory.create') && <Button onClick={() => setEditing({})}>新增库存</Button>}
          <Upload accept=".xlsx,.xlsm" beforeUpload={upload} showUploadList={false}>
            <Button icon={<FileExcelOutlined />}>Excel 导入预检</Button>
          </Upload>
          {rights.includes('inventory.export') && (
            <Button icon={<ExportOutlined />} loading={exporting} onClick={exportInventory}>
              导出 Excel
            </Button>
          )}
          {rights.includes('inventory.delete') && (
            <Dropdown
              open={deletedOpen}
              onOpenChange={(open) => {
                setDeletedOpen(open);
                if (open) void loadDeleted();
              }}
              trigger={['click']}
              dropdownRender={() => (
                <div className="deleted-panel">
                  <div className="deleted-panel-title">最近删除（{deletedRows.length}）</div>
                  {deletedRows.length === 0 && <EmptyState text="暂无最近删除的记录" />}
                  {deletedRows.map((row) => (
                    <div className="deleted-row" key={row.id}>
                      <div className="deleted-row-main">
                        <b>{row.storageLocation}</b>
                        <small>{row.deletedAt ? dayjs(row.deletedAt).format('YYYY-MM-DD HH:mm') : ''} 删除</small>
                      </div>
                      <Space size={4}>
                        <Button size="small" type="link" onClick={() => void restoreInventory(row)}>
                          恢复
                        </Button>
                        <Button size="small" type="link" danger onClick={() => purgeInventory(row)}>
                          清理
                        </Button>
                      </Space>
                    </div>
                  ))}
                </div>
              )}
            >
              <Button icon={<DeleteOutlined />}>最近删除</Button>
            </Dropdown>
          )}
        </Form>
      </Card>
      {preflight && (
        <Card size="small" className="import-preview" title="Excel 导入预检">
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="库存可导入">{preflight.inventory.willImport}</Descriptions.Item>
            <Descriptions.Item label="库存跳过">{preflight.inventory.willSkip}</Descriptions.Item>
            <Descriptions.Item label="出库可导入">{preflight.outbound.willImport}</Descriptions.Item>
            <Descriptions.Item label="出库跳过">{preflight.outbound.willSkip}</Descriptions.Item>
          </Descriptions>
          <Button
            type="primary"
            onClick={async () => {
              try {
                const r = await api<any>(
                  '/excel/commit',
                  { method: 'POST', body: JSON.stringify({ token: preflight.token }) },
                  token,
                );
                message.success(`导入完成：成功 ${r.imported} 条，跳过 ${r.skipped} 条，错误 ${r.errors} 条。`);
                setPreflight(null);
                await load();
              } catch (error) {
                message.error(error instanceof Error ? error.message : 'Excel 导入失败。');
              }
            }}
          >
            确认追加
          </Button>
        </Card>
      )}
      <Card className="excel-grid-card">
        <Table
          rowKey="id"
          className="excel-style-table"
          dataSource={rows}
          columns={cols as any}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          scroll={{ x: 1510, y: 'calc(100vh - 310px)' }}
        />
      </Card>
      {editing && (
        <InventoryModal
          value={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <QuickOutboundModal
        value={quickOutbound}
        token={token}
        onClose={() => setQuickOutbound(null)}
        onSaved={() => {
          setQuickOutbound(null);
          void load();
        }}
      />
    </Space>
  );
}
function InventoryModal({
  value,
  token,
  onClose,
  onSaved,
}: {
  value: any;
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [measureOpen, setMeasureOpen] = useState(false);
  const handleMeasured = (measurement: XriteMeasurement) => {
    setMeasureOpen(false);
    form.setFieldsValue({ lStar: measurement.l, aStar: measurement.a, bStar: measurement.b });
    message.success('已测量并填入 Lab 值，仍可手动修改。');
  };
  return (
    <Modal open title={value.id ? '编辑余墨库存' : '新增余墨库存'} onCancel={onClose} footer={null}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          ...value,
          inboundDate: value.inboundDate ? dayjs(value.inboundDate) : value.id ? undefined : dayjs(),
        }}
        onFinish={async (data) => {
          try {
            const payload = {
              ...data,
              inboundDate: data.inboundDate
                ? dayjs.isDayjs(data.inboundDate)
                  ? data.inboundDate.format('YYYY-MM-DD')
                  : data.inboundDate
                : null,
            };
            await api(
              value.id ? `/inventory/${value.id}` : '/inventory',
              { method: value.id ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
              token,
            );
            message.success('已保存。');
            onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : '保存失败。');
          }
        }}
      >
        <div className="form-grid">
          {[
            ['storageLocation', '库位'],
            ['rollerColorCode', '版辊号+色序'],
            ['inboundDate', '入库日期'],
            ['weightKg', '重量 kg'],
            ['lStar', 'L'],
            ['aStar', 'a'],
            ['bStar', 'b'],
            ['colorFamily', '色系'],
            ['note2', '备注2'],
            ['note3', '备注3'],
          ].map(([name, label]) => (
            <Fragment key={name}>
              {name === 'lStar' && (
                <div className="lab-measure-row">
                  <span>Lab 可手动输入，也可用仪器测量自动填入。</span>
                  <Button size="small" icon={<BgColorsOutlined />} onClick={() => setMeasureOpen(true)}>
                    仪器测量 Lab
                  </Button>
                </div>
              )}
              <Form.Item name={name} label={label} rules={name === 'storageLocation' ? [{ required: true }] : []}>
                {name === 'inboundDate' ? (
                  <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                ) : name === 'colorFamily' ? (
                  <AutoComplete
                    allowClear
                    placeholder="可选择或手动输入"
                    options={COLOR_FAMILY_OPTIONS.map((value) => ({ value, label: value }))}
                  />
                ) : (
                  <Input />
                )}
              </Form.Item>
            </Fragment>
          ))}
        </div>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} block>
          保存
        </Button>
      </Form>
      <MeasureModal open={measureOpen} onCancel={() => setMeasureOpen(false)} onSuccess={handleMeasured} />
    </Modal>
  );
}

function OutboundPage({ token, rights }: { token: string; rights: string[] }) {
  const { message } = AntApp.useApp();
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [outboundNo, setOutboundNo] = useState('');
  const [outboundDate, setOutboundDate] = useState<dayjs.Dayjs | null>(dayjs());
  const [keyword, setKeyword] = useState('');
  const [range, setRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [exporting, setExporting] = useState(false);
  const filterParams = (nextKeyword = keyword, nextRange = range) => {
    const params: Record<string, unknown> = { keyword: nextKeyword };
    if (nextRange?.[0]) params.from = nextRange[0].format('YYYY-MM-DD');
    if (nextRange?.[1]) params.to = nextRange[1].format('YYYY-MM-DD');
    return params;
  };
  const load = async (nextKeyword = keyword, nextRange = range) => {
    setInventory(await api('/inventory/active', {}, token));
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filterParams(nextKeyword, nextRange))) query.set(key, String(value));
    setRows((await api<any>(`/outbound${query.size ? `?${query}` : ''}`, {}, token)).rows);
  };
  const exportOutbound = async () => {
    setExporting(true);
    try {
      await downloadExcel('/excel/export/outbound', filterParams(), token);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="创建出库单">
        <Space wrap>
          <Input
            placeholder="出库单号（留空自动生成）"
            value={outboundNo}
            onChange={(e) => setOutboundNo(e.target.value)}
          />
          <DatePicker
            value={outboundDate}
            onChange={(value) => setOutboundDate(value)}
            format="YYYY-MM-DD"
            allowClear={false}
          />
          <Select
            placeholder="加入库存明细"
            style={{ width: 320 }}
            options={inventory.map((item) => ({
              value: item.id,
              label: `${item.storageLocation}（${item.weightKg === null ? '重量未知' : `${item.weightKg} kg`}）`,
            }))}
            onSelect={(id) => setLines([...lines, { residualInkId: id, weightKg: undefined }])}
          />
          {rights.includes('outbound.create') && (
            <Button
              type="primary"
              onClick={async () => {
                try {
                  await api(
                    '/outbound',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        outboundNo,
                        outboundDate: outboundDate ? outboundDate.format('YYYY-MM-DD') : undefined,
                        lines,
                      }),
                    },
                    token,
                  );
                  message.success('出库单已创建。');
                  setLines([]);
                  setOutboundNo('');
                  setOutboundDate(dayjs());
                  load();
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '出库失败。');
                }
              }}
            >
              确认出库
            </Button>
          )}
        </Space>
        {lines.map((line, index) => {
          const item = inventory.find((entry) => entry.id === line.residualInkId);
          return (
            <div className="outbound-line" key={`${line.residualInkId}-${index}`}>
              <Tag>{item?.storageLocation}</Tag>
              <Typography.Text type="secondary">
                剩余 {item?.weightKg === null || item?.weightKg === undefined ? '未知' : `${item.weightKg} kg`}
              </Typography.Text>
              <InputNumber
                placeholder="本次重量 kg"
                min={0.001}
                precision={3}
                max={item?.weightKg === null || item?.weightKg === undefined ? undefined : Number(item.weightKg)}
                value={line.weightKg}
                onChange={(weightKg) =>
                  setLines(lines.map((entry, i) => (i === index ? { ...entry, weightKg } : entry)))
                }
              />
              <Button danger type="text" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                移除
              </Button>
            </div>
          );
        })}
      </Card>
      <SimpleTable
        title="出库记录"
        extra={
          <Space wrap size={8} className="toolbar-actions">
            <Input
              allowClear
              size="small"
              placeholder="单号、库位或版辊号"
              style={{ width: 160 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => load()}
            />
            <DatePicker.RangePicker
              size="small"
              value={range as any}
              onChange={(value) => setRange(value)}
              allowClear
            />
            <Button size="small" type="primary" onClick={() => load()}>
              查询
            </Button>
            {rights.includes('outbound.export') && (
              <Button size="small" icon={<ExportOutlined />} loading={exporting} onClick={exportOutbound}>
                导出 Excel
              </Button>
            )}
          </Space>
        }
        rows={rows}
        columns={[
          'outboundDate',
          'outboundNo',
          'storageLocation',
          'rollerColorCode',
          'inboundDate',
          'weightKg',
          'lStar',
          'aStar',
          'bStar',
          'deltaE',
          'colorFamily',
          'note2',
          'note3',
        ]}
      />
    </Space>
  );
}

function UsersPage({ token, rights }: { token: string; rights: string[] }) {
  const { message, modal } = AntApp.useApp();
  const canManage = rights.includes('users.manage');
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any>();
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState<any>();
  const [resetting, setResetting] = useState<any>();
  const [filterForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();
  const load = async (nextFilters: Record<string, unknown> = filters) => {
    try {
      const query = new URLSearchParams();
      if (nextFilters.keyword) query.set('keyword', String(nextFilters.keyword));
      if (nextFilters.roleCode) query.set('roleCode', String(nextFilters.roleCode));
      if (nextFilters.enabled) query.set('enabled', String(nextFilters.enabled));
      const q = query.toString();
      setUsers((await api<any>(`/users${q ? `?${q}` : ''}`, {}, token)).rows);
      setRoles(await api('/roles', {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    }
  };
  useEffect(() => {
    load();
  }, []);
  const updateUser = async (id: string, body: Record<string, unknown>, successText: string) => {
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, token);
      message.success(successText);
      await load();
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败。');
      return false;
    }
  };
  const toggleEnabled = (row: any) => {
    if (!row.enabled) {
      void updateUser(row.id, { enabled: true }, '已启用。');
      return;
    }
    modal.confirm({
      title: `确认停用用户 ${row.username}？`,
      content: `停用后「${row.displayName}」将无法登录系统。`,
      okText: '停用',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => updateUser(row.id, { enabled: false }, '已停用。'),
    });
  };
  const removeUser = (row: any) => {
    modal.confirm({
      title: '确认删除该用户？',
      content: `用户 ${row.username}（${row.displayName}）删除后不可恢复，其历史操作日志将保留。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api(`/users/${row.id}`, { method: 'DELETE' }, token);
          message.success('已删除。');
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败。');
        }
      },
    });
  };
  const roleOptions = (roles?.roles ?? []).map((role: any) => ({ value: role.code, label: role.name }));
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {canManage && (
        <Card title="新增用户">
          <Form
            form={createForm}
            layout="inline"
            onFinish={async (value) => {
              try {
                await api('/users', { method: 'POST', body: JSON.stringify(value) }, token);
                message.success(value.mustChangePassword === false ? '用户已创建。' : '用户已创建，首次登录需改密。');
                createForm.resetFields();
                load();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '创建失败。');
              }
            }}
          >
            <Form.Item name="username" rules={[{ required: true }]}>
              <Input placeholder="用户名" />
            </Form.Item>
            <Form.Item name="displayName">
              <Input placeholder="显示名称" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
              <Input.Password placeholder="初始密码" />
            </Form.Item>
            <Form.Item name="roleCode" initialValue="user">
              <Select
                style={{ width: 96 }}
                options={[
                  { value: 'operator', label: '操作员' },
                  { value: 'user', label: '普通用户' },
                ]}
              />
            </Form.Item>
            <Form.Item name="mustChangePassword" label="首次登录需修改密码" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              新增
            </Button>
          </Form>
        </Card>
      )}
      <Card className="page-toolbar">
        <Form
          form={filterForm}
          layout="inline"
          onFinish={(values) => {
            setFilters(values);
            void load(values);
          }}
        >
          <Form.Item name="keyword" label="关键词">
            <Input allowClear placeholder="用户名或姓名" />
          </Form.Item>
          <Form.Item name="roleCode" label="角色">
            <Select allowClear placeholder="全部角色" style={{ width: 160 }} options={roleOptions} />
          </Form.Item>
          <Form.Item name="enabled" label="状态">
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 96 }}
              options={[
                { value: 'true', label: '启用' },
                { value: 'false', label: '停用' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
            查询
          </Button>
          <Button
            onClick={() => {
              filterForm.resetFields();
              setFilters({});
              void load({});
            }}
          >
            清空
          </Button>
        </Form>
      </Card>
      <SimpleTable
        title="用户"
        rows={users}
        columns={['username', 'displayName', 'roleName', 'enabled', 'mustChangePassword', 'lastLoginAt']}
        appendColumns={
          canManage
            ? [
                {
                  title: '操作',
                  key: 'action',
                  fixed: 'right',
                  width: 260,
                  render: (_: unknown, row: any) => (
                    <Space size={4}>
                      <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(row)}>
                        编辑
                      </Button>
                      <Button size="small" icon={<KeyOutlined />} onClick={() => setResetting(row)}>
                        重置密码
                      </Button>
                      <Button size="small" danger={row.enabled} onClick={() => toggleEnabled(row)}>
                        {row.enabled ? '停用' : '启用'}
                      </Button>
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeUser(row)}>
                        删除
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []
        }
      />
      {roles?.roles
        .filter((role: any) => role.code !== 'admin')
        .map((role: any) => (
          <Card key={role.code} title={`${role.name} 权限`}>
            <Space wrap>
              {roles.permissions.map(([code, label]: [string, string]) => (
                <Button
                  size="small"
                  type={role.permissionCodes.includes(code) ? 'primary' : 'default'}
                  disabled={code === 'inventory.import' || !rights.includes('roles.manage')}
                  onClick={async () => {
                    const next = role.permissionCodes.includes(code)
                      ? role.permissionCodes.filter((v: string) => v !== code)
                      : [...role.permissionCodes, code];
                    await api(
                      `/roles/${role.code}/permissions`,
                      { method: 'PATCH', body: JSON.stringify({ permissionCodes: next }) },
                      token,
                    );
                    load();
                  }}
                >
                  {label}
                </Button>
              ))}
            </Space>
          </Card>
        ))}
      <Modal
        title={`编辑用户 ${editing?.username ?? ''}`}
        open={Boolean(editing)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        onCancel={() => setEditing(undefined)}
        onOk={() => editForm.submit()}
      >
        <Form
          key={editing?.id ?? 'none'}
          form={editForm}
          layout="vertical"
          initialValues={{ displayName: editing?.displayName, roleCode: editing?.roleCode }}
          onFinish={async (values) => {
            if (await updateUser(editing.id, values, '用户信息已更新。')) setEditing(undefined);
          }}
        >
          <Form.Item label="用户名">
            <Input value={editing?.username} disabled />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true, message: '请输入显示名称。' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="roleCode" label="角色" rules={[{ required: true, message: '请选择角色。' }]}>
            <Select options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`重置密码 ${resetting?.username ?? ''}`}
        open={Boolean(resetting)}
        okText="重置"
        cancelText="取消"
        destroyOnHidden
        onCancel={() => setResetting(undefined)}
        onOk={() => resetForm.submit()}
      >
        <Form
          key={resetting?.id ?? 'none'}
          form={resetForm}
          layout="vertical"
          initialValues={{ mustChangePassword: true }}
          onFinish={async (values) => {
            if (await updateUser(resetting.id, values, '密码已重置，该账号的登录锁定已一并解除。'))
              setResetting(undefined);
          }}
        >
          <Form.Item
            name="password"
            label="新密码"
            rules={[{ required: true, min: 8, message: '新密码至少需要 8 个字符。' }]}
          >
            <Input.Password placeholder="至少 8 个字符" />
          </Form.Item>
          <Form.Item name="mustChangePassword" label="下次登录需修改密码" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
function BackupPage({ token, rights }: { token: string; rights: string[] }) {
  const { message, modal } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [preview, setPreview] = useState<any>();
  const load = () => api<any>('/backup', {}, token).then((v) => setRows(v.rows));
  useEffect(() => {
    load();
  }, []);
  const preflight = async (file: File) => {
    const data = new FormData();
    data.append('file', file);
    try {
      setPreview(await api('/backup/preview-restore', { method: 'POST', body: data }, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '预检失败。');
    }
    return false;
  };
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space wrap>
          {rights.includes('backup.manage') && (
            <>
              <Button
                type="primary"
                onClick={async () => {
                  const r = await api<any>('/backup', { method: 'POST' }, token);
                  message.success(`备份已创建：${r.fileName}`);
                  load();
                }}
              >
                创建完整备份
              </Button>
              <Upload accept=".json" beforeUpload={preflight} showUploadList={false}>
                <Button>选择恢复文件并预检</Button>
              </Upload>
            </>
          )}
          {preview && (
            <Button
              danger
              onClick={() =>
                modal.confirm({
                  title: '确认覆盖恢复',
                  content: '恢复会覆盖当前简易版的业务、用户权限、配置和日志。',
                  onOk: async () => {
                    await api(
                      '/backup/restore',
                      { method: 'POST', body: JSON.stringify({ token: preview.token }) },
                      token,
                    );
                    message.success('恢复完成，请重新登录。');
                    load();
                  },
                })
              }
            >
              确认恢复
            </Button>
          )}
        </Space>
        {preview?.counts && (
          <Descriptions size="small" column={3} bordered style={{ marginTop: 12 }} title="恢复预检摘要">
            {Object.entries(preview.counts).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                {String(value)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </Card>
      <SimpleTable
        title="备份与恢复记录"
        rows={rows}
        columns={['jobType', 'status', 'fileName', 'sha256', 'createdAt', 'finishedAt']}
      />
    </Space>
  );
}
function LogsPage({ token, rights }: { token: string; rights: string[] }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const load = () => api<any>(`/logs?keyword=${encodeURIComponent(keyword)}`, {}, token).then((r) => setRows(r.rows));
  useEffect(() => {
    load();
  }, []);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <Space>
          <Input placeholder="操作人、对象或备注" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Button onClick={load}>查询</Button>
          {rights.includes('logs.export') && (
            <Button
              icon={<ExportOutlined />}
              onClick={async () => {
                try {
                  await downloadExcel('/excel/export/logs', { keyword }, token);
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '导出失败。');
                }
              }}
            >
              导出 Excel
            </Button>
          )}
        </Space>
      </Card>
      <SimpleTable
        title="操作日志"
        rows={rows}
        columns={['operationTime', 'username', 'operationType', 'targetTable', 'targetId', 'remark', 'ipAddress']}
      />
    </Space>
  );
}
function StatisticsPage({ token }: { token: string }) {
  const { message } = AntApp.useApp();
  const now = dayjs();
  const [year, setYear] = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);
  const [data, setData] = useState<any>();
  const [detailDate, setDetailDate] = useState<string | null>(null);
  useEffect(() => {
    api<any>('/statistics/monthly?year=' + year + '&month=' + month, {}, token)
      .then(setData)
      .catch((error) => message.error(error instanceof Error ? error.message : '加载统计数据失败。'));
  }, [token, year, month]);
  const yearOptions: Array<{ value: number; label: string }> = [];
  for (let value = 2020; value <= now.year(); value += 1) yearOptions.push({ value, label: value + ' 年' });
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: index + 1 + ' 月' }));
  const days = (data?.days ?? []) as Array<{ date: string; inbound: number; outbound: number }>;
  const total = data?.total as { inbound: number; outbound: number } | undefined;
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="page-toolbar">
        <Space wrap size={8}>
          <span>年份</span>
          <Select style={{ width: 96 }} value={year} options={yearOptions} onChange={(value) => setYear(value)} />
          <span>月份</span>
          <Select style={{ width: 96 }} value={month} options={monthOptions} onChange={(value) => setMonth(value)} />
          <Typography.Text type="secondary">双击某一行可查看当日出入库明细。</Typography.Text>
        </Space>
      </Card>
      <Card title={year + ' 年 ' + month + ' 月出入库日报'}>
        <Table
          rowKey="date"
          loading={!data}
          dataSource={days}
          pagination={false}
          onRow={(row: any) => ({ onDoubleClick: () => setDetailDate(row.date) })}
          locale={{ emptyText: <EmptyState text="暂无数据" /> }}
          columns={[
            { title: '日期', dataIndex: 'date' },
            { title: '入库数量', dataIndex: 'inbound' },
            { title: '出库数量', dataIndex: 'outbound' },
            {
              title: '当日合计',
              key: 'sum',
              render: (_: unknown, row: { inbound: number; outbound: number }) => row.inbound + row.outbound,
            },
          ]}
          summary={() => (
            <Table.Summary.Row className="stats-total-row">
              <Table.Summary.Cell index={0}>本月合计</Table.Summary.Cell>
              <Table.Summary.Cell index={1}>{total ? '入库 ' + total.inbound + ' 条' : ''}</Table.Summary.Cell>
              <Table.Summary.Cell index={2}>{total ? '出库 ' + total.outbound + ' 条' : ''}</Table.Summary.Cell>
              <Table.Summary.Cell index={3}>{total ? total.inbound + total.outbound : ''}</Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Card>
      <DailyDetailModal date={detailDate} token={token} onClose={() => setDetailDate(null)} />
    </Space>
  );
}

function DailyDetailModal({ date, token, onClose }: { date: string | null; token: string; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const [kind, setKind] = useState<'inbound' | 'outbound'>('inbound');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (date) setKind('inbound');
  }, [date]);
  useEffect(() => {
    if (!date) return;
    setLoading(true);
    api<any>('/statistics/daily?date=' + date + '&kind=' + kind, {}, token)
      .then((result) => setRows(result.rows ?? []))
      .catch((error) => message.error(error instanceof Error ? error.message : '加载明细失败。'))
      .finally(() => setLoading(false));
  }, [date, kind, token]);
  const columns =
    kind === 'inbound'
      ? ['storageLocation', 'rollerColorCode', 'weightKg', 'colorFamily']
      : ['outboundNo', 'storageLocation', 'rollerColorCode', 'weightKg', 'colorFamily'];
  return (
    <Modal
      open={!!date}
      title={date ? date + ' 出入库明细' : ''}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnHidden
    >
      <Tabs
        activeKey={kind}
        onChange={(key) => setKind(key as 'inbound' | 'outbound')}
        items={[
          { key: 'inbound', label: '入库' },
          { key: 'outbound', label: '出库' },
        ]}
      />
      <Table
        rowKey={(row, index) => row.id ?? kind + '-' + index}
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        locale={{ emptyText: <EmptyState text={kind === 'inbound' ? '当日无入库记录' : '当日无出库记录'} /> }}
        columns={columns.map((dataIndex) => ({
          title: FIELD_LABELS[dataIndex] ?? dataIndex,
          dataIndex,
          render: print,
        }))}
      />
    </Modal>
  );
}
const FIELD_LABELS: Record<string, string> = {
  storageLocation: '库位',
  rollerColorCode: '版辊号+色序',
  inboundDate: '入库日期',
  outboundDate: '出库日期',
  outboundNo: '出库单号',
  weightKg: '重量 (kg)',
  colorFamily: '色系',
  createdAt: '创建时间',
  lStar: 'L',
  aStar: 'a',
  bStar: 'b',
  deltaE: '色差',
  note2: '备注2',
  note3: '备注3',
  username: '用户名',
  displayName: '姓名',
  roleName: '角色',
  enabled: '启用',
  mustChangePassword: '需修改密码',
  lastLoginAt: '最近登录',
  jobType: '类型',
  status: '状态',
  fileName: '文件名',
  finishedAt: '完成时间',
  operationTime: '操作时间',
  operationType: '操作类型',
  targetTable: '对象',
  targetId: '对象编号',
  remark: '备注',
  ipAddress: 'IP 地址',
};

function SimpleTable({
  title,
  rows,
  columns,
  extra,
  appendColumns,
}: {
  title: string;
  rows: any[];
  columns: Array<string | Record<string, unknown>>;
  extra?: ReactNode;
  appendColumns?: any[];
}) {
  return (
    <Card title={title} extra={extra}>
      <Table
        rowKey={(row, index) => row.id ?? `${index}-${row.storageLocation ?? ''}`}
        dataSource={rows}
        pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
        scroll={{ x: true }}
        locale={{ emptyText: <EmptyState text="暂无记录" /> }}
        columns={[
          ...columns.map((column) =>
            typeof column === 'string' ? { title: FIELD_LABELS[column] ?? column, dataIndex: column, render: print } : column),
          ...(appendColumns ?? []),
        ]}
      />
    </Card>
  );
}
function sourceTag(row: any) {
  const source = row.source;
  if (!source) return '';
  const parts = [
    source.productName ?? source.productCode,
    source.colorName ? `${source.colorName}${source.versionNo ? ` V${source.versionNo}` : ''}` : null,
  ].filter(Boolean);
  return <Tag color="cyan">可复用余墨{parts.length ? ` · ${parts.join(' / ')}` : ''}</Tag>;
}

function print(value: any) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (typeof value === 'number' && !Number.isInteger(value))
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}
