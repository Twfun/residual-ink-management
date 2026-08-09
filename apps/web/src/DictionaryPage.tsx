import { useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Tabs, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from './api';
import { ReorderableTable } from './components/ReorderableTable';
import { EmptyState } from './components/ui';
import { COLOR_FAMILY_OPTIONS } from './contracts';

type DictKind = 'ink-colors' | 'ink-manufacturers' | 'customers';

type FieldDef = {
  name: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'textarea' | 'select';
  options?: Array<{ value: string; label: string }>;
  maxLength?: number;
  span?: number;
};

type DictConfig = {
  kind: DictKind;
  title: string;
  searchPlaceholder: string;
  columns: Array<{ dataIndex: string; title: string }>;
  fields: FieldDef[];
  storageKey: string;
};

const STATUS_OPTIONS = [
  { value: '启用', label: '启用' },
  { value: '停用', label: '停用' },
];

const DICT_CONFIGS: DictConfig[] = [
  {
    kind: 'ink-colors',
    title: '油墨颜色',
    searchPlaceholder: '颜色名称 / 编码',
    storageKey: 'dict-ink-colors',
    columns: [
      { dataIndex: 'name', title: '颜色名称' },
      { dataIndex: 'colorCode', title: '颜色编码' },
      { dataIndex: 'colorFamily', title: '色系' },
      { dataIndex: 'sortOrder', title: '排序' },
      { dataIndex: 'status', title: '状态' },
      { dataIndex: 'remark', title: '备注' },
    ],
    fields: [
      { name: 'name', label: '颜色名称', required: true, maxLength: 120 },
      { name: 'colorCode', label: '颜色编码', maxLength: 80 },
      {
        name: 'colorFamily',
        label: '色系',
        type: 'select',
        options: COLOR_FAMILY_OPTIONS.map((value) => ({ value, label: value })),
      },
      { name: 'sortOrder', label: '排序', type: 'number' },
      { name: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS },
      { name: 'remark', label: '备注', type: 'textarea', maxLength: 1000 },
    ],
  },
  {
    kind: 'ink-manufacturers',
    title: '油墨厂家',
    searchPlaceholder: '厂家名称',
    storageKey: 'dict-ink-manufacturers',
    columns: [{ dataIndex: 'name', title: '厂家名称' }],
    fields: [{ name: 'name', label: '厂家名称', required: true, maxLength: 200 }],
  },
  {
    kind: 'customers',
    title: '客户管理',
    searchPlaceholder: '客户名称 / 编码',
    storageKey: 'dict-customers',
    columns: [
      { dataIndex: 'name', title: '客户名称' },
      { dataIndex: 'code', title: '客户编码' },
    ],
    fields: [
      { name: 'name', label: '客户名称', required: true, maxLength: 200 },
      { name: 'code', label: '客户编码', maxLength: 80 },
    ],
  },
];

function printCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function DictionaryGrid({ config, token }: { config: DictConfig; token: string }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const query = nextKeyword ? `?keyword=${encodeURIComponent(nextKeyword)}` : '';
      const result = await api<any>(`/dictionary/${config.kind}${query}`, {}, token);
      setRows(result.rows ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load('');
  }, [config.kind, token]);

  const submit = async (values: Record<string, unknown>) => {
    try {
      if (editing?.id) {
        await api(`/dictionary/${config.kind}/${editing.id}`, { method: 'PUT', body: JSON.stringify(values) }, token);
        message.success('已保存。');
      } else {
        await api(`/dictionary/${config.kind}`, { method: 'POST', body: JSON.stringify(values) }, token);
        message.success('已新增。');
      }
      setEditing(undefined);
      form.resetFields();
      setModalOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };

  const remove = (row: any) => {
    modal.confirm({
      title: `确认删除「${row.name}」？`,
      content: '删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api(`/dictionary/${config.kind}/${row.id}`, { method: 'DELETE' }, token);
          message.success('已删除。');
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败。');
        }
      },
    });
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setModalOpen(true);
  };
  const openCreate = () => {
    const nextSort = rows.length ? Math.max(...rows.map((r) => Number(r.sortOrder) || 0)) + 1 : 1;
    setEditing({ status: '启用', sortOrder: nextSort } as any);
    setModalOpen(true);
  };

  return (
    <>
      <Card className="page-toolbar">
        <Space wrap size={8}>
          <Input
            allowClear
            placeholder={config.searchPlaceholder}
            style={{ width: 240 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load()}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={() => void load()}>
            查询
          </Button>
          <Button
            onClick={() => {
              setKeyword('');
              void load('');
            }}
          >
            清空
          </Button>
        </Space>
      </Card>
      <Card
        title={config.title}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增
          </Button>
        }
      >
        <ReorderableTable
          rowKey="id"
          storageKey={config.storageKey}
          loading={loading}
          dataSource={rows}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          scroll={{ x: true }}
          locale={{ emptyText: <EmptyState text="暂无记录" /> }}
          columns={[
            ...config.columns.map((column) => ({
              title: column.title,
              dataIndex: column.dataIndex,
              render: printCell,
            })),
            {
              title: '操作',
              key: 'action',
              fixed: 'right',
              width: 150,
              render: (_: unknown, row: any) => (
                <Space size={4}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(row)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing?.id ? `编辑${config.title}：${editing.name ?? ''}` : `新增${config.title}`}
        open={modalOpen}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={560}
        afterOpenChange={(open) => {
          if (!open) {
            setEditing(undefined);
            form.resetFields();
          } else if (editing) {
            form.setFieldsValue(editing);
          }
        }}
        onCancel={() => {
          setEditing(undefined);
          form.resetFields();
          setModalOpen(false);
        }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            {config.fields.map((field) => (
              <Form.Item
                key={field.name}
                name={field.name}
                label={field.label}
                rules={field.required ? [{ required: true, message: `请输入${field.label}。` }] : undefined}
              >
                {field.type === 'select' ? (
                  <Select placeholder={`请选择${field.label}`} options={field.options} allowClear />
                ) : field.type === 'number' ? (
                  <InputNumber style={{ width: '100%' }} placeholder={`请输入${field.label}`} />
                ) : field.type === 'textarea' ? (
                  <Input.TextArea rows={2} maxLength={field.maxLength} placeholder={`请输入${field.label}`} />
                ) : (
                  <Input maxLength={field.maxLength} placeholder={`请输入${field.label}`} />
                )}
              </Form.Item>
            ))}
          </Space>
        </Form>
      </Modal>
    </>
  );
}

export function DictionaryPage({ token }: { token: string }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Typography.Text type="secondary">
          维护系统基础数据字典，供入库、出库、配方等模块引用。共 {DICT_CONFIGS.length} 类。
        </Typography.Text>
      </Card>
      <Tabs
        defaultActiveKey="ink-colors"
        items={DICT_CONFIGS.map((config) => ({
          key: config.kind,
          label: config.title,
          children: <DictionaryGrid config={config} token={token} />,
        }))}
      />
    </Space>
  );
}